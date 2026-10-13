# Geobot — punto de entrada único. Ver README.md, sección "Puesta en marcha".
#
#   Primera vez:  make up  →  make scrape  →  make kb CMD="sincronizar"
#                 →  make kb CMD="publicar --todos-pendientes"
#   Siguientes:   make up   (la verificación semanal y la sincronización son automáticas)

COMPOSE := docker compose
SETUP   := $(COMPOSE) --profile setup

.DEFAULT_GOAL := help
.PHONY: help scrape kb build up down logs ps env-file check-env migrate-chat bootstrap-admin

help: ## Muestra esta ayuda
	@echo "Uso: make <comando>"
	@echo
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-8s %s\n", $$1, $$2}'
	@echo
	@echo "Primera vez: make up && make scrape && make kb CMD=\"sincronizar\""

scrape: env-file ## Corrida manual del scraper (escribe un informe de corrida). Flags: make scrape ARGS="--max-pages 50"
	$(SETUP) run --rm --build --entrypoint python scraper main.py --output /data --manual $(ARGS)
	@echo "Corrida terminada. El kb-worker la procesa solo; para forzarlo: make kb CMD=\"sincronizar\""

kb: env-file ## CLI de la base de conocimiento: make kb CMD="estado" (ver contracts/kb-cli.md)
	$(COMPOSE) exec kb-worker node dist/kb/cli.js $(CMD)

build: env-file ## Construye todas las imágenes
	$(SETUP) build backend frontend scraper

up: check-env ## Levanta postgres, qdrant, backend, kb-worker y frontend
	$(COMPOSE) up -d --build
	@echo
	@echo "Geobot arriba en http://$$($(COMPOSE) port frontend 8080 | sed 's/0\.0\.0\.0/localhost/')"
	@echo "Hasta publicar la base, el chat responde 'servicio no disponible'. Estado: make kb CMD=\"estado\""

down: env-file ## Detiene todo (datos, base de conocimiento e índice se conservan)
	$(COMPOSE) down

migrate-chat: env-file ## Crea los roles y aplica las migraciones de chat/admin (idempotente; también en un volumen existente)
	$(COMPOSE) run --rm chat-migrate

bootstrap-admin: env-file ## Crea el administrador técnico inicial: make bootstrap-admin EMAIL=a@b.co NOMBRE="Nombre" (contraseña por stdin)
	@test -n "$(EMAIL)" || { echo "Uso: make bootstrap-admin EMAIL=correo NOMBRE=\"Nombre\"  (la contraseña temporal se lee por stdin, nunca por argumento)"; exit 1; }
	$(COMPOSE) run --rm -T backend node dist/admin/bootstrapCli.js "$(EMAIL)" "$(NOMBRE)"

logs: env-file ## Sigue los logs (uno solo: make logs S=kb-worker)
	$(COMPOSE) logs -f --tail=200 $(S)

ps: env-file ## Estado de los servicios
	$(COMPOSE) ps

# ── Verificaciones internas ──────────────────────────────────────────────────

env-file:
	@test -f .env || { echo "Falta .env. Créalo con: cp .env.example .env  (y completa las claves obligatorias)"; exit 1; }

check-env: env-file
	@grep -qE '^AUTH_JWT_SECRET=.{32,}' .env || { echo "AUTH_JWT_SECRET vacío o con menos de 32 caracteres en .env. Genera uno con: openssl rand -base64 48"; exit 1; }
	@for v in POSTGRES_PASSWORD KB_DB_PASSWORD APP_DB_PASSWORD CHAT_DB_PASSWORD ADMIN_DB_PASSWORD MAINT_DB_PASSWORD; do \
	  grep -qE "^$$v=.+" .env || { echo "$$v vacío en .env. Genera uno con: openssl rand -base64 32"; exit 1; }; \
	done
	@! grep -qE '^(GEMINI|GROQ|DEEPSEEK|OPENAI)_API_KEY=.+|^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)=.+|^MIN_RERANK_SCORE=.+' .env || { echo "Sobran variables en .env: solo se admite Bedrock con el rol de la instancia (sin claves de otros proveedores ni AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) y el umbral sale de la calibración, no de MIN_RERANK_SCORE."; exit 1; }
	@echo "Recuerda: el chat solo se declara listo (GET /ready) con contactos, tarifas, política de datos y calibración cargados. Detalle: docs/arquitectura-sistema.md"
