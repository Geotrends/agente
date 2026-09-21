# Arquitectura del sistema Geobot

## Propósito y alcance

Este documento describe la arquitectura implementada actualmente en Geobot. Cubre la adquisición del corpus, su indexación, la recuperación híbrida de evidencia y la generación de respuestas desde la interfaz web.

El `web_scraper` es un proceso auxiliar y offline: escribe documentos y metadatos en el sistema de archivos, pero no recibe ni atiende consultas del chat. El backend solo consume esos artefactos desde la raíz configurada en `GEOTRENDS_DOCUMENTS_ROOT`.

La fuente de verdad de estos diagramas es el código actual y el `README.md`. `DOCUMENTACION-HANDOFF.md` describe una versión anterior, previa al índice híbrido vigente.

### Leyenda

En los diagramas de flujo y componentes se emplean estas convenciones:

- Azul: componentes que atienden el flujo interactivo.
- Morado: procesos offline o por lotes.
- Verde: almacenamiento local y artefactos persistidos.
- Naranja: servicios o sitios externos.
- Rojo: resultados de error, rechazo o indisponibilidad.
- Las flechas continuas representan llamadas o transferencia directa. Una conexión con el scraper nunca implica una llamada en tiempo real desde el chat.

## Diagrama de componentes

```mermaid
flowchart LR
    user([Usuario])
    operator([Operador])

    subgraph acquisition[Adquisición documental · offline]
        scraper["Scraper Python<br/>crawler · relevance · downloader"]
        sourceConfig["Configuración de fuentes<br/>sources.py"]
        metadataWriter["Persistencia y deduplicación<br/>MetadataStore"]
    end

    subgraph storage[Almacenamiento local]
        corpus[("Corpus documental<br/>documentos y páginas Markdown")]
        metadata[("Metadatos<br/>metadata/*.csv y manifest.json")]
        documentCache[("Markdown derivado<br/>.cache/documents")]
        retrievalCache[("Índice persistido<br/>caché por documento y snapshots")]
        chatLog[("Registro anonimizado<br/>var/chat-interactions.csv")]
    end

    subgraph webapp[Frontend Next.js]
        smartPanel["SmartAgentPanel<br/>chat y selector de modelo"]
        sessionClient["Cliente de sesión<br/>JWT en memoria"]
        sourceView["Presentación de respuesta<br/>Markdown y fuentes"]
    end

    subgraph api[Backend Express]
        httpRoutes["Rutas HTTP<br/>auth.ts · chat.ts"]
        auth["Autenticación y cuotas<br/>JWT · scopes · rate limit"]
        answer["Orquestación de respuesta<br/>answerQuestion.ts"]
        providerRouter["Enrutamiento de modelos<br/>manual o automático"]
        llmAdapters["Adaptadores LLM<br/>Gemini · Groq · DeepSeek · OpenAI · Ollama"]
        retrievalClient["Cliente de recuperación<br/>cola · estado · reinicio"]
    end

    subgraph retrieval[Recuperación e indexación]
        worker["Worker de recuperación<br/>worker_threads"]
        preprocess["Preprocesamiento<br/>PDF · Office · texto · OCR"]
        chunkEmbed["Indexación<br/>chunking · E5 embeddings · BM25"]
        hybrid["Búsqueda híbrida<br/>BM25 · coseno · RRF"]
        reranker["Relevancia final<br/>reranker MS MARCO · diversidad"]
    end

    websites["Sitios institucionales<br/>Ambientómetro · Concejo · Ministerios"]
    providers["Proveedores LLM externos<br/>Gemini · Groq · DeepSeek · OpenAI"]
    ollama["Ollama local"]

    operator --> sourceConfig
    sourceConfig --> scraper
    websites -->|HTTPS, HTML y adjuntos| scraper
    scraper --> metadataWriter
    metadataWriter --> corpus
    metadataWriter --> metadata

    user --> smartPanel
    smartPanel --> sessionClient
    sessionClient -->|HTTPS / JSON + Bearer JWT| httpRoutes
    httpRoutes --> auth
    auth --> answer
    answer --> retrievalClient
    retrievalClient -->|mensajes worker_threads| worker
    worker --> hybrid
    hybrid --> reranker
    corpus --> preprocess
    preprocess --> documentCache
    preprocess --> chunkEmbed
    metadata --> chunkEmbed
    chunkEmbed --> retrievalCache
    retrievalCache --> worker
    answer --> providerRouter
    providerRouter --> llmAdapters
    llmAdapters -->|HTTPS / JSON| providers
    llmAdapters -->|HTTP local| ollama
    answer --> chatLog
    answer --> sourceView
    sourceView --> user

    classDef interactive fill:#dbeafe,stroke:#2563eb,color:#172554;
    classDef batch fill:#f3e8ff,stroke:#9333ea,color:#3b0764;
    classDef store fill:#dcfce7,stroke:#16a34a,color:#052e16;
    classDef external fill:#ffedd5,stroke:#ea580c,color:#431407;
    classDef actor fill:#f8fafc,stroke:#475569,color:#0f172a;

    class smartPanel,sessionClient,sourceView,httpRoutes,auth,answer,providerRouter,llmAdapters,retrievalClient,worker,hybrid,reranker interactive;
    class scraper,sourceConfig,metadataWriter,preprocess,chunkEmbed batch;
    class corpus,metadata,documentCache,retrievalCache,chatLog store;
    class websites,providers,ollama external;
    class user,operator actor;
```

