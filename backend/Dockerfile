# Backend de Geobot (hallazgo M-12).
#
# El procedimiento de despliegue documentado en el README eran dos servidores
# de desarrollo lanzados a mano en dos terminales. Para un servicio con 13,4 GB
# de corpus, dependencias NATIVAS y modelos ONNX que se descargan en el primer
# arranque, eso no es reproducible entre máquinas.
#
# Que las dependencias nativas importan no es teórico: LibreOffice faltaba en
# el equipo de desarrollo y 206 documentos .doc del corpus llevaban todo el
# proyecto sin indexarse, fallando con `spawn soffice ENOENT` sin que nada lo
# dijera (hallazgo A-3). Declararlas aquí es justamente lo que evita que eso
# vuelva a pasar en el siguiente despliegue.
FROM node:22-bookworm-slim AS base

# tesseract-ocr + los idiomas que usa OCR_LANGUAGE (spa+eng), ocrmypdf con
# unpaper para --clean, ghostscript para el remuestreo, y libreoffice-writer
# —solo Writer: el paquete completo pesa varias veces más y no se usa— para
# convertir los .doc heredados.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-spa \
      tesseract-ocr-eng \
      ocrmypdf \
      unpaper \
      ghostscript \
      libreoffice-writer \
      fonts-liberation \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Capa de dependencias aparte del código: cambiar una línea de TypeScript no
# debe reinstalar node_modules ni recompilar las dependencias nativas.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM base AS build
RUN npm install
COPY tsconfig.json tsconfig.check.json ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
# El typecheck cubre src/, test/ y scripts/: si la suite deja de compilar, la
# imagen no se construye (hallazgo M-13).
RUN npm run typecheck && npm run build

FROM base AS runtime
ENV NODE_ENV=production
# El índice vive en el heap: el límite por defecto de Node se queda corto en
# cuanto el corpus crece (hallazgo C-2). Se fija explícito para que dependa de
# la configuración y no del tamaño de RAM de la máquina anfitriona.
ENV NODE_OPTIONS=--max-old-space-size=4096

COPY --from=build /app/dist ./dist

# El corpus y las cachés se montan como volúmenes: no viajan en la imagen.
#   /app/data   documentos (GEOTRENDS_DOCUMENTS_ROOT)
#   /app/.cache índice, fragmentos y modelos ONNX descargados
#   /app/var    registro de interacciones (datos personales, ver A-11)
VOLUME ["/app/data", "/app/.cache", "/app/var"]

# Usuario sin privilegios: el proceso solo necesita leer el corpus y escribir
# sus cachés.
RUN useradd --system --uid 10001 geobot \
    && mkdir -p /app/data /app/.cache /app/var \
    && chown -R geobot:geobot /app
USER geobot

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Sin shell por delante, para que el proceso de Node sea el PID 1 y reciba
# SIGTERM directamente: de eso depende el apagado ordenado de index.ts.
CMD ["node", "dist/index.js"]
