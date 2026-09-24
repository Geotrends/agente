# Geobot — asistente documental con búsqueda híbrida

Chat público sobre un corpus documental local (normativa y documentos técnicos del
Observatorio Ambiental de Envigado). Responde solo con evidencia recuperada de los
documentos, cita sus fuentes y se abstiene cuando no encuentra respaldo suficiente.

El usuario puede elegir cualquier modelo del catálogo configurado (Gemini, Groq,
DeepSeek, OpenAI u Ollama) o dejar el **enrutamiento automático**, que escoge
proveedor y modelo según la complejidad de la pregunta y cae a un respaldo si el
principal falla.

---

## 1. Puesta en marcha (Docker)

Todo se opera desde la raíz del repo con `make`. Los datos, el índice y el registro
de interacciones viven en volúmenes Docker y sobreviven a reinicios y a `make down`.

### Requisitos

- Docker y Docker Compose v2 (`docker compose version`), y `make`.
- Máquina con **≥ 8 GB de RAM** asignados a Docker (el índice vive en memoria) y
  **≥ 25 GB libres** (corpus ~13 GB + caché ~4 GB + imágenes).
- Configuración:

  ```bash
  cp .env.example .env
  openssl rand -base64 48     # pégalo en AUTH_JWT_SECRET
  ```

  Obligatorio en `.env`: `AUTH_JWT_SECRET` (≥ 32 caracteres) y **al menos una**
  API key de proveedor (`GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY` u
  `OPENAI_API_KEY`). El resto ya trae valores por defecto.

### Primera vez (o cuando quieran refrescar los datos)

```bash
make scrape   # 1. descarga el corpus de las 4 fuentes públicas
make cache    # 2. preprocesa (OCR incluido) e indexa ese corpus
```

- `make scrape` **tarda horas** (≈13 GB; una sola fuente puede llevar más de una
  hora) y no pide credenciales. Mientras avanza imprime una línea por URL: si la
  consola sigue escribiendo, no está colgado. Para una prueba corta:
  `make scrape ARGS="--max-pages 20"`.
- `make cache` también **puede tardar horas** la primera vez (OCR de PDF escaneados
  y embeddings locales). Las siguientes veces solo reprocesa los documentos nuevos o
  modificados. Detiene el backend mientras corre: indexador y backend no deben
  escribir la misma caché a la vez.

### Arranque normal (todas las veces siguientes)

```bash
make up       # 3. levanta backend + frontend
```

| Qué | Dónde |
| --- | --- |
| Aplicación (UI) | `http://localhost:8080` (`FRONTEND_PORT` en `.env`) |
| API | `http://localhost:8080/api/...` — p. ej. `/api/retrieval/status` |
| Salud del backend | `http://localhost:8080/health` |

El backend **no publica puerto propio**: nginx (contenedor `frontend`) sirve la UI y
reenvía `/api` y `/health` al backend por la red interna. Así navegador y API
comparten origen y no hay CORS ni URLs de backend que configurar. Tras `make up`, el
índice tarda unos segundos en cargar; hasta entonces `/api/chat` responde 503.

`make up` se niega a arrancar, con un mensaje que dice qué correr, si falta `.env`,
si `AUTH_JWT_SECRET` no es válido, si el corpus está vacío o si falta el índice.

### Apagar

```bash
make down
```

### Actualizar los datos más adelante

```bash
make scrape && make cache && make up
```

El scraper es incremental (deduplica por SHA-256) y el indexador solo recalcula lo
que cambió.

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
| `docker-compose.yml` | Servicios `backend` y `frontend`; `scraper` e `indexer` bajo el profile `setup`, fuera del arranque normal. |
| `backend/Dockerfile` | Node 22 + tesseract, ocrmypdf y LibreOffice Writer. Usuario sin privilegios (UID 10001). |
| `frontend/Dockerfile` | Build de Next exportado a estáticos, servido por `nginx-unprivileged` en el 8080. |
| `web_scraper/Dockerfile` | Python 3.12 + Chromium con el scraper; ejecuta `main.py` sobre el volumen `/data`. |
| `.env.example` | Única plantilla de configuración, para Docker y para desarrollo local. |

Volúmenes: `geobot-data` (corpus), `geobot-cache` (índice, Markdown derivado y modelos
ONNX) y `geobot-var` (registro de interacciones). **No uses `docker compose down -v`**:
borra el corpus y el índice, y habría que repetir `make scrape` y `make cache`.

Notas de operación:

- **Reutilizar un corpus ya descargado.** Si el host ya tiene el corpus (p. ej.
  `backend/data`), apunta `DATA_DIR=./backend/data` en `.env` y sáltate
  `make scrape`. `make cache` sí hay que correrlo: las claves de la caché
  incluyen la ruta absoluta del corpus, que dentro del contenedor es otra
  (`/app/data`), así que una caché de fuera de Docker no se reutiliza. En Linux
  esa carpeta debe pertenecer al UID 10001 (`sudo chown -R 10001:10001 <ruta>`)
  para que el scraper pueda escribir en ella.
- **Detrás de otro proxy o balanceador** (TLS, dominio), apúntalo a
  `FRONTEND_PORT` y define `TRUST_PROXY=2` en `.env`, para que el límite de tasa
  siga viendo la IP real del cliente.
- **Diferencias con el procedimiento anterior.** El "script de caché" no es un
  proceso aparte: es el indexador del propio backend (`npm run index`, que en la
  imagen se ejecuta como `node dist/indexDocuments.js`). En Docker el backend
  escucha en el 4000 dentro de la red interna, no en el 3001 del desarrollo local.

---

## 1b. Desarrollo local (sin Docker)

Requiere **Node.js 22**, Python ≥ 3.10 para el scraper y los binarios nativos del
preprocesamiento:

```bash
brew install tesseract tesseract-lang ocrmypdf   # OCR de PDF escaneados
brew install --cask libreoffice                  # conversión de .doc heredados
```

> Sin LibreOffice, los `.doc` fallan con `spawn soffice ENOENT` y quedan fuera del
> índice sin que nada lo anuncie. La imagen Docker ya incluye ambas dependencias.