### Responsabilidades principales

| Área | Responsabilidad |
| --- | --- |
| Scraper | Recorre fuentes mediante BFS, respeta `robots.txt`, aplica filtros deterministas, descarga adjuntos y deduplica por SHA-256. |
| Corpus y metadatos | Conserva documentos, páginas Markdown y los CSV que relacionan rutas locales con títulos, categorías y URLs originales. |
| Frontend | Obtiene una sesión anónima, envía preguntas e historial, permite elegir modelo y presenta respuesta y fuentes. |
| API Express | Aplica seguridad HTTP, valida contratos, autentica por scopes, limita solicitudes y traduce resultados a HTTP. |
| Servicio de respuesta | Recupera evidencia, decide entre abstención o llamada LLM, agrupa fuentes y registra interacciones. |
| Worker de recuperación | Mantiene el índice y los modelos locales fuera del hilo HTTP; limita la cola y reporta su estado. |
| Índice híbrido | Combina BM25 y similitud coseno mediante Reciprocal Rank Fusion (RRF), reordena y diversifica resultados. |
| Router y adaptadores LLM | Resuelven proveedor/modelo, aplican fallback en modo automático y normalizan las respuestas y fallos. |

El índice es local, en memoria y con persistencia en archivos; no existe una base de datos vectorial externa.

## Flujo 1: adquisición e indexación

```mermaid
flowchart TD
    start([Operador inicia el scraper]) --> select[Seleccionar fuentes y parámetros]
    select --> robots[Consultar y aplicar robots.txt]
    robots --> seeds[Normalizar semillas e iniciar cola BFS]
    seeds --> dequeue{¿Quedan URLs<br/>dentro de los límites?}
    dequeue -- No --> flush[Escribir CSV y manifest de la corrida]
    dequeue -- Sí --> allowed{¿URL permitida,<br/>no visitada y en alcance?}
    allowed -- No --> dequeue
    allowed -- Sí --> fetch[Solicitar recurso con pausa y reintentos]
    fetch --> response{¿Respuesta válida?}
    response -- No --> recordError[Registrar error aislado]
    recordError --> dequeue
    response -- Sí --> kind{¿Documento o HTML?}
    kind -- HTML --> parse[Extraer contenido principal, enlaces y categoría]
    parse --> crawlFilter[Aplicar filtro de rastreo nivel A]
    crawlFilter --> savePage[Guardar página como Markdown y metadata]
    savePage --> enqueue[Agregar enlaces aprobados a la cola]
    enqueue --> dequeue
    kind -- Documento --> downloadFilter{Filtro de descarga nivel B<br/>y clasificación}
    downloadFilter -- Rechazado --> dequeue
    downloadFilter -- Aprobado --> validate[Validar tamaño, MIME y firma]
    validate --> dedupe{¿SHA-256 conocido?}
    dedupe -- Sí --> associate[Reutilizar archivo y registrar asociación]
    dedupe -- No --> persist[Guardar documento por fuente, tipo o extensión]
    associate --> dequeue
    persist --> dequeue

    flush --> corpus[(Documentos, Markdown y metadata CSV)]
    corpus --> indexStart[Ejecutar npm run index o calentamiento del worker]
    indexStart --> signature[Inventariar archivos y calcular firma]
    signature --> snapshot{¿Existe snapshot<br/>compatible?}
    snapshot -- Sí --> restore[Cargar BM25, vectores, fragmentos y alcances]
    snapshot -- No --> preprocess[Extraer y normalizar texto]
    preprocess --> ocr{¿PDF con texto<br/>insuficiente y OCR habilitado?}
    ocr -- Sí --> runOcr[Ejecutar OCR local]
    ocr -- No --> chunks[Dividir en fragmentos estructurales]
    runOcr --> chunks
    chunks --> embedding[Generar embeddings E5 locales]
    embedding --> bm25[Construir índice BM25 con ruta y metadata]
    bm25 --> saveCache[Guardar caché por documento y snapshot]
    saveCache --> ready([Índice listo])
    restore --> ready

    classDef batch fill:#f3e8ff,stroke:#9333ea,color:#3b0764;
    classDef store fill:#dcfce7,stroke:#16a34a,color:#052e16;
    classDef decision fill:#fef3c7,stroke:#d97706,color:#451a03;
    classDef failure fill:#fee2e2,stroke:#dc2626,color:#450a0a;

    class start,select,robots,seeds,fetch,parse,crawlFilter,savePage,enqueue,validate,associate,persist,flush,indexStart,signature,restore,preprocess,runOcr,chunks,embedding,bm25,saveCache,ready batch;
    class corpus store;
    class dequeue,allowed,response,kind,downloadFilter,dedupe,snapshot,ocr decision;
    class recordError failure;
```

