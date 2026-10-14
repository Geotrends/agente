# Quickstart de validación — SPEC008

Guía de ejecución; las pruebas completas viven en `backend/test/seguridad-008/` y `backend/test/kb-integracion/`. Todo corre en local aislado (sin red externa ni credenciales reales; receta de SPEC004/SPEC005).

## Prerrequisitos

- PostgreSQL 16 y Qdrant 1.19 locales; las migraciones (`backend/migrations/007_correccion_auditoria.sql`, `backend/migrations/chat/013_sesion_vigencia_absoluta.sql`) las aplican los arneses de prueba.
- Chromium local para las pruebas del scraper; Poppler y Tesseract para OCR.

## Escenarios (uno por historia)

Desde `backend/` (PostgreSQL y Qdrant locales según la receta de SPEC004/SPEC005):

| # | Historia | Comando | Resultado esperado |
|---|---|---|---|
| 1 | Topes del chat | `node --import tsx --test test/seguridad-008/chat-topes.test.ts test/chat-traffic.test.ts` | Consulta N+1 → 429 sin invocar al LLM; sobrevive al reinicio; falla del archivo → tope temporal y aviso |
| 2 | Publicar la aprobada | `node --import tsx --test --test-concurrency=1 test/admin-integracion/seguridad-008-publicar.test.ts` | Con carga concurrente: se publica la aprobada o falla con `candidata_cambiada`; la vigente se conserva |
| 3 | Retiro/limpieza | `node --import tsx --test --test-concurrency=1 test/admin-integracion/seguridad-008-retiro.test.ts` | Fallo de Qdrant → reintento; tras 5 rápidos `requiereAtencion` y reanudación; la cola avanza |
| 4 | ZIP/OCR | `node --import tsx --test test/seguridad-008/limites-procesamiento.test.ts` | ZIP con tamaños falsos rechazado; OCR descarta con motivo |
| 5 | Scraper | `cd ../web_scraper && python3 -m unittest discover -s tests -p "test_render_host.py"` | Redirección a otro host: sin guardar y con aviso |
| 6 | Privacidad | `node --import tsx --test test/seguridad-008/restos-en-disco.test.ts test/admin-integracion/seguridad-008-export.test.ts` | Sin texto extraído de descartadas; exportación huérfana eliminada |
| 7 | Endurecimiento | `node --import tsx --test test/seguridad-008/*.test.ts test/admin-integracion/seguridad-008-sesion.test.ts` y `make check-env` | Cabeceras presentes; sesión vence a las 8 h; /64; estado público mínimo; entorno por servicio |

## Regresión

`cd backend && npm run test:all` y `cd web_scraper && pytest` deben seguir pasando (SC-008).

## Cierre por pista

Registrar en `evidencias/NV-xx.md`: prueba que falla antes, corrección y prueba que pasa; o evidencia de «no explotable» (R12).
