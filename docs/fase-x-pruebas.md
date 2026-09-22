# Fase X: Pruebas

## 1. Introducción

El objetivo de esta fase fue verificar el estado real de las pruebas del sistema, identificar los componentes cubiertos y determinar los riesgos que todavía no están controlados mediante automatización. La revisión se realizó sobre el árbol de trabajo disponible el 21 de septiembre de 2026 e incluyó el scraper documental, la indexación y recuperación RAG, la API del backend, los adaptadores de modelos de lenguaje y el frontend.

El análisis combinó la inspección de archivos, scripts y configuración con la ejecución de las suites disponibles. Los resultados reportados corresponden exclusivamente a las ejecuciones realizadas durante esta revisión; no se estimaron casos aprobados ni porcentajes que no pudieran medirse.

## 2. Metodología

La revisión se desarrolló en cuatro actividades:

1. Inventario de archivos de prueba, fixtures, evaluadores y scripts de benchmark.
2. Lectura de los casos para establecer qué comportamiento verifican y detectar pruebas ambiguas, dependencias externas y posibles falsos positivos.
3. Ejecución de las suites unitarias y de integración disponibles, además de compilaciones de control para backend y frontend.
4. Medición exploratoria de cobertura del backend con la instrumentación experimental de Node.js. Esta medición no forma parte de la configuración oficial del proyecto y, por tanto, se interpreta con las limitaciones descritas en la sección 5.

### 2.1. Herramientas identificadas

| Componente | Herramienta o técnica | Uso encontrado |
|---|---|---|
| Backend TypeScript | `node:test` y `node:assert/strict`, ejecutados mediante `tsx` | Pruebas unitarias y contratos |
| Integración HTTP | Script TypeScript con Express y aserciones de Node.js | Smoke de autenticación, chat, recuperación y manejo de errores |
| Scraper Python | `unittest` | Pruebas unitarias de parsing, clasificación, rutas, MIME y metadatos |
| Frontend | `next build` | Verificación de compilación y tipos; no existe suite de comportamiento |
| Evaluación de interfaz | Playwright desde Python | Evaluador manual/semiautomatizado que genera CSV, sin aserciones automáticas |
| Calidad RAG | Conjuntos JSON/CSV y scripts propios | Baseline, conjunto dorado, benchmarks y diagnóstico; no todos forman parte de `npm test` |

No se encontró una herramienta de cobertura configurada en el repositorio. Tampoco se encontraron flujos de integración continua que ejecuten las pruebas automáticamente.

### 2.2. Comandos ejecutados

```text
cd backend && npm test
cd backend && npm run test:integration
cd backend && npm run typecheck && npm run build
cd backend && node --experimental-test-coverage --import tsx --test --test-reporter=spec test/*.test.ts
cd backend && GEMINI_API_KEY= GROQ_API_KEY= DEEPSEEK_API_KEY= OPENAI_API_KEY= npm run test:providers
cd web_scraper && python3 -m unittest discover -s tests -v
cd frontend && npm run build
```

La primera ejecución restringida de dos casos de caché no pudo resolver el host de Hugging Face. La suite se repitió con acceso de red y finalizó correctamente. Este evento se clasificó como una dependencia ambiental de las pruebas, no como un defecto funcional confirmado.

## 3. Inventario de pruebas

### 3.1. Backend: pruebas unitarias y contratos

La carpeta `backend/test/` contiene 22 archivos `*.test.ts`. El comando `npm test` los descubre mediante el patrón `test/*.test.ts`.

