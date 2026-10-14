# Geobot — asistente documental con búsqueda híbrida

Chat público sobre un corpus documental local (normativa y documentos técnicos del
Observatorio Ambiental de Envigado). Responde solo con evidencia recuperada de los
documentos, cita sus fuentes y se abstiene cuando no encuentra respaldo suficiente.

La inferencia es **solo Amazon Bedrock** con dos modelos (`gpt-oss-20b` y `gpt-oss-120b`): un
enrutamiento local por complejidad escoge el principal y cae al otro si falla; la persona
no elige modelo ni proveedor. El ciudadano decide si **autoriza** o no guardar su conversación
(sin autorización cada pregunta se atiende sola y no deja texto ni identificadores), los
datos personales se enmascaran antes de salir, y un panel mínimo (`/admin`) edita los
contactos oficiales y muestra el estado y los avisos. Detalle en
`docs/arquitectura-sistema.md` («Bloque 2») y `specs/002-diseno-modelo-ia/`.

---

## 1. Puesta en marcha (Docker)

Todo se opera desde la raíz del repo con `make`. Los datos, el índice y el registro
de interacciones viven en volúmenes Docker y sobreviven a reinicios y a `make down`.

### Requisitos

- Docker y Docker Compose v2 (`docker compose version`), y `make`.
- Máquina con **≥ 8 GB de RAM** asignados a Docker (el modelo de embeddings y el reranker
  viven en el backend; el índice vive en Qdrant) y **≥ 25 GB libres** (adquisición,
  PostgreSQL, Qdrant e imágenes).
- Configuración:

  ```bash
  cp .env.example .env
  openssl rand -base64 48     # pégalo en AUTH_JWT_SECRET
  ```

  Obligatorio en `.env`: `AUTH_JWT_SECRET` (≥ 32 caracteres) y las seis contraseñas de
  base de datos (`POSTGRES_PASSWORD`, `KB_DB_PASSWORD`, `APP_DB_PASSWORD` y, desde el
  bloque 2, `CHAT_DB_PASSWORD`, `ADMIN_DB_PASSWORD`, `MAINT_DB_PASSWORD`, de ≥ 12
  caracteres). **La inferencia es solo Amazon Bedrock con el rol de la instancia**: no se
  definen API keys de proveedores ni `AWS_ACCESS_KEY_ID/SECRET` (el arranque y `GET /ready`
  las rechazan). Además del bloque 1, la operación debe cargar los datos oficiales que no
  tienen valor por defecto: orígenes permitidos, versión y URL de la política de datos
  (`CHAT_ALLOWED_ORIGINS`, `CONSENT_POLICY_VERSION`, `CONSENT_POLICY_URL`), contactos
  (panel) y tarifas por modelo.

### Primera vez

```bash
make up                                  # 1. postgres, qdrant, backend, kb-worker, scraper, frontend
make scrape                              # 2. corrida manual del scraper (deja un informe de corrida)
make kb CMD="sincronizar"                # 3. el kb-worker lo procesa y deja versiones PENDIENTES
make kb CMD="pendientes"                 # 4. qué espera aprobación
make kb CMD="publicar --todos-pendientes"  # 5. indexa y publica
make migrate-chat                        # 6. bloque 2: roles y esquemas chat/admin (idempotente)
printf '%s' "$CLAVE_TEMPORAL" | make bootstrap-admin EMAIL=tecnico@dominio NOMBRE="Nombre"   # 7. primer administrador
```

Después, entre al panel (`/admin/login`), cambie la contraseña temporal y cargue los
**contactos oficiales**; la operación registra las **tarifas** de ambos modelos y calibra el
umbral de relevancia (`make kb CMD="sincronizar --completa --oro=<archivo>"`). Mientras falte
cualquiera de esos datos, `GET /ready` responde 503 (la lista de lo que falta se ve desde el
contenedor, ver la tabla de endpoints) y el chat no se declara listo: no hay contactos, tarifas ni umbral inventados.

La base se limita al alcance del bloque 1: los 6 procedimientos GT-P de GMAS2 con sus
formatos, normas y MG vinculados, y las páginas del Observatorio (Ambientómetro,
Envigado.gov.co y Observatorio Geotrends). Nada nuevo o modificado se recupera hasta
que el administrador lo publica.

- `make scrape` puede tardar un buen rato y no pide credenciales; imprime una línea por
  URL. Para una prueba corta: `make scrape ARGS="--max-pages 20"`.
