# Integración local controlada (T073)

Fecha: 2026-10-10/11. Versión del árbol (incluye archivos sin seguimiento relevantes, sin secretos): `f0a82e260f6dd977…`. Componentes: **C + DB** (PostgreSQL 16 y Qdrant 1.19 locales aislados, proveedor Bedrock doble, nginx real en Docker local, Chromium). **No** hay AWS, portal, Geoportal ni dispositivos reales: ver `entorno-real.md`. CI de GitHub no estuvo accesible: el workflow se validó solo sintácticamente.

## Suites ejecutadas (todas sin casos omitidos)

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run typecheck` | sin errores |
| `npm --prefix backend test` | 334/334 |
| `npm --prefix backend run test:di-integration` | 75/75 |
| `npm --prefix backend run test:ui-integration` | 21/21 |
| `npm --prefix backend run test:in-integration` | 75/75 (16 archivos; nginx real en 4 pruebas) |
| `npm --prefix backend run test:kb-integracion` | 57/57 |
| `npm --prefix backend run eval:tokenizer` | paridad exacta, 19 casos |
| `npm --prefix backend run check:iam -- backend/config/iam-bedrock-policy.json` | contrato cumplido; 2 éxitos, 5 denegaciones |
| `npm --prefix backend run scan:secrets` | 282 archivos, 0 hallazgos |
| `node … build-load-manifest.ts --check` | manifiesto vigente |
| `npm --prefix frontend run typecheck` | sin errores |
| `npm --prefix frontend test` | 17/17 |
| `npm --prefix frontend run test:ui` | 108/108 (Vitest; ya no usa `--passWithNoTests`) |
| `npm --prefix frontend run build:widget` | launcher 5083 bytes (límite 10 000) |
| `npm --prefix frontend run build:e2e` + `test:ui:e2e --project=chromium` | 77/77 |
| `npm audit --omit=dev --audit-level=high` backend / frontend | 0 altas (4 moderadas) / 0 |
| `docker build -t geobot-backend:ci backend` | construida; argon2, tokenizador fijado y proveedor `fromInstanceMetadata` cargan; migraciones 001–008, `trustProxy.js` y `boundedDb.js` presentes; sin `~/.aws`; 0 archivos con patrones de credenciales en `dist`, `migrations` y `config` |
| `docker build -t geobot-frontend:ci frontend` | construida |
| `nginx -t` y 4 pruebas con la imagen real `nginxinc/nginx-unprivileged:1.27-alpine` | pasan |

## Informe de 31 casos desde resultados

`npm --prefix backend run in-collect` (script `scripts/in-collect-results.ts`) ejecutó las suites que cubren cada caso y guardó 49 resultados con su salida y SHA-256 en `corridas/` y `resultados/`; `npm run report:in` generó [`matriz-controlada.md`](matriz-controlada.md): **1/30 activos conformes (N310, que exige solo C), 29 pendientes por componentes reales (A/P/H/B) faltantes, 0 fallos, N309 descartado**. Los 29 casos pendientes tienen cubiertas sus partes C y DB (todas las cantidades del manifiesto en esas partes) y señalan exactamente qué componente real falta.

## Qué no se ejecutó

| Elemento | Motivo |
| --- | --- |
| Rol IAM real, 2 modelos reales, 4 denegaciones reales, IMDSv2 del servidor | sin acceso AWS (T074/T075) |
| Firefox, WebKit y móviles emulados de Playwright | no lanzan localmente; los verifica CI |
| Chrome Android / Safari iOS reales, lectores | sin dispositivos (T077) |
| 100 × 2 días, 3 × 25 × 2 días, 150 registros | sin producción (T078) |
| 180 medidas del Observatorio/Geoportal | sin destinos reales (T079) |
| Dos ejecuciones horarias del servicio `chat-purge` desplegado | solo el bucle con intervalo reducido (ver `purga-controlada.md`) |

## Hallazgos de esta pasada

Ver [`hallazgos.md`](hallazgos.md): 19 corregidos con prueba que falló antes; ninguno REAL.