| Archivo | Cobertura funcional principal |
|---|---|
| `answer-question.test.ts` | Formato del contexto, encabezados de fragmentos, agrupación de fuentes y selección del contexto conversacional |
| `auth.test.ts` | Emisión y verificación de JWT, identidades anónimas, algoritmo, secreto, alcance y cabecera Bearer |
| `bm25-contract.test.ts` | Equivalencia entre BM25 invertido y referencia, top-k, limpieza del acumulador y fórmula |
| `chat-history.test.ts` | Límites del historial, descarte de turnos inválidos y serialización sin roles privilegiados |
| `chat-log.test.ts` | Escrituras concurrentes, recuperación tras fallos, anonimización, migración y retención |
| `chunk-cache-prune.test.ts` | Conservación de cachés de otros corpus y purga de entradas obsoletas |
| `chunking.test.ts` | Frontmatter, artículos, tablas, páginas, límites de tamaño, continuidad y documentos vacíos |
| `config.test.ts` | Lectura y validación de enteros, decimales, booleanos y clave de Gemini |
| `diversity.test.ts` | Cupos por documento, relleno, deduplicación por Jaccard y ruta sin reranker |
| `garbage-detection.test.ts` | Detección de texto PDF/OCR ilegible y exclusión de prosa y tablas válidas |
| `golden-set-eval.test.ts` | Cálculo de recall, MRR, nDCG, abstención y agregación de métricas |
| `index-snapshot.test.ts` | Persistencia, Unicode, firmas, raíz del corpus, corrupción y limpieza de snapshots |
| `openai-compatible.test.ts` | Fábrica compatible con OpenAI, estados HTTP, red, cuerpo de la solicitud y parser CSV |
| `pii.test.ts` | Enmascaramiento de datos personales sin alterar numeración normativa o presupuestal |
| `provider-model.test.ts` | Catálogo y validación de modelos por proveedor |
| `provider-router.test.ts` | Enrutamiento automático por complejidad y selección de reemplazos |
| `query-rewrite.test.ts` | Uso del contexto previo, corte por palabra y ponderación de términos |
| `relevance-threshold.test.ts` | Orden, umbral, abstención y tratamiento de candidatos sin logit |
| `retrieval.test.ts` | BM25 básico, fragmentación, coseno, RRF, TXT/XLSX, metadatos CSV y routing |
| `retry.test.ts` | Reintentos, errores no transitorios, backoff, `Retry-After` y límites |
| `settings.test.ts` | Unicidad, rangos, lectura diferida y diagnóstico de variables de entorno |
| `vector-scan.test.ts` | Top-k vectorial, empates, filtros, rangos, dimensiones y determinismo |

Archivos auxiliares de prueba:

- `bm25-contract.ts`: define 14 pruebas contractuales reutilizables. El contrato se aplica a dos implementaciones y genera 28 de los 190 casos ejecutados.
- `oracles.ts`: implementaciones de referencia utilizadas para contrastar resultados.
- `fixtures/abstention-queries.json`, `baseline-queries.json`, `baseline-results.json`, `golden-candidates.csv` y `golden-set.json`: datos versionados para evaluación y regresión.

### 3.2. Backend: integración y proveedores reales

- `backend/test/http-smoke.ts`: smoke de integración con 59 llamadas estáticas a `assert`. Verifica sesión, autorización, rutas eliminadas, catálogo de modelos, recuperación, fuentes, reconstrucción del índice, fallback Groq-Gemini, abstención, aislamiento de fallos de log y contrapresión. Es un script ejecutable y no registra casos individuales en `node:test`.
- `backend/test/smoke.ts`: smoke opcional de embeddings y proveedores reales. Requiere claves y servicios externos; no forma parte de `npm test` ni de `test:all`.

### 3.3. Scraper

`web_scraper/tests/test_scraper.py` contiene 51 casos `unittest`, distribuidos de la siguiente manera:

| Grupo | Casos | Cobertura principal |
|---|---:|---|
| `UrlTests` | 5 | Normalización, canonicalización, slug, traversal y recursos ignorados |
| `ParserTests` | 6 | Contenido principal, tablas, documentos embebidos, títulos, frontmatter y selectores por fuente |
| `MimeTests` | 5 | Extensión por MIME/disposition, nombre de archivo y validación PDF/XLSX |
| `ConfigTests` | 5 | Árbol de salida, layouts, dominios externos y reglas de encolado |
| `RelevanceTests` | 23 | Puntaje, clasificación normativa, años, tipos, rutas y filtros por fuente |
| `RecoverPageMetadataTests` | 4 | Lectura de frontmatter, recuperación incremental y reporte de inválidos |
| `MetadataStoreTests` | 2 | Recarga multifuente y compatibilidad de metadatos antiguos |
| `ReportTests` | 1 | Totales y tipos documentales del reporte |

### 3.4. Frontend y evaluación end-to-end

No existen archivos de pruebas unitarias o de componentes dentro de `frontend/`, no hay configuración de Jest/Vitest/Testing Library y `frontend/package.json` no define un script `test`.

`rag_tester/eval_bot.py` usa Playwright para enviar el banco `banco_preguntas_10pdfs_con_control.csv` a la interfaz y producir resultados para evaluación humana. No contiene aserciones de aceptación, no está conectado a un runner ni a CI y requiere frontend, backend, navegador y proveedores disponibles. Por esas razones se clasifica como herramienta de evaluación manual asistida, no como suite end-to-end automatizada.

