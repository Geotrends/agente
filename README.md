# Geobot: prototipo de búsqueda híbrida

Chat sobre todos los documentos locales, sin seleccionar biblioteca o archivo. Permite elegir Gemini, Groq o DeepSeek, o usar selección automática entre los proveedores con API key configurada. Ollama conserva su adaptador en el API.

## Arranque

Requiere Node.js 22 y documentos en `backend/data` (PDF, DOC/DOCX, XLS/XLSX, Markdown o TXT). El backend convierte los documentos a Markdown antes de crear fragmentos y embeddings. Los PDF escaneados usan OCR local cuando el texto extraído es insuficiente.

Para habilitar OCR gratuito en macOS:

```bash
brew install tesseract tesseract-lang ocrmypdf
```

La configuración está en `.env`: `OCR_ENABLED`, `OCR_LANGUAGE` y `OCR_MIN_TEXT_CHARS`. Los derivados Markdown se guardan en `backend/.cache/documents`; el índice RAG se guarda en `backend/.cache/retrieval`. Ambos directorios están ignorados por Git.

En `backend`:

```bash
npm install
# Solo si todavía no existe .env:
cp .env.example .env
# Configura al menos una API key y GEOTRENDS_DOCUMENTS_ROOT en .env.
npm run index
npm run dev
```

En otra terminal, desde `frontend`:

```bash
npm install
npm run dev
```

Abre http://localhost:3000. La interfaz usa `http://localhost:3001/api/chat` por defecto; se puede cambiar con `NEXT_PUBLIC_AGENT_API_URL` en `frontend/.env.local`. Ajusta `PORT=3001` en el backend.

`npm run index` es opcional: la primera pregunta también construye el índice. Prepararlo antes evita la espera inicial del chat. La primera ejecución descarga el modelo y puede tardar según el volumen documental y el equipo. Una API key válida también necesita cuota y acceso al modelo configurado.

## Recuperación

1. Preprocesa cada archivo como Markdown: texto normalizado, DOCX/DOC convertido, PDF extraído con OCR local bajo demanda y XLS/XLSX convertido a tablas Markdown por hoja.
2. Divide cada Markdown en fragmentos de aproximadamente 1.000 caracteres con 150 de solapamiento.
3. BM25 (`k1=1.2`, `b=0.75`) puntúa términos normalizados del texto y la ruta. Elimina palabras comunes y usa frecuencias documentales y longitud de fragmento.
4. Embeddings locales con [multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small), cuantizado a 8 bits mediante Transformers.js. Usa prefijos `query:` y `passage:`, pooling medio y normalización. No necesita otra API key ni envía los documentos a un servicio de embeddings.
5. Búsqueda vectorial exacta por similitud coseno, independiente de BM25. Ambos motores consultan todos los fragmentos del alcance.
6. Reciprocal Rank Fusion combina los primeros 40 candidatos de cada lista: `score = Σ 1/(60 + posición)`, con posiciones desde 1. Recupera los mejores 8 fragmentos.
7. Envía estos fragmentos, sus rutas y el historial al proveedor elegido. El prompt pide citas y reconocer cuando la evidencia es insuficiente.

La consulta incorpora la última pregunta del usuario en seguimientos cortos. El buscador no depende del proveedor que genera la respuesta. En modo automático, si falla un proveedor se prueban los otros que tengan clave. Cada llamada de generación tiene un límite de espera de 60 segundos.

## Índice y fuentes

El índice se guarda por documento en `backend/.cache/retrieval` (ignorado por Git). Se reutiliza al reiniciar. Un cambio en ruta, tamaño, fecha de modificación o versión del preprocesador recalcula ese documento; los archivos eliminados dejan de participar en la siguiente búsqueda. Las versiones anteriores de caché quedan en disco. `RETRIEVAL_CACHE_DIR` y `DOCUMENT_CACHE_DIR` permiten cambiar las ubicaciones.

La interfaz muestra el progreso inicial y las fuentes de la última respuesta. El API expone puntuaciones BM25, coseno y RRF por fragmento. Las citas identifican fragmentos, no páginas originales. El inventario completo no se envía al LLM.

Es un índice local en memoria, con persistencia JSON y búsqueda vectorial exhaustiva, adecuado para un prototipo. La indexación completa ocurre antes de responder; el coste y la memoria crecen con el número de fragmentos. Ejecuta un solo proceso de indexación/backend sobre una misma caché durante la preparación inicial.

## API

```http
POST /api/chat
Content-Type: application/json

{"message":"¿Qué medidas se describen para controlar el ruido?","provider":"auto","history":[]}
```

Solo `message` es obligatorio. `provider` admite `auto`, `gemini`, `groq`, `deepseek` u `ollama`. `folder` y `documentId` son filtros opcionales para compatibilidad; ya no se selecciona un documento arbitrario por defecto. La respuesta incluye `answer`, `meta.provider`, `meta.retrieval` y `meta.sources`.

- `GET /api/providers`: proveedores y presencia de clave, sin exponer secretos.
- `GET /api/retrieval/status`: progreso del índice.
- `GET /health`: disponibilidad del backend.

## Verificación

```bash
cd backend
npm test
npm run test:integration
npm run build
# Prueba opcional con embeddings reales y llamadas facturables a las claves configuradas:
npm run test:providers
cd ../frontend
npm run build
```

Los documentos `DOCUMENTACION-HANDOFF.md` y PDF describen la versión anterior con selección manual; este README documenta el prototipo híbrido actual.
