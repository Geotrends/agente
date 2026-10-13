#!/bin/sh
# Crea los roles limitados de chat/admin y aplica sus migraciones (spec 002, T007).
# Idempotente: sirve en un volumen nuevo y en uno ya en producción. No usa `down -v`,
# no toca el esquema kb y no recibe contraseñas por argumentos.
#
#   sh backend/db/bootstrap-chat-admin.sh
#
# Requiere en .env: POSTGRES_PASSWORD, CHAT_DB_PASSWORD, ADMIN_DB_PASSWORD, MAINT_DB_PASSWORD.
set -eu
cd "$(dirname "$0")/../.."
exec docker compose run --rm chat-migrate