### 3.5. Herramientas de evaluación que no forman parte de la suite

Los scripts `capture-baseline.ts`, `check-baseline.ts`, `eval-retrieval.ts`, `build-golden-candidates.ts`, `finalize-golden-set.ts`, `bench-retrieval.ts`, `bench-stages.ts`, `bench-worker.ts`, `bench-rerank.ts`, `probe-rebuild-oom.ts` y `summarize-extraction-gaps.ts` apoyan medición de calidad, rendimiento y diagnóstico. Su presencia no implica ejecución automática: `npm test` y `npm run test:all` no los invocan.

## 4. Resultados de ejecución

### 4.1. Resumen cuantitativo

| Ejecución | Aprobadas | Fallidas | Omitidas | Resultado |
|---|---:|---:|---:|---|
| Backend `npm test` | 190 | 0 | 0 | Aprobó |
| Scraper `unittest` | 51 | 0 | 0 | Aprobó |
| Integración HTTP | Script completo | 0 | 0 | Aprobó; no expone conteo de casos |
| Smoke de embeddings | Script completo | 0 | 0 | Aprobó; vector de dimensión 384 |
| Proveedores Gemini, Groq, DeepSeek y OpenAI | 0 | 0 | 4 | Omitidos al ejecutar sin claves para evitar consumo externo |
| Frontend `next build` | No aplica | 0 | No aplica | Compiló; no es una prueba funcional |
| Evaluador Playwright | No ejecutado | No aplica | No aplica | Requiere sistema desplegado y proveedores reales |

El total comparable de los runners unitarios es de **241 pruebas aprobadas, 0 fallidas y 0 omitidas**. Los smokes ejecutables se reportan aparte porque no publican un número de casos equivalente. El backend y el frontend también compilaron correctamente, y el typecheck del backend no reportó errores.

### 4.2. Cobertura observada

El proyecto no tiene cobertura configurada. Como diagnóstico se ejecutó `node --experimental-test-coverage` sobre los 22 archivos unitarios del backend y se obtuvo:

- Líneas: **93,57 %**.
- Ramas: **86,37 %**.
- Funciones: **91,41 %**.

Este porcentaje **no representa la cobertura integral del backend**: el reporte incluye archivos de prueba y auxiliares en el agregado, y solo instrumenta módulos importados por la suite unitaria. `src/index.ts`, `routes/auth.ts`, `routes/chat.ts`, `retrievalWorker.ts` e `indexDocuments.ts`, entre otros puntos productivos, no aparecieron en el reporte. El smoke HTTP sí ejercita algunas rutas, pero se ejecutó fuera de esa medición.

Valores de línea útiles para localizar riesgos dentro de los módulos sí importados:

| Archivo productivo | Cobertura de líneas exploratoria |
|---|---:|
| `services/retrievalMath.ts` | 99,05 % |
| `services/indexSnapshot.ts` | 99,39 % |
| `services/chunking.ts` | 98,81 % |
| `services/search.ts` | 91,81 % |
| `services/documentPreprocessor.ts` | 77,53 % |
| `services/retrievalClient.ts` | 66,09 % |
| `services/answerQuestion.ts` | 74,36 % |
| `services/auth.ts` | 95,65 % |
| `services/chatLog.ts` | 97,96 % |
| `services/pii.ts` | 100 % |
| `deepseek/askDeepSeek.ts` | 92,86 % |
| `gemini/askGemini.ts` | 88,76 % |
| `groq/askGroq.ts` | 77,27 % |
| `ollama/askOllama.ts` | 51,64 % |
| `openai/askOpenAI.ts` | 100 % |
| `services/llm.ts` | 41,03 % |

No fue posible presentar un porcentaje del scraper o del frontend porque no existe instrumentación de cobertura instalada para estos módulos. En el frontend, además, no existe una suite automatizada sobre la cual medirla.

## 5. Resultados y gaps por módulo

### 5.1. Scraper documental

| Casos ejecutados | Resultado | Cobertura aproximada |
|---|---|---|
| 51 casos de URL, HTML, MIME, configuración, relevancia, metadatos y reportes | 51 aprobados, 0 fallidos | No medida. Buena cobertura de funciones puras; baja en orquestación de red |

Aspectos cubiertos:

- Canonicalización y seguridad de rutas.
- Extracción de contenido y enlaces embebidos.
- Identificación y validación básica de archivos.
- Clasificación normativa y reglas específicas por fuente.
- Persistencia y recuperación de metadatos.

Gaps principales:

- Recorrido BFS completo de `SourceCrawler` y su interacción con una sesión HTTP simulada.
- Cumplimiento de `robots.txt`, reintentos, backoff, timeouts y errores de conexión.
- Límite de tamaño durante descarga por streaming, deduplicación SHA-256 y recuperación ante descargas interrumpidas.
- Escrituras atómicas y reanudación después de una falla.
- Ejecución del CLI y del script multi-fuente de extremo a extremo.
- Integración controlada con respuestas representativas de las fuentes reales.

### 5.2. Indexación y recuperación RAG

| Casos ejecutados | Resultado | Cobertura aproximada |
|---|---|---|
| BM25, búsqueda vectorial, chunking, caché, snapshots, diversidad, umbral, métricas y smoke con corpus temporal | Todos los casos asociados aprobaron | Alta en algoritmos puros; entre 66,09 % y 99,39 % de líneas en los archivos instrumentados. Worker y entrypoints sin medición |

Aspectos cubiertos:

- Contrato BM25 comparado con una implementación de referencia independiente.
- Escaneo vectorial top-k, coseno, RRF, reranking/diversidad y umbral de abstención.
- Chunking estructural con artículos, tablas, frontmatter y páginas.
- Persistencia y rechazo seguro de snapshots incompatibles o corruptos.
- Purga de caché aislada por corpus.
- Lectura de TXT y XLSX, y enriquecimiento desde metadatos CSV.
- Métricas de conjunto dorado y revalidación del corpus en el smoke HTTP.

Gaps principales:

- Extracción real de PDF, DOC y DOCX, ejecución de LibreOffice y OCR con fixtures controlados.
- Fallos, timeouts y segunda pasada del subprocess de OCR.
- Ciclo de vida real del worker: inicio, terminación, caída, reinicio y protocolo de mensajes.
- Reconstrucción en segundo plano bajo presión de memoria y concurrencia de extracción.
- Fallback cuando el reranker real no puede cargar o falla durante inferencia.
- Evaluación automática de calidad contra el corpus vigente. Las pruebas del conjunto dorado validan las fórmulas de las métricas, no que la recuperación actual alcance un umbral mínimo.
- Aislamiento del modelo de embeddings: dos pruebas de caché pueden requerir el modelo alojado en Hugging Face y no son completamente reproducibles sin red o caché previa.

### 5.3. API backend y privacidad

| Casos ejecutados | Resultado | Cobertura aproximada |
|---|---|---|
| JWT, logs, PII, formato de fuentes, contexto y smoke HTTP | Todos aprobaron | Media-alta en servicios importados; rutas y bootstrap productivo no medidos |

Aspectos cubiertos:

- Emisión y validación de sesión Bearer.
- Rechazo de solicitudes sin autorización y validación de campos de chat.
- Catálogo de proveedores/modelos y selección explícita.
- Abstención, fuentes agrupadas y códigos 503 con `Retry-After` para contrapresión.
- Enmascaramiento de PII, retención y serialización de escrituras de log.
- Aislamiento del chat ante fallos de escritura del registro.

Gaps principales:

- `answerQuestion()` no se prueba directamente como unidad; su archivo de prueba cubre funciones auxiliares.
- El smoke crea una aplicación Express propia con `express.json()`, los routers y healthcheck. No importa el bootstrap de `src/index.ts`; por ello no demuestra el comportamiento real de Helmet, CORS restringido, límite de cuerpo, `trust proxy`, precalentamiento ni apagado ordenado.
- No existe un caso concluyente para `429` por rate limiting real de sesión o chat.
- Faltan JSON malformado, payload superior a 64 KiB y combinaciones completas de cabeceras CORS/seguridad.
- No se prueban directamente fallos de warmup, señales del proceso o cierre mientras hay solicitudes en curso.

### 5.4. Adaptadores LLM y enrutamiento

| Casos ejecutados | Resultado | Cobertura aproximada |
|---|---|---|
| Fábrica OpenAI-compatible, reintentos, historial, catálogo y router; fallback Groq-Gemini simulado en integración | Casos unitarios aprobados; 4 proveedores reales omitidos por ausencia intencional de claves | Desigual: 41,03 % en `llm.ts`, 51,64 % en Ollama y 77,27–100 % en adaptadores HTTP importados |