- Después del primer arranque **no hace falta repetir esto**: el servicio `scraper` corre
  solo cada domingo a las 02:00 (`SCRAPER_CRON`, zona America/Bogotá; el día del mes y el
  mes deben ser `*` para no superar los 7 días entre verificaciones). Cada corrida deja un
  informe que el `kb-worker` procesa en minutos; lo nuevo queda pendiente, lo derogado sale
  de las respuestas al instante y las fallas se avisan sin perder lo ya validado.
- Estado, avisos y operaciones: `make kb CMD="estado"`, `notificaciones`, `revisar <id>`,
  `exportar-matriz` (.xlsx), `exportar-fichas`, `auditar-alcance`,
  `sincronizar --completa --medir` y `purgar-retencion`. Contrato en
  `specs/001-base-conocimiento-bloque1/contracts/kb-cli.md`.

### Arranque normal (todas las veces siguientes)

```bash
make up       # levanta todo; la base y el índice persisten en sus volúmenes
```

| Qué | Dónde |
| --- | --- |
| Aplicación (UI) | `http://localhost:8080` (`FRONTEND_PORT` en `.env`) |
| API | `http://localhost:8080/api/...` — p. ej. `/api/retrieval/status` |
| Salud del backend | `http://localhost:8080/health` (proceso vivo) y `/ready` (chat disponible) |

El backend **no publica puerto propio**: nginx (contenedor `frontend`) sirve la UI y
reenvía `/api` y `/health` al backend por la red interna. Tampoco publican puertos
`postgres`, `qdrant` ni `kb-worker`. Así navegador y API comparten origen y no hay CORS
ni URLs de backend que configurar. Mientras no haya nada publicado, `/api/chat` responde 503.

`make up` se niega a arrancar, con un mensaje que dice qué correr, si falta `.env`, si
`AUTH_JWT_SECRET` no es válido o si falta alguna contraseña de base de datos.

### Apagar

```bash
make down
```

### Actualizar los datos más adelante

Es automático (corrida semanal). Para forzar una verificación ahora:
`make scrape && make kb CMD="sincronizar"` y, tras revisar `pendientes`,
`make kb CMD="publicar <código>…"`. Una reindexación completa sin cortar el chat:
`make kb CMD="sincronizar --completa --medir"` (el índice nuevo se construye aparte y el
alias se mueve de una vez; si falla, no cambia nada).

### Otros comandos

| Comando | Para qué |
| --- | --- |
| `make logs` / `make logs S=backend` | Seguir los logs de todo o de un servicio. |
| `make ps` | Estado y salud de los contenedores. |
| `make build` | Reconstruir las imágenes sin arrancar nada. |
| `make` | Lista de comandos. |

### Cómo está armado

| Archivo | Qué es |
| --- | --- |
| `docker-compose.yml` | Servicios `postgres` (base documental), `qdrant` (índice), `backend` (chat), `kb-worker` (único escritor de la base), `scraper` (programado con supercronic) y `frontend`. |
| `backend/Dockerfile` | Node 22 + tesseract, poppler y LibreOffice Writer. Usuario sin privilegios (UID 10001). |
| `frontend/Dockerfile` | Build de Next exportado a estáticos, servido por `nginx-unprivileged` en el 8080. |
| `web_scraper/Dockerfile` | Python 3.12 + Chromium + supercronic; `entrypoint.sh` valida `SCRAPER_CRON` y programa `main.py` sobre el volumen `/data`. |
| `.env.example` | Única plantilla de configuración, para Docker y para desarrollo local. |

Volúmenes: `geobot-data` (adquisición del scraper), `geobot-runs` (informes de corrida),
`geobot-pg` (PostgreSQL: matriz, versiones, verificaciones y auditoría), `geobot-qdrant`
(índice), `geobot-cache` (Markdown derivado y modelos ONNX) y `geobot-var` (registro de
interacciones y exportaciones). **No uses `docker compose down -v`**: borra la base
documental, el índice y los registros de 12 meses; habría que repetir `make scrape` y
volver a publicar.

Notas de operación:

- **Reutilizar una adquisición ya descargada.** Si el host ya tiene la carpeta de datos
  del scraper (p. ej. `backend/data`), apunta `DATA_DIR=./backend/data` en `.env`. El
  `kb-worker` solo procesa lo que aparece en un informe de corrida, así que hace falta
  una corrida (`make scrape`) para que lo registre. En Linux esa carpeta debe pertenecer
  al UID 10001 (`sudo chown -R 10001:10001 <ruta>`).
