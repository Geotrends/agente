# Puerta de foundation SPEC004 (T012, T013, T018)

Fecha: 2026-10-10. Adapter: **controlled** (PostgreSQL 16.13 real, aislado, creado en directorio temporal; proveedor Bedrock **doble**, sin red; reloj real). Estos resultados NO acreditan Bedrock real, KB publicada ni portal (T081).

## Resultados

| Suite | Resultado |
| --- | --- |
| `backend`: `tsc -p tsconfig.check.json` | sin errores |
| `frontend`: `npm run typecheck` | sin errores |
| `frontend`: `npm run test:ui` (Vitest) | 32/32 (contracts 14, history 11, startup 7) |
| `frontend`: `npm test` (heredadas, node:test) | 17/17 |
| `backend`: `test:ui-integration` | 8/8 (prerequisites 5, privacy 3) |
| `backend`: `test/di-integracion/*` (regresión SPEC002) | 57/66 en la primera corrida (9 requerían Qdrant); **64/64** con Qdrant en Docker (ver `integracion-local.md`) |
| `frontend`: `next build` (export estático) | compila; rutas `/`, `/chat`, `/admin/*` |

## Tareas SPEC002 reutilizadas con evidencia

| Tarea SPEC004 | Verificado con |
| --- | --- |
| T012 endpoints/registro | `prerequisites.test.ts` (UUID backend, responseId solo tras commit, fallo de registro → sin responseId, anónimo sin filas, config ≤2 s no-store); `privacy.test.ts` (texto solo en `chat.interaction`, no en `conversation` ni logs); `di-integracion/consent|privacy|migrations` |
| T013 contrato español/errores/proveedor | `consent.test.ts` (campos legacy `provider/model/autoRoute/message/history` → 400); `src/chat/runtime.ts` cablea solo Bedrock; `/providers` eliminado; perímetro y no-store en `routes/chat.ts` |

## Brechas que quedan abiertas (no se afirman cumplidas)

- Purga de 12 meses calendario + ≤24 h y plazo C3 ≤40 s con reloj real: cubiertos por pruebas SPEC002 (`retention`, `deadline`) pero no re-ejecutados aquí con volumen existente.
- Aceptación real Bedrock/KB publicada: T081 y SPEC002 T092–T098.
- Recorridos de storage en Chrome/Firefox reales: preparados en `frontend/test/storage.spec.ts`, se ejecutan en T029/T079.
