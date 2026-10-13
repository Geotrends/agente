# Fundamento SPEC005 (T015)

Fecha: 2026-10-10. Entorno: PostgreSQL 16 local aislado (`127.0.0.1:55432`), Qdrant 1.19 local, proveedor Bedrock **doble**. Componentes: **C + DB**. No acredita A/P/H/B.

## Contradicciones demostradas antes de corregir

| Hallazgo | Prueba que falló antes | Corrección |
| --- | --- | --- |
| H005-01 Origin ausente permitido | `reception-perimeter`: POST `/chat`, `/conversations`, `/ratings` sin Origin → 401/200 en lugar de 403 | `originGuard` exige Origin en toda solicitud con efecto; guardas antes de CORS (`app.ts`) |
| Preflight respondido por `cors()` antes del guard | OPTIONS ajeno recibía 204 | `preflightGuard` valida origen, método y cabeceras y responde 403 sin `Access-Control-*` |
| Cuota compartida | 70 preflights + 30 config + 20 conversaciones consumían los 60 turnos | ventana propia `prepWindow` (`CHAT_PREP_RATE_LIMIT_PER_MINUTE`, 300) para preparación/config/valoración |
| H005-04/05 plazo y fecha tras la cola | `received_at` iba 806 ms después de los encabezados con cuerpo lento | `RequestContext` creado en `receptionMiddleware`; `Deadline.forContext`; `handleChat` usa `deadline.receivedAt` y `elapsedMs()` |
| 401 sin catálogo ni no-store | respuesta `{error, code}` sin `Cache-Control` | `requireSession` usa `sendError("NO_AUTORIZADO")` |

## Hallazgo nuevo (técnico)

`statement_timeout` de PostgreSQL **no acota el COMMIT** (el servidor lo desactiva antes de confirmar; un trigger diferido de 2 s se completó pese a `statement_timeout=450 ms`). Consecuencia en el diseño: un COMMIT que excede el presupuesto se trata como `indeterminada` (sin `responseId`, sin reintento, conexión descartada); solo el cliente puede acotarlo. Cubierto por `db-budget.test.ts`.

## Suites ejecutadas (todas sin omitir casos)

| Suite | Resultado |
| --- | --- |
| `typecheck` backend | sin errores |
| `npm test` (unitarias) | 334/334 |
| `test:di-integration` | 66/66 (64 previas + C301/C302) |
| `test:ui-integration` | 18/18 |
| `test:in-integration` | 13/13 (`reception-perimeter` 6, `db-budget` 7) |
| `nginx -t` (imagen `nginxinc/nginx-unprivileged:1.27-alpine`) | configuración válida |

## Cambios de expectativas heredadas (no se desactivó ninguna prueba)

- `di-integracion/chat-perimeter.test.ts`: «sin Origin → 200» pasó a «403» (H005-01); las demás peticiones llevan Origin explícito.
- Una corrida completa de `test:di-integration` mostró un fallo aislado de `admin-contacts` («inmediatos») bajo carga concurrente de la máquina; no reprodujo (3 corridas posteriores 66/66 y el archivo suelto 4/4). Se deja registrado como posible sensibilidad a carga, sin causa raíz identificada.

## Pendiente (no cubierto aquí)

nginx efectivo con cabeceras reales (T040), TRUST_PROXY (T052), credenciales/IAM (T054/T055), plazo extremo a extremo con demoras de cola/modelo (T042).
