#!/bin/sh
# Sonda de disponibilidad del chat durante una reindexación (T071; RNF-C3-IV-02).
#
#   backend/scripts/sonda-chat.sh <segundos> [duración_total_en_segundos]
#
# Cada <segundos> envía una consulta fija a /api/chat con una sesión anónima
# (se renueva solo si expira) y
# escribe una línea por consulta en stdout:
#   <hora ISO>  <código HTTP>  <latencia en segundos>
# Sale con 1 si alguna respuesta no fue 200 (la reindexación cortó el servicio).
#
# Variables: CHAT_URL (defecto http://localhost:3001), CONSULTA.
# Uso típico (quickstart §6), en otra terminal mientras corre
# `make kb CMD="sincronizar --completa --medir"`:
#   backend/scripts/sonda-chat.sh 30 3600 | tee sonda.log
set -eu

INTERVALO="${1:?Uso: sonda-chat.sh <segundos> [duración_total_en_segundos]}"
DURACION="${2:-0}"
URL="${CHAT_URL:-http://localhost:3001}"
CONSULTA="${CONSULTA:-¿Qué requisitos tiene el trámite de permisos ambientales?}"

nueva_sesion() {
  curl -sS -m 15 -X POST "$URL/api/session" | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p'
}

fallos=0
token=$(nueva_sesion)
inicio=$(date +%s)
while :; do
  cuerpo=$(printf '{"message":"%s"}' "$CONSULTA")
  salida=$(curl -sS -m 120 -o /dev/null -w '%{http_code} %{time_total}' -X POST "$URL/api/chat" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer ${token}" -d "$cuerpo" 2>/dev/null || echo "000 0")
  codigo=${salida%% *}
  [ "$codigo" != "401" ] || token=$(nueva_sesion)
  printf '%s  %s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$codigo" "${salida#* }"
  [ "$codigo" = "200" ] || fallos=$((fallos + 1))
  if [ "$DURACION" -gt 0 ] && [ $(( $(date +%s) - inicio )) -ge "$DURACION" ]; then break; fi
  sleep "$INTERVALO"
done
[ "$fallos" -eq 0 ] || { echo "La sonda registró $fallos respuestas no 200." >&2; exit 1; }