- **Detrás de otro proxy o balanceador** (TLS, dominio; en Dokploy, Traefik
  siempre lo es), apúntalo a `FRONTEND_PORT` y define `TRUST_PROXY=2` en `.env`
  (o en las variables de entorno de Dokploy), para que el límite de tasa siga
  viendo la IP real del cliente. Si el valor no coincide con la cadena real, el
  backend lo avisa una vez en el log con `[proxy]`. Revisa también que
  `CHAT_REQUEST_TIMEOUT_MS` quede por debajo del timeout de ese proxy.
- **Dónde queda cada cosa.** El contenido de cada versión vive en PostgreSQL (fuente de
  verdad) y el chat solo lee Qdrant a través del alias `kb_chunks`, más la vista
  `kb.v_codigos_publicados` con un rol de solo lectura. En Docker el backend escucha en
  el 4000 dentro de la red interna, no en el 3001 del desarrollo local.
- **Monitoreo y avisos.** Hay dos piezas, y hacen falta las dos:
  1. *Monitor externo* (Better Stack, UptimeRobot o similar, fuera de esta VM):
     un chequeo HTTP cada 1–3 min contra `https://<dominio>/ready`, que avise
     por correo o chat si no responde 200. Es lo único que detecta que la VM o
     el proceso entero se cayeron: el backend no puede avisar de su propia muerte.
     `/ready` responde 503 si el índice no está disponible o si ningún proveedor
     del enrutamiento automático tiene clave. No lo uses como healthcheck de
     Docker: durante una reconstrucción larga del índice, el orquestador
     reiniciaría el contenedor a medias (por eso Docker sigue usando `/health`).
  2. *Avisos de degradación*: se registran en el panel de administración y en la
     pantalla de estado, agrupando repeticiones. No salen por webhook, correo ni
     ningún otro canal externo (Constitución VI); los mismos eventos quedan como
     líneas de log sin texto ciudadano.

---

## 1b. Desarrollo local (sin Docker)

Requiere **Node.js 22**, Python ≥ 3.10 para el scraper y los binarios nativos del
preprocesamiento:

```bash
brew install tesseract tesseract-lang poppler   # OCR de PDF escaneados
brew install --cask libreoffice                  # conversión de .doc heredados
```

> Sin LibreOffice, los `.doc` fallan con `spawn soffice ENOENT` y quedan fuera del
> índice sin que nada lo anuncie. La imagen Docker ya incluye ambas dependencias.

```bash
# Corpus (una vez): ver web_scraper/README.md
cd web_scraper && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
playwright install chromium   # fuentes con render JS (envigado_com, gmas2_envigado)
python main.py --output ../backend/data --manual

# Backend
cd ../backend
npm install
cp ../.env.example .env      # solo si aún no existe; completa AUTH_JWT_SECRET y ≥1 API key
npm run kb -- migrar         # esquema de PostgreSQL (necesita KB_DATABASE_URL y Qdrant en QDRANT_URL)
npm run kb -- sincronizar --informe <informe.json> && npm run kb -- publicar --todos-pendientes
npm run dev                  # http://localhost:3001

# Frontend (otra terminal, desde la raíz del repo)
cd frontend
npm install
npm run dev                  # http://localhost:3000
```

Sin `AUTH_JWT_SECRET`, en desarrollo se usa un secreto efímero y se avisa por
consola; **en producción el servicio no arranca**. El frontend apunta por defecto a
`http://localhost:3001/api/chat`; para otro destino, define
`NEXT_PUBLIC_AGENT_API_URL` en `frontend/.env.local`.

---

## 2. Módulos

### Frontend (`frontend/`)

Interfaz del Bloque 4 (SPEC004): un launcher independiente (≤10 000 bytes) que abre un iframe `/chat`;
todo el estado es volátil y vive en la memoria del iframe.

