# Integración local completa (T075 / T077)

Fecha 2026-10-10. Adapter **controlled**: PostgreSQL 16.13 real aislado (directorio temporal, puerto 55432), Bedrock **doble**, navegador Chromium headless (+ imagen de nginx real para T075). **No acredita** Bedrock real, KB publicada, portal ni dispositivos: esos insumos son T078–T081.

## Suites

| Suite | Comando | Resultado |
| --- | --- | --- |
| Frontend tipos | `npm --prefix frontend run typecheck` | ✔ |
| Frontend heredadas (SPEC002/003) | `npm --prefix frontend test` | 17/17 |
| Frontend interfaz | `npm --prefix frontend run test:ui` | 102/102 |
| Frontend E2E + axe (Chromium) | `npm --prefix frontend run build:e2e && npx playwright test --project=chromium` | **58/58** (launcher, viewport, CSP, storage, enlaces, markdown, fallos, nueva conversación, valoración, marca, axe por estados) |
| Frontend E2E Firefox/WebKit/Edge/móviles emulados | `npx playwright test` (otros proyectos) | **no ejecutados** aquí (descarga de navegadores no completada); sí configurados en CI |
| Backend tipos | `npm --prefix backend run typecheck` | ✔ |
| Backend unitarias | `node --import tsx --test test/*.test.ts` | 333/333 |
| Backend interfaz | `npm --prefix backend run test:ui-integration` | 18/18 (prerequisites 5, privacy 3, contact-config 2, feedback-api 3, feedback-database 5) |
| Backend regresión SPEC002 | `test/di-integracion/*.test.ts` (PostgreSQL + Qdrant v1.19.2 en Docker + modelos locales reales; Bedrock doble) | **64/64** |
| Backend KB (SPEC001) | `test/kb-integracion/*.test.ts` | **57/57** |
| Auditoría | `npm audit --omit=dev --audit-level=high` (frontend/backend) | 0 / sin altas (4 moderadas en backend, transitivas) |
| Launcher | `npm --prefix frontend run build:widget` | 5 083 bytes ≤ 10 000 |

## Doce consultas, registro de IDs, purga y no-store

- `prerequisites.test.ts`: 12 consultas autorizadas, la duodécima con exactamente 10 pares; cada respuesta con `responseId`; config y consultas con `Cache-Control: no-store`.
- `privacy.test.ts` / `feedback-database.test.ts`: anónimo sin filas ni IDs; purga de 12 meses sin que la FK de valoración la bloquee.

## T075 — imagen real de nginx

`docker build -t geobot-frontend:spec004 frontend` (node:22-alpine → nginx-unprivileged:1.27) y contenedor en `127.0.0.1:18080`:

| Comprobación | Resultado |
| --- | --- |
| `nginx -t` | syntax ok |
| `GET /chat` | 200, título «Geobot · Observatorio Ambiental de Envigado», **una** cabecera `Content-Security-Policy` con `frame-ancestors https://observatorioenvigado.geotrends.co` y `script-src 'self'` + 3 hashes; sin `X-Frame-Options`; `Cache-Control: no-cache` |
| `GET /embed/geobot-launcher.js` | 200, `application/javascript`, 5 083 bytes |
| `/chat` cargado en Chromium contra esa imagen (sin backend) | 0 violaciones de CSP; muestra el literal de IN-06 y «Intentar de nuevo»; solicitudes: HTML, logo, CSS/JS de `_next` y `/api/chat/config` |
| Ruta sin fallback heredado | `location = /chat` con `try_files /chat.html =404` |

No se levantó el backend dentro de compose (no se ejercitó `docker-compose up`).

## Rechazo del camino heredado

Las pruebas de `consent.test.ts` y `prerequisites.test.ts` confirman 400 para `provider`, `model`, `autoRoute`, `message` e `history`; `routes/chat.ts` usa solo el adaptador de Bedrock.

## Pendiente antes de declarar «publicable»

Servicios reales (Bedrock/KB publicada/panel), portal, dispositivos reales, Firefox/WebKit y lectores (T078–T083).
