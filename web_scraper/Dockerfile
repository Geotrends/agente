# Scraper del corpus. Corre solo, según SCRAPER_CRON (entrypoint.sh + supercronic),
# y también a mano: make scrape (RF-C3-IV-02).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN python -m venv /opt/venv

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Chromium headless + sus dependencias de sistema, para las fuentes SPA
# (render_js=True: envigado_com, gmas2_envigado). --with-deps instala tambien
# las libs nativas que python:3.12-slim no trae (nss, libatk, etc). Se instala
# en PLAYWRIGHT_BROWSERS_PATH (fuera de $HOME de root) para poder chown-earlo
# al usuario sin privilegios de abajo.
RUN playwright install --with-deps chromium

# supercronic: cron para contenedores (corre como usuario sin privilegios y
# escribe en stdout). Versión fijada con su SHA-256, verificado al construir.
ARG SUPERCRONIC_VERSION=v0.2.49
ARG TARGETARCH=amd64
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) sha=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1 ;; \
      arm64) sha=02aa0cb229ba09050cba6638059dadb9eedc2276632ea43d6a57a2f8c1629dd5 ;; \
      *) echo "arquitectura no soportada: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates; \
    curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH}"; \
    echo "${sha}  /usr/local/bin/supercronic" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/supercronic; \
    apt-get purge -y curl && rm -rf /var/lib/apt/lists/*

COPY main.py entrypoint.sh ./
COPY scraper ./scraper
COPY scripts ./scripts
COPY certs ./certs

# Mismo UID que el backend (10001): los archivos que deja en el volumen de
# datos son legibles por el backend sin ajustar permisos.
#
# /opt/pw-browsers NO se chown-ea: son ~1 GB instalados por root en la capa
# anterior, y un `chown -R` sobre un arbol que ya existe en una capa previa
# obliga a OverlayFS a copiarlo entero a esta capa nueva ("copy-up") solo por
# cambiar el owner -- duplicaba Chromium completo. geobot no necesita ser
# dueno para EJECUTARLO: root lo instala con permisos de lectura/ejecucion
# para todos por defecto, y el proceso no escribe dentro de su propio
# directorio de instalacion en tiempo de ejecucion.
RUN useradd --system --uid 10001 geobot \
    && mkdir -p /data /data/runs \
    && chown geobot:geobot /data /data/runs
USER geobot

# /data es el volumen del corpus. Las fuentes salen de SCRAPER_SOURCES (ver
# main.py). Para una corrida manual con flags:
#   make scrape ARGS="--max-pages 50"
ENTRYPOINT ["./entrypoint.sh"]