| Archivo | Qué hace |
| --- | --- |
| `widget/launcher.ts`, `widget/protocol.ts` | Botón fijo inferior derecho que crea **un** iframe al primer clic; geometría (<768 px completa, ≥768 px 400 × min(640, 85 %)), foco/modal móvil y protocolo `postMessage` v1 sin datos de conversación. Se compila con `npm run build:widget` a `public/embed/geobot-launcher.js`. |
| `app/chat/page.tsx`, `chat/ChatPanel.tsx` | Ruta del iframe y panel (encabezado con logo, transcripción, estado, fallo, valoración, diálogo de nueva conversación). `smart/SmartAgentPanel.tsx` solo delega en él. |
| `chat/ChatContext.tsx`, `sessionReducer.ts`, `queryAttempt.ts`, `feedbackState.ts`, `contactState.ts` | Estado único: arranque (apertura → decisión → categoría), un intento activo con reloj de 45 s y máximo 2 reintentos manuales, epoch de reinicio, valoración por respuesta y contactos con tope de 5 s. |
| `shared/chatClient.ts`, `feedbackClient.ts`, `session.ts` | Cliente del contrato en español; el token técnico vive solo en memoria y **nunca** se reenvía tras un 401. |
| `shared/markdownRenderer.tsx`, `ExternalLink.tsx` | Markdown → React por lista blanca (AST con `remark`), sin HTML bruto; enlaces solo `https`, `target=_blank`, `rel="noopener noreferrer"`. |
| `scripts/build-widget.mjs`, `build-csp.mjs` | Construye el launcher (falla si >10 000 bytes) y genera la CSP de `/chat` con hashes y `frame-ancestors` del Observatorio. |
| `app/` | Next.js (App Router) exportado estático y servido por nginx. |

Guía de instalación en el portal: `specs/004-interfaz-plataforma/integracion-portal.md`.

### Backend — entrada y rutas (`backend/src/`)

| Archivo | Qué hace |
| --- | --- |
| `index.ts` | Arranque Express: helmet, CORS por lista blanca, límite de cuerpo de 64 KB, precalentado del índice con reintentos y apagado ordenado ante SIGTERM. |
| `routes/auth.ts` | Emite sesiones anónimas y aporta los middlewares `requireSession` y límite de tasa por identidad (con IP como reserva). |
| `routes/chat.ts` | Valida la entrada, comprueba el estado del índice y delega en el orquestador de `chat/` y traduce su desenlace a códigos HTTP. Cuota: 20 consultas/minuto. |
| `prompts/tutorPrompt.ts` | Prompt del sistema: obliga a citar y a reconocer evidencia insuficiente. |

### Backend — orquestación de la respuesta (`backend/src/services/`)

| Archivo | Qué hace |
| --- | --- |
| `contextBudget.ts` | Puntúa la complejidad de la pregunta y decide cuánto contexto previo arrastrar. |
| `pii.ts` | Enmascara cédulas, NIT, correos, teléfonos y matrículas antes de escribir al registro (Ley 1581 de 2012). Calibrado para **no** enmascarar cifras normativas ni presupuestales. |
| `config.ts` / `settings.ts` | Declaración única y lectura validada de toda la configuración numérica: un valor inválido avisa por consola y cae al defecto, nunca aborta el arranque. |
| `auth.ts` | Firma y verificación de los JWT de sesión. |

### Backend — recuperación e indexación (`backend/src/services/`)

| Archivo | Qué hace |
| --- | --- |
| `documentPreprocessor.ts` | Extracción nativa a Markdown: DOCX/DOC vía LibreOffice, PDF con capa de texto, hojas de cálculo a tablas por hoja. El OCR vive en `kb/ocr.ts`. |
| `chunking.ts` | Fragmentación consciente de la estructura: respeta artículos, encabezados y tablas, descarta frontmatter y conserva el número de página de cada fragmento. |
| `embeddings.ts` | Embeddings locales `multilingual-e5-small` (384 dim) vía Transformers.js. Sin API key ni envío de documentos a terceros. |
| `retrievalMath.ts` | BM25, coseno y Reciprocal Rank Fusion — la matemática pura, aislada y testeable. |
| `search.ts` | La búsqueda híbrida sobre Qdrant (vector denso + BM25 disperso, fusión RRF) vía el alias `kb_chunks`; vigila el cambio de colección. |
| `qdrant.ts` | Cliente de Qdrant y resolución del alias. |
| `reranker.ts` | Cross-encoder que reordena los candidatos. Es el ~82 % del tiempo de una consulta; `RERANK_INTRA_OP_THREADS` es su única palanca real. |
| `retrievalWorker.ts` / `retrievalClient.ts` / `workerEntry.ts` | La recuperación corre en un `worker_thread` para no bloquear el bucle de eventos; el cliente mantiene la cola, el estado y rechaza con 503 + `Retry-After` al saturarse. |
| `sourceMetadata.ts` | Enriquece cada fuente con título, URL original, página de origen y categoría desde `metadata/*.csv`. Esos CSV no se indexan. |
| `context.ts` | Raíz de documentos configurada. |

### Base de conocimiento (`backend/src/kb/`, proceso `kb-worker`)