La indexación puede ejecutarse explícitamente mediante `npm run index`. Al arrancar el servidor, el worker también precalienta el índice: restaura un snapshot compatible o lo construye si todavía no existe. Durante una reconstrucción, el índice anterior puede seguir atendiendo consultas en estado `refreshing`.

## Flujo 2: pregunta y respuesta RAG

RAG significa *Retrieval-Augmented Generation*: antes de pedir una respuesta al modelo, el sistema recupera fragmentos relevantes del corpus y los incorpora como evidencia.

```mermaid
flowchart TD
    ask([Usuario envía una pregunta]) --> token{¿Hay JWT vigente<br/>en memoria?}
    token -- No --> session[POST /api/session]
    session --> issue{¿Sesión emitida?}
    issue -- No --> sessionError([Mostrar error de sesión])
    issue -- Sí --> request
    token -- Sí --> request[POST /api/chat con pregunta, historial y selección]
    request --> auth{¿JWT, scope, cuota<br/>y cuerpo válidos?}
    auth -- No --> httpReject([401, 403, 400 o 429])
    auth -- Sí --> status{¿Índice ready<br/>o refreshing?}
    status -- No --> unavailable([503 con progreso o error del índice])
    status -- Sí --> queue{¿Worker con<br/>capacidad disponible?}
    queue -- No --> busy([503 + Retry-After])
    queue -- Sí --> context[Normalizar historial y contexto de seguimiento]
    context --> scope[Resolver alcance opcional por carpeta o documento]
    scope --> parallel[Buscar en paralelo: BM25 y coseno vectorial]
    parallel --> rrf[Fusionar rankings con RRF]
    rrf --> rerank{¿Reranker disponible?}
    rerank -- Sí --> threshold[Reordenar con MS MARCO y aplicar umbral]
    rerank -- No --> fallbackRrf[Conservar candidatos RRF]
    threshold --> diversify[Deduplicar, diversificar y limitar a 8]
    fallbackRrf --> diversify
    diversify --> evidence{¿Hay evidencia?}
    evidence -- No --> abstain[Responder abstención sin llamar a un LLM]
    evidence -- Sí --> mode{¿Selección manual<br/>o automática?}
    mode -- Manual --> selected[Validar y usar proveedor/modelo solicitado]
    mode -- Automática --> classify[Clasificar complejidad y elegir proveedor/modelo]
    classify --> configured{¿Proveedor principal<br/>configurado?}
    configured -- No --> replacement[Elegir reemplazo configurado]
    configured -- Sí --> buildPrompt[Construir prompt con evidencia e historial]
    replacement --> buildPrompt
    selected --> buildPrompt
    buildPrompt --> provider[Invocar adaptador LLM con timeout y reintentos]
    provider --> success{¿Respuesta correcta?}
    success -- No, retryable --> fallback{¿Modo automático, reemplazo<br/>y presupuesto disponibles?}
    fallback -- Sí --> callFallback[Invocar proveedor de reemplazo]
    callFallback --> fallbackSuccess{¿Respuesta correcta?}
    fallbackSuccess -- No --> providerError([503 por fallo de proveedor])
    fallbackSuccess -- Sí --> assemble
    fallback -- No --> providerError
    success -- No, no retryable --> providerError
    success -- Sí --> assemble[Consolidar respuesta, metadata y fuentes]
    abstain --> deliver[Devolver JSON al frontend]
    assemble --> log[Registrar interacción con datos personales enmascarados]
    log --> deliver
    deliver --> render([Renderizar respuesta Markdown y fuentes])

    classDef interactive fill:#dbeafe,stroke:#2563eb,color:#172554;
    classDef decision fill:#fef3c7,stroke:#d97706,color:#451a03;
    classDef failure fill:#fee2e2,stroke:#dc2626,color:#450a0a;
    classDef store fill:#dcfce7,stroke:#16a34a,color:#052e16;

    class ask,session,request,context,scope,parallel,rrf,threshold,fallbackRrf,diversify,abstain,selected,classify,replacement,buildPrompt,provider,callFallback,assemble,deliver,render interactive;
    class token,issue,auth,status,queue,rerank,evidence,mode,configured,success,fallback,fallbackSuccess decision;
    class sessionError,httpReject,unavailable,busy,providerError failure;
    class log store;
```