Aspectos cubiertos:

- Normalización de respuestas y estados de la fábrica compatible con OpenAI.
- Errores de autenticación, cuota, servidor y red.
- Reintentos selectivos y respeto de `Retry-After`.
- Serialización segura de historial.
- Selección automática de proveedor/modelo y reemplazo por complejidad.

Gaps principales:

- Ollama carece de pruebas específicas de solicitud, respuesta, indisponibilidad y timeout; tampoco está incluido en el smoke de proveedores.
- Los wrappers de Groq, DeepSeek y OpenAI no tienen aserciones directas sobre URL, headers, cuerpo y modelo; se confía principalmente en la fábrica compartida.
- Gemini no tiene una unidad completamente simulada para todos los resultados de éxito/error.
- Faltan pruebas directas del presupuesto total de fallback, agotamiento del tiempo, corte en errores no reintentables y secuencia exacta de proveedores.
- El smoke de proveedores es opcional, depende de servicios y credenciales reales y no forma parte de `test:all`.

### 5.5. Frontend

| Casos ejecutados | Resultado | Cobertura aproximada |
|---|---|---|
| Compilación de producción con Next.js | Aprobó | No medida; no hay pruebas automatizadas del código de interfaz |

Gaps principales:

- Caché de sesión en memoria, concurrencia de solicitudes y renovación/reintento tras `401`.
- Selector proveedor-modelo, parsing del catálogo y estados deshabilitados.
- Envío de mensajes, historial, loading, errores, abstención y estado del índice.
- Render seguro de Markdown, código inline y allowlist de enlaces HTTP/HTTPS.
- Agrupación y navegación de fuentes enriquecidas.
- Accesibilidad por teclado, foco, nombres accesibles y anuncios de estado.
- Flujo end-to-end con aserciones verificables. El evaluador Playwright actual solo recolecta resultados para revisión humana.

## 6. Inconsistencias y riesgos de falsos positivos

### 6.1. Dependencias externas no aisladas

- El caso `la clave de Gemini se lee en cada llamada...` de `config.test.ts` realiza una solicitud HTTP real a Gemini con una clave ficticia. La API respondió `400 API_KEY_INVALID`, pero la prueba pasó porque solo comprueba que el mensaje no sea “Falta configurar GEMINI_API_KEY”. Esto produce un falso positivo parcial: no demuestra una respuesta válida y vuelve la suite dependiente de la red.
- `chunk-cache-prune.test.ts` construye el índice real y puede descargar el modelo de Hugging Face. Sin red o caché local, falla antes de probar la purga.
- `smoke.ts` está diseñado para APIs reales. La separación como smoke opcional es correcta, pero debería declarar sus omisiones y límites de costo de forma estructurada.

### 6.2. Pruebas que no verifican exactamente lo indicado

- El caso `un token caducado se rechaza` modifica el payload de un JWT ya firmado sin volver a firmarlo. El rechazo puede deberse a firma inválida y no necesariamente a expiración. Debe generarse un token correctamente firmado cuyo `exp` ya haya vencido.
- El caso de `relevance-threshold.test.ts` denominado `ruta de reserva sin reranker ... nunca la llama` invoca directamente `rankAndFilterByRelevance` y comprueba un resultado vacío. No verifica que `hybridSearch` evite esa función en la ruta de reserva.
- El smoke HTTP prueba una composición similar a la aplicación, no la aplicación productiva completa. Puede permanecer verde aunque se rompa una política de seguridad configurada en `src/index.ts`.
- `golden-set-eval.test.ts` valida correctamente las funciones de métricas, pero no valida la calidad actual del buscador. Su nombre puede inducir a interpretar que se ejecutó el conjunto dorado contra el índice real.

### 6.3. Organización, duplicación y legibilidad