| Archivo | Qué hace |
| --- | --- |
| `worker.ts` / `ciclo.ts` | Proceso de larga duración: migra el esquema, vigila los informes de corrida, avisa si la verificación semanal se atrasa y purga la retención una vez al día. |
| `sync.ts` / `scope.ts` / `config.ts` | Procesan un informe de corrida: aplican las reglas de alcance y de dirección, crean versiones pendientes, marcan derogados y avisan de errores sin perder lo validado. |
| `conversion.ts` / `ocr.ts` / `blankForms.ts` / `fichas.ts` | Conversión a Markdown con OCR de confianza medida (Tesseract), control de formatos en blanco y fichas de 10 campos. |
| `service.ts` / `cli.ts` | Operaciones del administrador (publicar, reconstruir la colección, auditar el alcance, notificaciones) y su CLI `make kb CMD=…`. |
| `indexer.ts` / `sparse.ts` | Fragmentos, vectores densos y BM25 propios, y escritura en Qdrant con alias atómico. |
| `exportMatrix.ts` / `retention.ts` / `vigilante.ts` | Exportación de la matriz a .xlsx, retención de 12 meses y vigilante de la corrida semanal. |
| `db.ts` / `audit.ts` / `notifications.ts` | PostgreSQL (rol `kb_writer`), auditoría de acciones y avisos agrupados. |

### Backend — bloque 2 (`backend/src/`)

| Módulo | Responsabilidad |
| --- | --- |
| `bedrock/` | Cliente y adaptador Converse (`maxTokens 2200`, `temperature 0`, sin reintentos ocultos). |
| `chat/` | Contratos, validación, orquestación, plazo único desde la recepción (`requestContext`, `deadline`), recepción y perímetro (`reception`, `perimeter`), escritura acotada a PostgreSQL (`boundedDb`), episodios de falla del registro (`registryEpisode`), enrutamiento de modelos, composición con citas, límite de 2200 tokens, tarifas, registro, conversaciones y purga. |
| `admin/` | Contraseñas argon2id, sesiones, contactos con control de revisión, auditoría y estado/avisos operativos. |
| `routes/` | `chat`, `chatConfig`, `conversations`, `adminAuth`, `adminContacts`, `adminOperations`, `health`. |
| `prompts/` | Prompt único versionado y textos institucionales fijos. |

La inferencia es solo Amazon Bedrock. Los adaptadores por proveedor (Gemini, Groq, DeepSeek, OpenAI,
Ollama), `llm.ts`, `providerRouter.ts`, `answerQuestion.ts` y `chatLog.ts` se retiraron del árbol; `chatTraffic.ts`
conserva la cola de admisión y la corrección de «carnet» vive en `chat/textFixes.ts`.

**Integración C3–C4 (SPEC005).** Resumen de lo vigente (detalle en `docs/arquitectura-sistema.md`, «Bloque 5»):

- **Perímetro**: origen HTTPS exacto obligatorio (sin `Origin` → 403) y preflight validado antes de CORS; cuota de 60 consultas/min/IP solo para `POST /api/chat`; cuerpo ≤128 KiB; `no-store` en todas las rutas del chat y en los errores de nginx.
- **Identidad**: Bedrock con el **rol de la instancia** (`fromInstanceMetadata`, IMDSv2); la readiness rechaza llaves, perfiles, procesos, bearer keys y metadatos alternos. Política: `backend/config/iam-bedrock-policy.json` (`npm run check:iam`).
- **Proxies**: `TRUST_PROXY` es un número de saltos o una lista exacta de IP/CIDR; no admite «confiar en todos».
- **Plazo**: 40 s desde la recepción hasta el error terminal; escritura acotada; un COMMIT no confirmado a tiempo no emite `responseId`.
- **Registro**: un aviso por episodio de falla (fecha, hora, modo), recuperación al primer éxito; la purga conserva fuentes citadas y valoraciones.

### Scripts de calibración (`backend/scripts/`)

| Comando | Para qué |
| --- | --- |
| `npm run bench:rerank` | Encuentra el óptimo de `RERANK_INTRA_OP_THREADS` en la máquina de despliegue. |
| `npm run bench:retrieval` / `bench:stages` / `bench:worker` | Latencia total, por etapa y bloqueo del hilo principal. |
| `npm run eval:retrieval` | recall@8, MRR y nDCG@8 contra el conjunto dorado; `--sweep` calibra `MIN_RERANK_SCORE`. |
| `npm run golden:candidates` / `golden:finalize` | Arman el conjunto dorado a partir de preguntas reales. |
| `npm run baseline:capture` / `baseline:check` | Detectan regresiones de recuperación frente a una línea base guardada. |
| `npm run extraction:gaps` | Triaje de documentos que no aportaron texto, agrupados por motivo. |