Si el reranker falla, la búsqueda conserva los candidatos producidos por RRF y todavía aplica diversidad; en ese camino de reserva no puede aplicar el umbral basado en el logit del reranker. La abstención ocurre cuando, con el reranker disponible, ningún fragmento supera el umbral de relevancia.

## Diagrama C4 de contenedores y conectores

Las relaciones marcadas como **online** forman parte de una petición interactiva. Las marcadas como **offline** preparan o mantienen el corpus y el índice.

```mermaid
C4Container
    title Geobot — contenedores y conectores

    Person(user, "Usuario", "Consulta el corpus y revisa las fuentes de la respuesta")
    Person(operator, "Operador técnico", "Configura fuentes, prepara el índice y consulta el corpus protegido")

    System_Ext(sites, "Sitios institucionales", "Ambientómetro, Concejo de Envigado, MinAmbiente y MinAgricultura")
    System_Ext(gemini, "Google Gemini API", "Proveedor LLM externo")
    System_Ext(groq, "Groq API", "Proveedor LLM externo")
    System_Ext(deepseek, "DeepSeek API", "Proveedor LLM externo")
    System_Ext(openai, "OpenAI API", "Proveedor LLM externo")
    System_Ext(ollama, "Ollama", "Proveedor LLM ejecutado localmente")

    System_Boundary(geobot, "Sistema Geobot") {
        Container(frontend, "Aplicación web", "Next.js 14, React, TypeScript", "Gestiona la conversación, la selección de modelo y la presentación de fuentes")
        Container(api, "API de agentes", "Node.js, Express, TypeScript", "Emite sesiones, protege rutas, orquesta recuperación y generación")
        Container(worker, "Worker de recuperación", "Node.js worker_threads, Transformers.js", "Posee el índice en memoria, embeddings y reranker")
        Container(indexer, "Indexador CLI", "Node.js, TypeScript", "Construye anticipadamente el índice con npm run index")
        Container(scraper, "Adquisición documental", "Python, requests, BeautifulSoup", "Rastrea fuentes y genera documentos y metadatos")

        ContainerDb(corpus, "Corpus y metadatos", "Sistema de archivos, documentos, Markdown, CSV/JSON", "Contenido consultable y procedencia de sus fuentes")
        ContainerDb(documentCache, "Caché documental", "Sistema de archivos, .cache/documents", "Markdown normalizado y resultados de preprocesamiento")
        ContainerDb(retrievalCache, "Caché de recuperación", "Sistema de archivos, .cache/retrieval", "Fragmentos, vectores, BM25 y snapshots")
        ContainerDb(chatLog, "Registro de interacciones", "CSV local, backend/var", "Conversaciones enmascaradas para evaluación y diagnóstico")
    }

    Rel(user, frontend, "Conversa y revisa fuentes", "Online · HTTPS")
    Rel(frontend, api, "Solicita sesión y envía preguntas", "Online · HTTPS/JSON + Bearer JWT")
    Rel(api, worker, "Precalienta, consulta y obtiene estado", "Online · mensajes worker_threads")
    Rel(worker, corpus, "Lee documentos y metadata", "Online/refresco · archivos y CSV")
    Rel(worker, documentCache, "Lee y escribe Markdown derivado", "Refresco · archivos")
    Rel(worker, retrievalCache, "Restaura o actualiza el índice", "Online/refresco · binario y JSON")
    Rel(api, chatLog, "Registra respuestas exitosas", "Online asíncrono · CSV con PII enmascarada")

    Rel(api, gemini, "Genera respuestas", "Online · HTTPS/JSON")
    Rel(api, groq, "Genera respuestas", "Online · HTTPS/JSON")
    Rel(api, deepseek, "Genera respuestas", "Online · HTTPS/JSON")
    Rel(api, openai, "Genera respuestas", "Online · HTTPS/JSON")
    Rel(api, ollama, "Genera respuestas", "Online · HTTP local/JSON")

    Rel(operator, scraper, "Inicia y configura corridas", "Offline · CLI")
    Rel(scraper, sites, "Consulta páginas y adjuntos", "Offline · HTTPS")
    Rel(scraper, corpus, "Escribe documentos, Markdown y metadata", "Offline · archivos y CSV/JSON")
    Rel(operator, indexer, "Prepara el índice", "Offline · npm run index")
    Rel(indexer, corpus, "Lee documentos y metadata", "Offline · archivos y CSV")
    Rel(indexer, documentCache, "Lee y escribe preprocesamiento", "Offline · archivos")
    Rel(indexer, retrievalCache, "Escribe caché y snapshot", "Offline · binario y JSON")
    Rel(operator, api, "Solicita sesión de operador y consulta el corpus", "HTTPS/JSON + Bearer JWT")
```

