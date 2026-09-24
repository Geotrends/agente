# Geobot — punto de entrada único. Ver README.md, sección "Puesta en marcha".
#
#   Primera vez:     make scrape  →  make cache  →  make up
#   Siguientes:      make up

COMPOSE := docker compose
SETUP   := $(COMPOSE) --profile setup

.DEFAULT_GOAL := help
.PHONY: help scrape cache build up down logs ps env-file check-env require-data require-index

help: ## Muestra esta ayuda
	@echo "Uso: make <comando>"
	@echo
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-8s %s\n", $$1, $$2}'
	@echo
	@echo "Primera vez: make scrape && make cache && make up"

scrape: env-file ## Descarga el corpus (horas). Flags extra: make scrape ARGS="--max-pages 50"
	$(SETUP) run --rm --build scraper $(ARGS)
	@echo "Corpus descargado. Siguiente paso: make cache"

cache: env-file ## Construye el índice a partir del corpus (detiene el backend mientras corre)
	@# Un solo proceso sobre la caché a la vez: indexador o backend, nunca ambos.
	@$(COMPOSE) stop backend >/dev/null 2>&1 || true
	@$(MAKE) --no-print-directory require-data
	$(SETUP) run --rm indexer
	@echo "Índice listo. Siguiente paso: make up"

build: env-file ## Construye todas las imágenes
	@# indexer comparte la imagen del backend: construirla dos veces en paralelo tumba BuildKit.
	$(SETUP) build backend frontend scraper

up: check-env require-data require-index ## Levanta backend + frontend
	$(COMPOSE) up -d --build
	@echo
	@echo "Geobot arriba en http://$$($(COMPOSE) port frontend 8080 | sed 's/0\.0\.0\.0/localhost/')"
	@echo "El backend tarda unos segundos en cargar el índice; sigue el progreso con: make logs"

down: env-file ## Detiene todo (los datos y el índice se conservan)
	$(COMPOSE) down

logs: env-file ## Sigue los logs (uno solo: make logs S=backend)
	$(COMPOSE) logs -f --tail=200 $(S)

ps: env-file ## Estado de los servicios
	$(COMPOSE) ps

# ── Verificaciones internas ──────────────────────────────────────────────────

env-file:
	@test -f .env || { echo "Falta .env. Créalo con: cp .env.example .env  (y completa AUTH_JWT_SECRET y una API key)"; exit 1; }

check-env: env-file
	@grep -qE '^AUTH_JWT_SECRET=.{32,}' .env || { echo "AUTH_JWT_SECRET vacío o con menos de 32 caracteres en .env. Genera uno con: openssl rand -base64 48"; exit 1; }
	@grep -qE '^(GEMINI|GROQ|DEEPSEEK|OPENAI)_API_KEY=.+' .env || echo "Aviso: no hay ninguna API key de proveedor en .env; el chat no podrá responder salvo con Ollama."

require-data: env-file
	@$(SETUP) run --rm --build --no-deps --entrypoint sh indexer -c \
	  'find /app/data -type f ! -path "*/metadata/*" ! -path "*/logs/*" | head -n 1 | grep -q .' \
	  || { echo "Faltan datos: el corpus está vacío. Corre primero: make scrape"; exit 1; }

require-index: env-file
	@$(SETUP) run --rm --no-deps --entrypoint sh indexer -c \
	  'ls /app/.cache/retrieval/snapshot-*.bin >/dev/null 2>&1' \
	  || { echo "Falta el índice. Corre primero: make cache"; exit 1; }