### Procesos auxiliares (fuera del backend)

- **`web_scraper/`** (Python) — adquisición de las 4 fuentes del bloque 1 (GMAS2 con sus
  6 GT-P, Ambientómetro, Envigado.gov.co y Observatorio Geotrends). Corre solo cada
  semana, deduplica por SHA-256 y entrega un **informe de corrida** JSON al `kb-worker`.
  Es **offline**: el chat nunca lo llama. Ver `web_scraper/README.md`.
- **`rag_tester/`** (Python + Playwright) — bot que recorre un banco de preguntas
  contra la UI real para cada proveedor y vuelca los resultados a CSV.
- **`docs/arquitectura-sistema.md`** — diagramas Mermaid de componentes y flujos.
  `docs/DOCUMENTACION-HANDOFF.md` describe una versión **anterior** del sistema.

---

## 3. Cómo se recupera la evidencia

1. **Preprocesar** cada archivo a Markdown (OCR local solo si el texto extraído es insuficiente).
2. **Fragmentar**: ≤ 1.000 caracteres (contexto incluido) con 150 de solapamiento ± una palabra, cortes solo entre palabras y cada tabla Markdown íntegra en un fragmento; una tabla o palabra de más de 1.000 hace no publicable al documento.
3. **BM25** (`k1=1.2`, `b=0.75`) sobre términos normalizados del texto, la ruta, el título y la categoría.
4. **Búsqueda vectorial** exacta por coseno con embeddings E5 locales, independiente de BM25.
5. **RRF** fusiona los 40 primeros de cada lista: `score = Σ 1/(60 + posición)`.
6. **Reranker** cross-encoder sobre un máximo de 16 candidatos (`RERANK_CANDIDATES`).
7. **Umbral y abstención**: solo pasan los fragmentos con puntaje **estrictamente mayor** que el umbral de la calibración vigente de la colección servida; si no queda ninguno se responde «No encontré información validada…» sin llamar al modelo. Con el reranker caído se entregan los 8 mejores de RRF, sin umbral.
8. **Selección**: hasta 8; preferencia de `RETRIEVAL_MAX_PER_DOCUMENT` (3) por documento, salvo que solo uno sirva; los casi duplicados (Jaccard ≥ 0,6) se descartan y no vuelven por relleno: si faltan alternativas se entregan menos.
9. Se envían a Bedrock la pregunta, los fragmentos y hasta 10 pares de historial, ya sin datos personales.

El índice se persiste en `backend/.cache/retrieval` y los Markdown derivados en
`backend/.cache/documents`; ambos están fuera de Git. Un cambio en ruta, tamaño,
fecha o versión del preprocesador recalcula **solo** ese documento.

---

## 4. API

Contrato completo en `specs/002-diseno-modelo-ia/contracts/chat-api.md` y `admin-api.md`.

```http
POST /api/session                     → { "token": "...", "expiresIn": 3600 }     (acceso técnico, no consentimiento)
GET  /api/chat/config                 → apertura, política (versión/URL), Autorizo / No autorizo y contactos

POST /api/conversations               { "autorizacion": true, "policyVersion": "..." }
                                      → 201 { "modo": "conversación", "conversationId": "<UUID del backend>" }

POST /api/chat
Authorization: Bearer <token>
{"pregunta":"¿Qué requisitos tiene el RUM?",
 "conversationId":"<UUID, solo con autorización>",
 "categoria":"Ecosistemas",
 "historial":[{"pregunta":"…","respuesta":"…"}]}
```

Solo `pregunta` es obligatoria (sin límite de caracteres: el tope es el cuerpo, 128 KiB). Sin
`conversationId` la consulta es **anónima y autónoma** (no admite `historial`). No existe
selección de modelo ni de proveedor: cualquier campo desconocido se rechaza con 400.

Respuesta 200: `{ modo, conversationId?, responseId?, tipo, respuesta, fuentes[] }` con `tipo` en
`respondida | sin información | fuera de alcance | aclaración`. Errores:
`{ "error": { "codigo", "mensaje", "campo?" }, "canales": [...] }` con `VALIDACION` (400),
`SERVICIO_NO_DISPONIBLE` (503), `ERROR_INTERNO` (500), `LIMITE_SOLICITUDES` (429, con
`Retry-After`), `CUERPO_EXCESIVO` (413) u `ORIGEN_NO_PERMITIDO` (403).

