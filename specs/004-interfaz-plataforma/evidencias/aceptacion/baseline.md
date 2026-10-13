# Baseline SPEC004 (T001)

Fecha: 2026-10-10. Rama: `develop`. Registro de punto de partida; **no es evidencia de aceptación**.

## Repositorio

| Dato | Valor |
| --- | --- |
| HEAD | `3f56d8e91a78e8cf9f39c86472940f58eb5f09e8` |
| Cambios locales sin commit | 168 entradas (92 sin seguimiento `??`, 64 modificadas `M`, 12 eliminadas `D`) |
| `frontend/package-lock.json` | sha256 `0fb9ec354f38e067…` |
| `backend/package-lock.json` | sha256 `8bb647de204d44df…` |
| `package-lock.json` (raíz) | sha256 `f9e7e773d12f99f5…` |
| Node local | v26.11.0 (el proyecto declara Node 22 en Dockerfile/CI) |

Se preserva todo el trabajo local sin commit de SPEC001–003; SPEC004 solo añade/edita las rutas citadas en sus tareas.

## Marcas de tareas de specs previas (verificadas por conteo, no por existencia de archivos)

| Spec | Marcadas | Observación |
| --- | --- | --- |
| SPEC001 | 89/91 | T082/T083 pendientes |
| SPEC002 | 93/100 | Pendientes T092–T098 (AWS real, matriz real, carga, revisión navegador, firma, hallazgos) |
| SPEC003 | 35/36 | Pendiente T035 (navegador real). **Sus tareas citan `frontend/src/...`, ruta que no existe**; el flujo real vive en `frontend/shared/consent.ts` y `frontend/smart/SmartAgentPanel.tsx` |

La cabecera de `tasks.md` (17/100 y 0/27) quedó obsoleta: el estado real es el de esta tabla.

## Rutas API montadas (`backend/src/index.ts`, prefijo `/api`)

`GET /health`, `GET /ready`, `POST /session`, `GET /chat/config`, `POST /conversations`, `POST /chat`, `GET /retrieval/status`, `/admin/session|password`, `/admin/contacts/*`, `/admin/status`, `/admin/notifications*`.
**No existe** `POST /api/ratings` (RF-C3-IN-09).

## Migraciones chat existentes

`001_base_contactos`, `002_identidad`, `003_conversacion`, `004_registro_tarifas`, `005_retencion`, `006_operacion`. Siguiente ordinal libre: **007**.

## Frontend existente

`app/{page,layout}.tsx`, `app/admin/`, `shared/{ChatMarkdown(406 l., parser regex),MessageContent,session(sessionStorage),consent,chatContracts,chatErrors,agentConfig,adminSession}.ts(x)`, `smart/SmartAgentPanel.tsx`, `test/{di-consent.test.ts,di-flows.test.mts,domSetup.ts}`.
**No existen**: `chat/`, `widget/`, `scripts/`, `app/chat/`, `shared/chatClient.ts`, `ExternalLink`, `feedback*`, Vitest/Playwright/unified.

## Brechas observadas frente al contrato004

- Token de sesión en `sessionStorage` (debe ser solo memoria, RNF-C4-IN-01).
- Sin reloj de 45 s, sin reintentos, sin indicador literal, sin valoración, sin diálogo de nueva conversación.
- Renderer regex (no AST), enlaces con `rel="noreferrer noopener"` (contrato exige `noopener noreferrer`).
- Sin launcher/iframe/CSP `frame-ancestors`.

## Evidencia disponible

Pruebas locales preexistentes: backend `test/*.test.ts`, `test/di-integracion/`, `test/kb-integracion/`; frontend `test/di-*.test.*`. No hay carpeta `evidencias/aceptacion/` previa de SPEC004 salvo este archivo.
