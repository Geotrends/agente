#!/bin/sh
# Primer arranque de PostgreSQL (docker-entrypoint-initdb.d): crea los dos roles
# de la base de conocimiento y el esquema `kb` (research R13).
#
#   kb_writer   lo usa el kb-worker; dueño del esquema `kb`, aplica las migraciones.
#   app_reader  lo usa el backend del chat; solo puede leer la vista de códigos
#               publicados (el GRANT lo hace la migración, que crea la vista).
#
# Las contraseñas llegan por variables de entorno del despliegue; nunca se
# escriben aquí. Solo corre cuando el volumen de datos está vacío.
set -eu

: "${KB_DB_PASSWORD:?Falta KB_DB_PASSWORD}"
: "${APP_DB_PASSWORD:?Falta APP_DB_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=kb_pass="$KB_DB_PASSWORD" --set=app_pass="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE kb_writer LOGIN PASSWORD :'kb_pass';
CREATE ROLE app_reader LOGIN PASSWORD :'app_pass';
CREATE SCHEMA kb AUTHORIZATION kb_writer;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA kb TO app_reader;
SQL