- `openai-compatible.test.ts` incluye seis pruebas del parser CSV, una responsabilidad que no corresponde al adaptador LLM. Conviene moverlas a `semicolon-csv.test.ts`.
- Existen verificaciones BM25 básicas en `retrieval.test.ts` y un contrato BM25 mucho más completo. La repetición es pequeña y puede servir como smoke, pero debería declararse o consolidarse para reducir mantenimiento duplicado.
- Los títulos mezclan español e inglés y todos los casos están en el nivel raíz. El runner reporta cero suites (`suites: 0`), lo que dificulta agrupar resultados por módulo.
- Varias pruebas modifican temporalmente `globalThis.fetch` o `process.env`. Actualmente restauran el estado en la mayoría de los casos, pero el enfoque sería frágil ante ejecución concurrente dentro del mismo proceso. La inyección de transporte y configuración reduciría ese riesgo.
- `eval_bot.py` usa un ciclo `while True` para ciertos reintentos y no define un máximo. Una degradación persistente puede dejar la evaluación bloqueada indefinidamente. Playwright tampoco está declarado en un archivo de dependencias propio del evaluador.

## 7. Hallazgos y limitaciones generales

1. La base algorítmica del backend está ampliamente probada, especialmente BM25, búsqueda vectorial, chunking, snapshots, reintentos y protección de logs.
2. La suite del scraper cubre bien reglas puras y casos por fuente, pero no el recorrido de red completo, donde se concentran los fallos operativos más probables.
3. La API cuenta con un smoke valioso, aunque su servidor duplicado deja fuera políticas productivas de seguridad y ciclo de vida.
4. La cobertura de adaptadores es irregular. La fábrica compartida está probada, pero Ollama y la orquestación global presentan los porcentajes exploratorios más bajos.
5. El frontend no dispone de una red de seguridad automatizada. Una compilación exitosa no detecta regresiones de interacción, accesibilidad o seguridad del render.
6. Las suites no son totalmente herméticas: parte de la ejecución depende de Hugging Face y una prueba unitaria contacta a Gemini.
7. No hay un comando único que cubra backend, scraper, frontend y evaluación end-to-end, ni evidencia de ejecución automática en CI.
8. No existe una métrica oficial de cobertura. El 93,57 % exploratorio no debe utilizarse como indicador global hasta excluir tests/helpers e incluir todos los entrypoints productivos.

## 8. Conclusiones y recomendaciones

El estado general de las pruebas es favorable para los algoritmos centrales: las 241 pruebas ejecutadas por runners aprobaron y el smoke HTTP completó los flujos principales sin defectos funcionales observados. Sin embargo, la confianza no es homogénea. El frontend, el ciclo de vida productivo del servidor, el worker, el OCR y la red del scraper mantienen gaps relevantes; además, dos pruebas del backend no son herméticas y existen casos cuyo nombre promete más de lo que realmente comprueban.

Se recomiendan las siguientes acciones, en orden de prioridad:

1. **Eliminar falsos positivos y dependencia de red de la suite unitaria.** Simular Gemini en `config.test.ts`, firmar correctamente el JWT expirado y desacoplar las pruebas de caché del modelo remoto.
2. **Probar la aplicación productiva.** Extraer una función `createApp()` reutilizable desde `src/index.ts` y usarla en integración para verificar Helmet, CORS, límites de cuerpo, rate limiting y manejo de errores sin duplicar el bootstrap.
3. **Incorporar pruebas del frontend.** Añadir Vitest y Testing Library para sesión, selector, Markdown y panel; complementar con Playwright para un flujo autenticado de chat con backend/proveedores simulados.
4. **Cubrir la orquestación crítica.** Añadir unidades directas de `answerQuestion`, presupuesto de fallback, Ollama y ciclo de vida del worker, incluyendo caída, reinicio y cola saturada.
5. **Ampliar las integraciones controladas.** Usar fixtures y subprocess simulados para PDF/DOCX/OCR, y un servidor HTTP local para crawler, robots, reintentos y descargas parciales.
6. **Formalizar cobertura y CI.** Configurar cobertura por módulo con exclusión de tests y helpers, definir umbrales iniciales realistas y ejecutar backend, scraper y frontend en cada cambio. Separar suites `unit`, `integration`, `e2e` y `providers-real` para mantener el camino principal reproducible y sin credenciales.
7. **Automatizar calidad RAG de manera controlada.** Ejecutar el baseline y conjunto dorado contra un corpus fijo, con umbrales versionados de recall/MRR/nDCG. Los benchmarks y proveedores con costo pueden permanecer como tareas manuales o programadas.
8. **Ordenar la suite.** Agrupar casos con `describe`, uniformar los nombres en español, mover el parser CSV a su propio archivo y limitar los reintentos del evaluador Playwright.

Con estas mejoras, el proyecto pasaría de una buena cobertura de funciones puras a una estrategia equilibrada que también controle integración, operación, seguridad y experiencia de usuario.