| Endpoint | Descripción |
| --- | --- |
| `GET /api/retrieval/status` | Por el proxy público: `{ok}`. Desde el contenedor: estado del índice y ocupación de la cola. |
| `GET /health` | Vivacidad del proceso. Sin token. Lo usa el healthcheck de Docker. |
| `GET /ready` | 200 solo con índice y calibración vigentes, configuración válida, tokenizador con la huella fijada, contactos completos y tarifas de ambos modelos; si no, 503. Por el proxy público responde solo `{ready}`; la lista de lo que falta sale desde el contenedor: `docker compose exec backend wget -qO- http://127.0.0.1:4000/ready`. |
| `/api/admin/*` | Panel: sesión, contraseña, contactos, estado y avisos. Cookie `HttpOnly`, CSRF y dos perfiles (técnico / Gestor documental). |

La protección contra abuso es una ventana deslizante de 60 solicitudes por minuto por IP (con el
proxy confiable), un cuerpo máximo de 128 KiB y un plazo único de 40 s por consulta. No sustituyen
un CDN/WAF ante un DDoS volumétrico distribuido.

---

## 5. Configuración esencial

`.env.example` (en la raíz) documenta cada variable con la medición que justifica
su valor. Las imprescindibles:

| Variable | Para qué |
| --- | --- |
| `AUTH_JWT_SECRET` | Firma de las sesiones; ≥32 caracteres. **Obligatoria en producción**; en desarrollo se usa un secreto efímero y avisa. |
| `GEOTRENDS_DOCUMENTS_ROOT` | Raíz del corpus (por defecto `data`). |
| `PORT` | Puerto del backend en local (usa `3001` para casar con el frontend). En Docker lo fija `docker-compose.yml`. |
| `ALLOWED_ORIGINS` | Orígenes CORS permitidos. Vacío = ninguno cruzado. |
| `TRUST_PROXY` | Necesaria tras un proxy inverso para que el límite de tasa vea la IP real. |
| `CHAT_RATE_LIMIT_PER_MINUTE`, `CHAT_MAX_BODY_BYTES`, `CHAT_ALLOWED_ORIGINS` | Perímetro del chat: 60/min/IP, 131072 bytes y orígenes permitidos (obligatorio: sin orígenes no hay readiness). |
| `CONSENT_POLICY_VERSION`, `CONSENT_POLICY_URL` | Política de datos municipal vigente; sin ellas el chat no se declara listo. |
| `BEDROCK_REGION`, `BEDROCK_MODEL_20B`, `BEDROCK_MODEL_120B` | Región y modelos permitidos (solo `us-east-1` y los dos IDs exactos). |
| `AUTH_SESSION_HOURLY_PER_IP_LIMIT` | Sesiones anónimas nuevas por IP y hora (defecto 150). |
| `CHAT_MAX_CONCURRENT`, `CHAT_MAX_QUEUE`, `CHAT_QUEUE_TIMEOUT_MS` | Capacidad y espera máxima de la cola completa del chat. |
| `CHAT_DEADLINE_MS` | Plazo único de una consulta (cola + recuperación + modelos + escritura); techo 40 000 ms. |
| `POSTGRES_PASSWORD`, `KB_DB_PASSWORD`, `APP_DB_PASSWORD`, `CHAT_DB_PASSWORD`, `ADMIN_DB_PASSWORD`, `MAINT_DB_PASSWORD` | Contraseñas de la base: administrador, escritor de la KB, lector de la KB, chat, panel y mantenimiento (purga). **Obligatorias.** |
| `SCRAPER_CRON`, `SCRAPER_SOURCES` | Programación del scraper (domingo 02:00) y fuentes a recorrer. |
| `KB_RETENCION_MESES`, `KB_SONDEO_MS`, `KB_UMBRAL_ESTRUCTURA` | Retención de registros (≥ 12), sondeo de informes y umbral de cambio de estructura de una página. |
| `OCR_ENABLED`, `OCR_LANGUAGE`, `OCR_MIN_TEXT_CHARS`, `OCR_MIN_CONFIDENCE` | Control del OCR local: umbral de caracteres nativos (80) y confianza media mínima (80, no baja de ahí). |

Al arrancar, el backend imprime qué variables vienen del entorno y cuáles usan su
valor por defecto.

---

## 6. Verificación

