# Scraper del corpus. Solo se usa en la preparación de datos
# (docker compose --profile setup run scraper), nunca en el arranque normal.
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

COPY main.py ./
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
    && mkdir -p /data \
    && chown geobot:geobot /data
USER geobot

# /data es el volumen del corpus. Las fuentes salen de SCRAPER_SOURCES (ver
# main.py); cualquier flag extra se agrega al final:
#   docker compose --profile setup run --rm scraper --max-pages 50
ENTRYPOINT ["python", "main.py", "--output", "/data"]
