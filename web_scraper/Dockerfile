# Scraper del corpus. Solo se usa en la preparación de datos
# (docker compose --profile setup run scraper), nunca en el arranque normal.
FROM python:3.12-slim

# El venv de la imagen cuenta como "entorno activo" para run_all_sources.sh.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH
RUN python -m venv /opt/venv

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py run_all_sources.sh ./
COPY scraper ./scraper
COPY scripts ./scripts

# Mismo UID que el backend (10001): los archivos que deja en el volumen de
# datos son legibles por el backend sin ajustar permisos.
RUN useradd --system --uid 10001 geobot \
    && mkdir -p /data \
    && chown geobot:geobot /data
USER geobot

ENTRYPOINT ["./run_all_sources.sh"]
CMD ["/data"]
