#!/bin/sh
# Programa el scraper con supercronic (RF-C3-IV-02; research R5).
#
#   SCRAPER_CRON  expresión cron de 5 campos; defecto: domingo 02:00 (America/Bogota).
#                 Se rechaza si el día del mes o el mes no son '*' (más de 7 días entre corridas).
#
# Una corrida a mano sigue siendo posible sin pasar por aquí:
#   docker compose run --rm --entrypoint python scraper main.py --output /data --manual
set -eu

CRON="${SCRAPER_CRON:-0 2 * * 0}"
export TZ="${TZ:-America/Bogota}"

python -m scraper.cron_check "$CRON"

# supercronic ejecuta la línea con /bin/sh; se deja la salida en stdout para `docker logs`.
printf '%s python main.py --output /data\n' "$CRON" > /tmp/crontab
echo "Scraper programado: '$CRON' ($TZ)"
exec supercronic /tmp/crontab