```bash
cd backend
npm run typecheck            # src/, test/ y scripts/
npm test                     # suite unitaria (node --test)
npm run test:di-integration  # bloque 2 contra PostgreSQL y Qdrant reales (ver abajo)
npm run test:kb-integracion  # bloque 1
npm run eval:tokenizer       # paridad de IDs con el oráculo oficial (offline)
npm run build

cd ../frontend
npm run typecheck
npm test                     # pruebas heredadas (consentimiento, flujo, enlaces)
npm run test:ui              # SPEC004: estado, cliente 45 s, renderer, valoración (Vitest)
npm run build:widget         # launcher ≤10 000 bytes
npm run build:e2e && npm run test:ui:e2e   # export real + host fixture + axe (Playwright)
npm run build
cd ../backend && npm run test:ui-integration   # valoración, contactos y privacidad (PostgreSQL real)
npm run test:in-integration  # SPEC005: recepción, plazo, registro, privacidad, identidad, caché (nginx en Docker), capacidad, informe
npm run check:iam -- config/iam-bedrock-policy.json   # contrato IAM de una acción y dos ARN
npm run scan:secrets         # conteos y rutas de patrones de credenciales (sin valores)
npm run report:in            # informe de 31 casos desde RESULTADOS de corridas (no desde archivos)
```

`test:di-integration` y `test:kb-integracion` necesitan PostgreSQL y Qdrant de prueba
(`docker run -d -e POSTGRES_USER=geobot_admin -e POSTGRES_PASSWORD=dev-admin -e POSTGRES_DB=geobot_test -p 127.0.0.1:55432:5432 postgres:16`
y `docker run -d -p 127.0.0.1:56333:6333 qdrant/qdrant:v1.19.2-unprivileged`; o `KB_TEST_ADMIN_URL` y
`QDRANT_URL`). Usan los modelos locales reales y un Bedrock **simulado** (`adapter=double`): no
tocan AWS y **no cuentan como aceptación**. La aceptación real (matriz, tráfico, carga) se ejecuta
con `npm run eval:di`, `eval:di-traffic` y `eval:di-load`; ver `specs/002-diseno-modelo-ia/quickstart.md`.
La de SPEC005 (dos días reales, 180 muestras del anfitrión, IAM y dispositivos reales) usa
`eval:di-load`, `eval:di-host` y `eval:injection --adapter=aws`; ver `specs/005-integracion-c3-c4/quickstart.md`.

---

## 7. Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| `/api/chat` responde 503 | Todavía no hay nada publicado o Qdrant no responde. Consulta `GET /api/retrieval/status` y `make kb CMD="estado"`. |
| El servicio no arranca en producción | Falta `AUTH_JWT_SECRET`, o tiene menos de 32 caracteres. |
| Documentos `.doc` ausentes del índice | LibreOffice no está instalado (`spawn soffice ENOENT`). |
| PDF escaneados sin texto | Falta `tesseract`/`pdftoppm`, o la confianza media del OCR no supera 80 (se descarta y se notifica; típico de un manuscrito: Tesseract no lee letra a mano). |
| 503 con `Retry-After` | Cola de recuperación saturada; ajusta `RETRIEVAL_MAX_QUEUE`. |
| Consultas muy lentas | Calibra el reranker con `npm run bench:rerank` y `RERANK_CANDIDATES`. |
| El frontend no conecta (local) | `NEXT_PUBLIC_AGENT_API_URL` y `PORT` no coinciden. |
| La UI muestra backend caído (Docker) | El backend sigue arrancando o se reinició; revisa `make ps` y `make logs S=backend`. |
| Nada nuevo se recupera tras una corrida | Lo nuevo queda pendiente hasta publicarlo: `make kb CMD="pendientes"` y `publicar`. |
| Avisos de verificación o de OCR | `make kb CMD="notificaciones"`; al atenderlos, `revisar <id>`. |

Solo el `kb-worker` escribe en la base y en Qdrant; no lances otro proceso escritor.

## Validación SPEC006

Herramientas privadas offline para matrices C3/C4, congelamiento humano, corridas completas, revisiones, hallazgos y expedientes H5-C3/H4-C4. [Guía operativa](specs/006-validacion-pruebas/quickstart.md) y [evidencia local](specs/006-validacion-pruebas/evidencias/aceptacion/integracion-local.md). No añaden endpoints ciudadanos.

Pruebas aisladas autorizadas:

```sh
docker compose -p spec006-validation -f docker-compose.validation.yml build validation
docker compose -p spec006-validation -f docker-compose.validation.yml run --rm validation npm run test:validation-integration
docker compose -p spec006-validation -f docker-compose.validation.yml down
```

La imagen `agente-spec006-validation:local` incluye OCR y modelos locales de recuperación en caché. PostgreSQL/Qdrant son temporales, red interna sin puertos publicados ni corpus operativo; proveedor AWS doble. Los ensayos no acreditan matrices aprobadas, pruebas físicas, carga real ni firmas contractuales.
