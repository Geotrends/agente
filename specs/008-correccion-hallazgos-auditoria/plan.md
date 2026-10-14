# Implementation Plan: SPEC008 — Corrección de hallazgos de la auditoría de seguridad

**Branch**: `develop` (directorio de feature `008-correccion-hallazgos-auditoria`) | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-correccion-hallazgos-auditoria/spec.md`

## Summary

Corregir las 12 pistas NV-01..NV-12 de la auditoría (commit `b5f6cca`) y los endurecimientos asociados. El enfoque es **prueba primero**: por cada pista, una prueba automatizada reproduce el defecto en un fixture local (sin tocar servicios reales); si la prueba demuestra que no es explotable, se registra la evidencia y se cierra sin cambio. Las correcciones son acotadas y se apoyan en lo existente: conectar el `ChatTrafficController` ya implementado a `POST /api/chat`; atar la operación de publicación a una versión objetivo (`target_version_id`) y validarla dentro de la transacción de commit; hacer reanudable la cola de operaciones con reintento/espera; límites reales en ZIP/OCR; filtro de hosts en el navegador del scraper; ciclo de vida del texto extraído y de las exportaciones; y endurecimiento de despliegue (entorno por servicio, cabeceras, sesión).

## Technical Context

**Language/Version**: TypeScript (Node 22, Express 4) en `backend/`; Python 3.12 (requests + Playwright) en `web_scraper/`; Next 16 export estático tras nginx-unprivileged en `frontend/`.

**Primary Dependencies**: `pg`, `@qdrant/js-client-rest`, `jose`, `argon2`, `mammoth`, `xlsx`, `pdf-parse`, `express-rate-limit` (`ipKeyGenerator`); Poppler (`pdfinfo`, `pdftoppm`) y Tesseract por `execFile`; Playwright. Sin dependencias nuevas previstas (ver R06 en [research.md](research.md)).

**Storage**: PostgreSQL 16 (esquemas `kb`, `admin`, `chat`; migraciones SQL secuenciales en `backend/migrations/` y `backend/migrations/chat/`); Qdrant 1.19; estado de topes del chat en archivo JSON (`chatLimitStateFile`); volúmenes de cargas, exportaciones y caché de extracción.

**Testing**: `node --import tsx --test` — suites `test/*.test.ts` (unitarias), `test:kb-integracion` (PostgreSQL + Qdrant locales, ver receta de SPEC004/SPEC005), `test:admin`, `test:all`; pytest en `web_scraper/`. Nuevas pruebas en `backend/test/seguridad-008/` y `backend/test/kb-integracion/`.

**Target Platform**: Docker Compose en una instancia Linux (una réplica), rol IAM de instancia para Bedrock.

**Project Type**: web-service + worker + scraper + frontend estático (aplicación web existente).

**Performance Goals**: sin degradar el pico de ~10 consultas/min y ~20 usuarios simultáneos; el tope diario añade una lectura/escritura serializada por consulta (SC-001).

**Constraints**: ningún proveedor distinto de Bedrock (principio V); el texto ciudadano no persiste con «No autorizo» (IV); errores genéricos sin trazas (VI); un solo worker de operaciones; el entorno de auditoría no ejecutó código, por lo que cada pista se valida con prueba local aislada (sin red externa, sin credenciales reales).

**Scale/Scope**: ~300 consultas/día, topes por defecto `CHAT_DAILY_PER_IP_LIMIT=300` y `CHAT_DAILY_GLOBAL_LIMIT=1000`; ~7 historias, 24 requisitos funcionales, 3 migraciones SQL pequeñas.

## Constitution Check

*GATE: debe pasar antes de la investigación (Fase 0); se reevalúa tras el diseño (Fase 1).*

| Principio | Evaluación | Resultado |
|---|---|---|
| I. Orientación preliminar | No cambia respuestas ni alcance | Pasa |
| II. Anclaje documental | FR-020 neutraliza delimitadores del prompt (refuerza «datos, no instrucciones») | Pasa |
| III. Base cerrada y validada | FR-004..FR-010, FR-013: solo la versión aprobada es recuperable; hosts permitidos; una indexación fallida conserva la última válida | Pasa (refuerza) |
| IV. Privacidad por diseño | FR-014/FR-015: sin restos de texto extraído ni exportaciones; los registros de topes no guardan contenido | Pasa |
| V. Proveedor único | FR-016: llaves de proveedores deshabilitados no llegan a ningún servicio; sin llaves estáticas | Pasa |
| VI. Falla segura y transparente | FR-002a, FR-008, FR-009, FR-013, FR-022: degradaciones notificadas y agrupadas; errores genéricos | Pasa |
| VII. Perímetro y control de acceso | FR-001, FR-017..FR-019: topes, cabeceras, sesión absoluta, /64 | Pasa |
| VIII. Accesibilidad | El botón «Reanudar» (FR-008) cumple WCAG 2.1 A/AA como el resto del panel | Pasa (verificar en tareas) |
| IX. Trazabilidad / validación por fallo | Corrección de defectos que sostienen RF existentes (ver spec); cada fallo se clasifica y se cierra con prueba | Pasa |
| X. Pruebas automatizadas | FR-023: prueba que falla antes y pasa después, por pista | Pasa |

**Sin violaciones que justificar** (la tabla de Complexity Tracking queda vacía). Las migraciones tocan el esquema `kb` (SPEC001/SPEC007) y se presentan como corrección, no como funcionalidad nueva.

*Reevaluación posterior al diseño (Fase 1)*: se mantiene. El único punto con costo de revisión es el nuevo endpoint de reanudación (contrato [admin-operations.md](contracts/admin-operations.md)): reutiliza perfil, CSRF y auditoría existentes y no añade perfiles ni canales de notificación.

## Project Structure

### Documentation (this feature)

```text
specs/008-correccion-hallazgos-auditoria/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-quota.md
│   ├── admin-operations.md
│   ├── scraper-render.md
│   └── http-headers.md
├── checklists/requirements.md
└── tasks.md             # lo genera /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── migrations/
│   └── 007_correccion_auditoria.sql        # NUEVO: target_version_id, version_aplazada_id, reintentos de operación
├── migrations/chat/
│   └── 013_sesion_vigencia_absoluta.sql    # NUEVO: vigencia absoluta de sesión del panel
├── src/
│   ├── routes/chat.ts                      # NV-01: invocar topes tras validar y antes del LLM
│   ├── services/chatTraffic.ts             # día de Bogotá, tope temporal en memoria (FR-002a)
│   ├── kb/documentOperations.ts            # NV-02/03/07/08/09/10: objetivo, reintentos, guardas
│   ├── kb/indexer.ts                       # commit valida version objetivo y estado procesado
│   ├── kb/manualUploads.ts, kb/sync.ts     # NV-02/03/09: aplazar si hay operación activa; no borrar publicada
│   ├── kb/zipInspect.ts                    # NV-05: expansión real acotada
│   ├── kb/ocr.ts                           # NV-06: páginas, píxeles y plazo agregado
│   ├── kb/conversion.ts                    # NV-11: caché con tope/expiración; borrado al descartar
│   ├── kb/worker.ts                        # barrido periódico de caché y exportaciones
│   ├── admin/export.ts                     # NV-12: cierre al desconectar; barrido invocado
│   ├── admin/ (sesión, login, contraseña)  # FR-018
│   ├── routes/ (retrieval status, ready)   # FR-019
│   ├── prompts/                            # FR-020
│   └── services/diConfig.ts                # FR-016/ARR-01: arranque directo falla con llaves sobrantes
├── test/seguridad-008/                     # NUEVO: una prueba por pista
└── test/kb-integracion/seguridad-008-*.test.ts
web_scraper/
├── scraper/ (render/_visit)                # NV-04
└── tests/
frontend/
├── nginx.conf                              # FR-017
└── admin/ (panel de operaciones)           # botón «Reanudar»
docker-compose.yml, Makefile, .env.example  # FR-016: entorno por servicio; check-env
.github/workflows/ci.yml                    # FR-021
```

**Structure Decision**: Se conserva la estructura existente (backend TypeScript + worker + scraper + frontend estático). No se crean paquetes ni servicios nuevos.

## Complexity Tracking

Sin excepciones a la constitución.