```bash
# Corpus (una vez): ver web_scraper/README.md
cd web_scraper && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
playwright install chromium   # fuentes con render JS (envigado_com, gmas2_envigado)
python main.py --output ../backend/data

# Backend
cd ../backend
npm install
cp ../.env.example .env      # solo si aún no existe; completa AUTH_JWT_SECRET y ≥1 API key
npm run index                # construye el índice (la primera vez tarda)
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

| Archivo | Qué hace |
| --- | --- |
| `smart/SmartAgentPanel.tsx` | Panel de chat completo: selector único proveedor+modelo, historial, estado del índice y lista de fuentes de la última respuesta. |
| `shared/session.ts` | Pide y renueva el JWT anónimo contra `POST /api/session`. El token vive **solo en memoria** y se reintenta una vez ante un 401. |
| `shared/agentConfig.ts` | Resuelve la URL del API y el mensaje de backend caído. |
| `shared/ChatMarkdown.tsx`, `MessageContent.tsx` | Render del Markdown de la respuesta y de las citas enlazadas. |
| `app/` | Cascarón Next.js 14 (App Router): layout, página única y estilos globales. |

### Backend — entrada y rutas (`backend/src/`)

| Archivo | Qué hace |
| --- | --- |
| `index.ts` | Arranque Express: helmet, CORS por lista blanca, límite de cuerpo de 64 KB, precalentado del índice con reintentos y apagado ordenado ante SIGTERM. |
| `routes/auth.ts` | Emite sesiones anónimas y aporta los middlewares `requireSession` y límite de tasa por identidad (con IP como reserva). |
| `routes/chat.ts` | Valida la entrada, comprueba el estado del índice y traduce el desenlace de `answerQuestion` a códigos HTTP. Cuota: 20 consultas/minuto. |
| `prompts/tutorPrompt.ts` | Prompt del sistema: obliga a citar y a reconocer evidencia insuficiente. |

### Backend — orquestación de la respuesta (`backend/src/services/`)

| Archivo | Qué hace |
| --- | --- |
| `answerQuestion.ts` | El pipeline completo de una consulta: contexto previo → recuperación → abstención → armado del contexto → proveedor → registro. No toca HTTP. |
| `providerRouter.ts` | Enrutamiento automático por complejidad (simple/medio/complejo) con proveedor de respaldo configurable. |
| `contextBudget.ts` | Puntúa la complejidad de la pregunta y decide cuánto contexto previo arrastrar. |
| `llm.ts` | Fachada única sobre los adaptadores; aplica el presupuesto total de la cadena de fallback. |
| `chatLog.ts` | Registro CSV de interacciones en `backend/var/`, fuera del árbol de documentos, con purga por retención. |
| `pii.ts` | Enmascara cédulas, NIT, correos, teléfonos y matrículas antes de escribir al registro (Ley 1581 de 2012). Calibrado para **no** enmascarar cifras normativas ni presupuestales. |
| `config.ts` / `settings.ts` | Declaración única y lectura validada de toda la configuración numérica: un valor inválido avisa por consola y cae al defecto, nunca aborta el arranque. |
| `auth.ts` | Firma y verificación de los JWT de sesión. |

### Backend — recuperación e indexación (`backend/src/services/`)

| Archivo | Qué hace |
| --- | --- |
| `documentPreprocessor.ts` | Convierte cada archivo a Markdown: DOCX/DOC vía LibreOffice, PDF con OCR bajo demanda, hojas de cálculo a tablas por hoja. Clasifica por qué un documento no aporta texto. |
| `chunking.ts` | Fragmentación consciente de la estructura: respeta artículos, encabezados y tablas, descarta frontmatter y conserva el número de página de cada fragmento. |
| `embeddings.ts` | Embeddings locales `multilingual-e5-small` (384 dim) vía Transformers.js. Sin API key ni envío de documentos a terceros. |
| `retrievalMath.ts` | BM25, coseno y Reciprocal Rank Fusion — la matemática pura, aislada y testeable. |
| `search.ts` | El índice: caché por documento, revalidación en segundo plano y la búsqueda híbrida de extremo a extremo. |
| `reranker.ts` | Cross-encoder que reordena los candidatos. Es el ~82 % del tiempo de una consulta; `RERANK_INTRA_OP_THREADS` es su única palanca real. |
| `indexSnapshot.ts` | Volcado binario del índice para arrancar en <1 s en vez de ~92 s. Artefacto desechable: si falta o no coincide la firma, se reconstruye. |
| `retrievalWorker.ts` / `retrievalClient.ts` / `workerEntry.ts` | La recuperación corre en un `worker_thread` para no bloquear el bucle de eventos; el cliente mantiene la cola, el estado y rechaza con 503 + `Retry-After` al saturarse. |
| `sourceMetadata.ts` | Enriquece cada fuente con título, URL original, página de origen y categoría desde `metadata/*.csv`. Esos CSV no se indexan. |
| `context.ts` | Listado de documentos de la raíz configurada. |

### Backend — proveedores (`backend/src/`)

`gemini/`, `groq/`, `deepseek/`, `openai/`, `ollama/` — un adaptador por proveedor.
Los compatibles con OpenAI comparten `shared/openAiCompatible.ts`; `shared/retry.ts`
reintenta solo lo reintentable (red, 5xx, 429) y `shared/providerModel.ts` impone que
el modelo pedido pertenezca al catálogo `*_MODELS` del proveedor.

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

- **`web_scraper/`** (Python) — adquisición del corpus. Crawler multi-fuente
  (Ambientómetro, Concejo de Envigado, MinAmbiente, MinAgricultura) con filtrado
  determinista, deduplicación por SHA-256 y generación de `metadata/*.csv`.
  Es **offline**: el chat nunca lo llama. Ver `web_scraper/README.md`.
- **`rag_tester/`** (Python + Playwright) — bot que recorre un banco de preguntas
  contra la UI real para cada proveedor y vuelca los resultados a CSV.
- **`docs/arquitectura-sistema.md`** — diagramas Mermaid de componentes y flujos.
  `docs/DOCUMENTACION-HANDOFF.md` describe una versión **anterior** del sistema.

---

## 3. Cómo se recupera la evidencia

1. **Preprocesar** cada archivo a Markdown (OCR local solo si el texto extraído es insuficiente).
2. **Fragmentar** respetando la estructura: ~1.000 caracteres con 150 de solapamiento, sin partir tablas ni artículos.
3. **BM25** (`k1=1.2`, `b=0.75`) sobre términos normalizados del texto, la ruta, el título y la categoría.
4. **Búsqueda vectorial** exacta por coseno con embeddings E5 locales, independiente de BM25.
5. **RRF** fusiona los 40 primeros de cada lista: `score = Σ 1/(60 + posición)`.
6. **Reranker** cross-encoder sobre los mejores candidatos (`RERANK_CANDIDATES`).
7. **Umbral y abstención**: por debajo de `MIN_RERANK_SCORE` el fragmento se descarta; si no queda ninguno, se responde sin llamar a ningún proveedor (`meta.abstained = true`).
8. **Diversificación**: máximo `RETRIEVAL_MAX_PER_DOCUMENT` fragmentos por documento y deduplicación por Jaccard.
9. Se envían los fragmentos, sus rutas y el historial al proveedor elegido.

El índice se persiste en `backend/.cache/retrieval` y los Markdown derivados en
`backend/.cache/documents`; ambos están fuera de Git. Un cambio en ruta, tamaño,
fecha o versión del preprocesador recalcula **solo** ese documento.

---

## 4. API

Toda llamada a `/api/chat` requiere un JWT emitido por el propio backend.

```http
POST /api/session            → { "token": "...", "expiresIn": 3600 }

POST /api/chat
Authorization: Bearer <token>
Content-Type: application/json

{"message":"¿Qué medidas se describen para controlar el ruido?",
 "provider":"groq","model":"llama-3.1-8b-instant","history":[]}
```

Solo `message` es obligatorio (1–2.500 caracteres). Sin `provider`, o con `auto`,
el enrutamiento es automático y **no debe enviarse `model`**. En selección manual,
`model` debe pertenecer al catálogo `*_MODELS` del proveedor.

La respuesta trae `answer` y `meta` con `provider`, `model`, `routingReason`,
`retrieval` (método, documentos, fragmentos), `sources` (consolidadas por documento,
con las páginas citadas) y `abstained`.

| Endpoint | Descripción |
| --- | --- |
| `GET /api/providers` | Proveedores, si están configurados, catálogo y modelo por defecto. Sin secretos. |
| `GET /api/retrieval/status` | Progreso y estado del índice, ocupación de la cola y límite público de caracteres. |
| `GET /health` | Vivacidad del proceso. Sin token y fuera del límite de tasa. |

**Códigos 503** — índice no disponible, índice construyéndose, saturación
(con cabecera `Retry-After`) o fallo de todos los proveedores.

**Códigos 429** — cuota diaria global o por IP agotada, o bloqueo temporal por
exceso de preguntas largas. Incluyen `Retry-After` y un `code` estable.

La cola y las cuotas protegen CPU, proveedores y presupuesto frente a abuso en
la capa de aplicación. No sustituyen un CDN/WAF o la mitigación del proveedor
de red ante un DDoS volumétrico distribuido.

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
| `CHAT_MAX_MESSAGE_CHARS`, `CHAT_DAILY_*`, `CHAT_LONG_*` | Tamaño de pregunta, cuotas diarias y bloqueo por consultas largas. |
| `CHAT_MAX_CONCURRENT`, `CHAT_MAX_QUEUE`, `CHAT_QUEUE_TIMEOUT_MS` | Capacidad y espera máxima de la cola completa del chat. |
| `*_API_KEY`, `*_MODEL`, `*_MODELS` | Credencial, modelo por defecto y catálogo permitido por proveedor. |
| `AUTO_ROUTE_*` | Proveedor y modelo (y su respaldo) para cada nivel de complejidad. |
| `OCR_ENABLED`, `OCR_LANGUAGE`, `OCR_MIN_TEXT_CHARS` | Control del OCR local. |
| `CHAT_LOG_RETENTION_DAYS` | Días que se conservan las interacciones registradas. |

Al arrancar, el backend imprime qué variables vienen del entorno y cuáles usan su
valor por defecto.

---

## 6. Verificación

```bash
cd backend
npm test                  # suite unitaria (node --test)
npm run test:integration  # smoke HTTP de extremo a extremo
npm run typecheck         # src/, test/ y scripts/
npm run build
npm run test:providers    # opcional: llamadas REALES y facturables

cd ../frontend
npm run build
```

---

## 7. Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| `/api/chat` responde 503 al arrancar | El índice sigue construyéndose. Consulta `GET /api/retrieval/status`. |
| El servicio no arranca en producción | Falta `AUTH_JWT_SECRET`, o tiene menos de 32 caracteres. |
| Documentos `.doc` ausentes del índice | LibreOffice no está instalado (`spawn soffice ENOENT`). |
| PDF escaneados sin texto | Falta `ocrmypdf`/`tesseract`, o el documento es manuscrito — Tesseract no lee letra a mano. |
| 503 con `Retry-After` | Cola de recuperación saturada; ajusta `RETRIEVAL_MAX_QUEUE`. |
| Consultas muy lentas | Calibra el reranker con `npm run bench:rerank` y `RERANK_CANDIDATES`. |
| El frontend no conecta (local) | `NEXT_PUBLIC_AGENT_API_URL` y `PORT` no coinciden. |
| La UI muestra backend caído (Docker) | El backend sigue arrancando o se reinició; revisa `make ps` y `make logs S=backend`. |
| `make up` pide `make scrape` o `make cache` | El volumen de datos o el índice están vacíos: es la primera vez en esta máquina. |

Durante la preparación inicial, ejecuta **un solo** proceso de indexación o backend
sobre la misma caché.