## Contratos HTTP relevantes

| Método y ruta | Acceso | Función arquitectónica |
| --- | --- | --- |
| `GET /health` | Público | Confirma que el proceso HTTP está activo, aunque el índice todavía no esté disponible. |
| `POST /api/session` | Público con límite por IP | Emite un JWT anónimo con scope `chat`; el frontend lo conserva solo en memoria. |
| `POST /api/session/operator` | Clave de operador y límite estricto | Emite un JWT con scope `corpus`. |
| `POST /api/chat` | JWT `chat` | Valida la pregunta y ejecuta recuperación, enrutamiento y generación. |
| `GET /api/providers` | Público | Expone proveedores configurados, modelos permitidos y modelo predeterminado, sin secretos. |
| `GET /api/retrieval/status` | Público | Informa `idle`, `indexing`, `refreshing`, `ready` o `error`, además del progreso. |
| `GET /api/folders` | JWT `corpus` | Lista carpetas y entradas del corpus. |
| `GET /api/documents` | JWT `corpus` | Lista documentos por curso y carpeta. |
| `GET /api/document` | JWT `corpus` | Entrega el archivo original con resolución segura bajo la raíz documental. |
| `GET /api/document/text` | JWT `corpus` | Entrega una vista textual extraída, excepto para PDF. |
| `GET /api/document/html` | JWT `corpus` | Convierte hojas XLS/XLSX a HTML para vista previa. |

## Artefactos persistidos y ciclo de vida

| Artefacto | Productor | Consumidor | Propósito |
| --- | --- | --- | --- |
| Documentos originales | Scraper u operador | Preprocesador, rutas de corpus | Evidencia primaria del sistema. |
| Páginas Markdown del scraper | Scraper | Indexador/worker | Contenido web normalizado. |
| `metadata/paginas.csv` y `metadata/documentos.csv` | Scraper | Cargador de metadata e índice BM25 | Añaden título, categoría, URL original y procedencia a los resultados. |
| `metadata/urls_visitadas.csv`, `errores.csv` y `manifest.json` | Scraper | Operación y auditoría | Trazabilidad de las corridas; no se indexan como contenido. |
| `.cache/documents` | Preprocesador | Construcciones posteriores del índice | Evita repetir conversiones y OCR cuando el documento no cambió. |
| Caché por documento en `.cache/retrieval` | Indexador/worker | Indexador/worker | Reutiliza fragmentos y embeddings válidos. |
| Snapshot en `.cache/retrieval` | Indexador/worker | Worker de recuperación | Restaura rápidamente vectores, BM25, fragmentos y alcances. |
| `backend/var/chat-interactions.csv` | Servicio de respuesta | Evaluación y diagnóstico | Conserva respuestas exitosas con datos personales enmascarados y retención configurable. |

No se documentan valores concretos de variables de entorno ni credenciales. Las rutas anteriores son ubicaciones lógicas o relativas al proyecto y pueden cambiar mediante configuración.
