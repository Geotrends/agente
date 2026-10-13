# US4 local — tiempos, fallos y contactos (T049)

Fecha: 2026-10-10. Componentes: **C + DB** (PostgreSQL real aislado, proveedor doble con demoras), **P-parcial** (imagen real de nginx con `frontend/nginx.conf`, backend IN en el host) y **C emulado** (Chromium). Los fallos son **inducidos**; la disponibilidad real de AWS/Qdrant y los tiempos de producción siguen pendientes (T076/T078).

## Cantidades ejecutadas

| Caso | Prueba | Cantidades y tiempos medidos desde la recepción | Resultado |
| --- | --- | --- | --- |
| C304 | `in-integracion/end-to-end-deadline.test.ts` | 9 errores: 3 VALIDACION (con `campo`), 3 SERVICIO_NO_DISPONIBLE (búsqueda caída, ambos modelos caídos, respuesta sin fuente verificable) con evento técnico + aviso, 2 de tiempo (modelo lento 2,0 s de presupuesto con plazo de 5 s; cuerpo lento 5,0 s) y 1 ERROR_INTERNO; sin texto técnico; 0 filas de consulta; cola y pool liberados | pasa |
| C304 / N302 | mismo archivo | plazo real de 40 s: modelo que no responde → error a los **37,3 s** (≤ 40 s), cola y conexiones liberadas | pasa |
| C304 | mismo archivo | base de conversaciones bloqueada → 503 ≤ 5,6 s y 0 llamadas al modelo (no se cambia a anónima); pool lleno → 503 ≤ 5,6 s sin conexiones colgadas; contactos bloqueados no retrasan una validación (≤ 2,5 s, `canales: []`) | pasa |
| C304 (nginx) | `cache-entrypoint.test.ts` | cuerpo de 8 s por trozos a través de nginx real con `proxy_request_buffering off` y plazo de 5 s: **503 a los 5,4 s** (con buffering previo habría sido 200 tras 8 s) | pasa |
| C310 | `contacts-config.test.ts` | 3 lecturas ≤ 2 s con los valores del registro, edición visible en la lectura siguiente, 0 llamadas al modelo/búsqueda; tablas bloqueadas → 503 en ≤ 2,5 s sin detalles | 2/2 pasan |
| C403 | `frontend/test/query-integration.spec.ts` + `query-attempt.test.ts` | 40 s visible, 50 s → fallo 45–46 s y tardía descartada, plazo propio de cada reintento, reinicio con consulta en vuelo sin herencia del reloj | pasa |
| C404 | `query-integration.spec.ts` (IN-04) + `contracts.test.ts` | 6 salidas (2 validación, 2 internos, 502 HTML, JSON incompleto) con texto fijo; solo VALIDACION sin «Reintentar»; 200 incoherente con la solicitud (4 variantes) → fallo | pasa |
| C406 | `query-integration.spec.ts` (IN-06 + C406) | 4 fallos/recuperaciones de contactos: apertura (≤ 5 s, texto fijo sin teléfonos de reserva), fallo de consulta con snapshot (no vuelve a pedir), nueva conversación con contactos caídos (conserva el snapshot), recarga con contactos caídos + emergencia tras recuperación | pasa |

## Cambios de código

- `chat/requestContext.ts`, `chat/deadline.ts`: plazo monotónico desde la recepción; `targetRemainingMs` = restante − 1 s.
- `chat/modelRouting.ts`: el plazo se cumple por carrera con la cancelación aunque el adaptador la ignore.
- `chat/unavailable.ts`, `admin/serviceEvents.ts`, migración `008_eventos_servicio.sql`: evento mínimo (código, componente, modo) + aviso agrupado; sin texto ni identificadores. Se retira a `chat_maint` el `UPDATE (cited_documents)`.
- `chat/errors.ts`: el error lee canales con presupuesto de 1,5 s y devuelve lista vacía si no llegan; no consulta la base en 403/413/429; `sinCanales` cuando los contactos son lo que falló.
- Frontend: coherencia modo/`conversationId` de la respuesta; una conversación autorizada con credencial perdida solo reanuda con «Nueva conversación».

## Salvedades

- Prueba intermitente observada: `query-failures.spec.ts` («espera: indicador literal ≤500 ms») falló una vez con 4 workers de Playwright en paralelo y pasó 2/2 en aislamiento; es sensible a carga de la máquina.
- Chromium únicamente; Firefox/WebKit/móviles reales sin ejecutar.
- Las demoras de modelo/búsqueda son del doble; el comportamiento con Bedrock real (timeouts de SDK) requiere T075/T076.
