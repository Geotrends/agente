# US2 local — respuestas registradas y valoración (T030)

Fecha: 2026-10-10. Componentes: **C + DB** (PostgreSQL real aislado, proveedor doble) y **C emulado** (Chromium headless, API simulada). No acredita A/P/B.

## Cantidades ejecutadas

| Caso | Prueba | Cantidades | Resultado |
| --- | --- | --- | --- |
| C303 | `in-integracion/results-records.test.ts` (1.º) | 10 consultas: 6 autorizadas / 4 anónimas; los cuatro tipos; fuentes `{id,nombre,enlace https,fecha}` exactas, únicas y `[]` en no respondidas; 6 `responseId` distintos; 6 filas `interaction` y 4 `anonymous_usage` | pasa |
| C305 | `results-records` (2.º) | 8 éxitos → 8 registros con los 9 campos + modelo efectivo, tokens y costo `0.000013000000` (tarifa 0.07/0.30); `response_id` y `cited_documents` coinciden con lo entregado | pasa |
| C308 (parte) | `results-records` (3.º y 4.º) | fallo de escritura: respuesta completa sin `responseId`, 0 filas, el texto perdido no se reenvía; commit más lento que el presupuesto: sin ID y dentro del plazo | pasa |
| H005-05 | `results-records` (5.º) | `received_at` = llegada (<300 ms); `duration_ms` ≥900 ms con espera de cola (concurrencia 1, modelo 500 ms) | pasa |
| C309 | `ui-integracion/feedback-api.test.ts` | 12 envíos: 7 guardados / 5 rechazados (B09); rechazo uniforme byte a byte (inexistente, ajeno, depurado, duplicado); 5 envíos simultáneos → 1 fila y un 201 | pasa |
| C309 | `feedback-database.test.ts` | bloqueo de purga más largo que el presupuesto → 503 en <5.5 s, sin 201 tardío ni fila al liberar el lock | pasa |
| C405 | `frontend/test/feedback.spec.ts` | 6 respuestas (2 con ID, 2 autorizadas sin ID, 2 anónimas): solo 2 grupos de valoración y 0 elementos enfocables ocultos | pasa |
| C309 UI | `feedback.spec.ts` | confirmación perdida (red) y luego 400 de duplicado: sin «Gracias» y sin solicitudes automáticas | pasa |
| T026 | `public-response.test.ts` | validador de la respuesta pública: 10 violaciones rechazadas | pasa |

## Cambios de código

- `chat/records.ts`: escritura acotada (`saveInteractionDetailed`, estado de persistencia), allowlist de fuentes persistibles.
- `chat/contracts.ts`: `assertPublicResponse` antes de serializar; `handleChat` devuelve 500 genérico si el cuerpo no cumple.
- `chat/feedback.ts`, `routes/feedback.ts`: valoración con presupuesto; sin 201 tardío.
- Frontend `shared/chatContracts.ts`/`chatClient.ts`: 200 incoherente con la solicitud (modo/conversationId) o con fuentes en no respondidas → «no interpretable».

## Salvedades

La función `chat.register_rating` y la migración 007 no se modificaron (verificadas). Costos y modelos en pruebas son de un doble; la verificación de costo/modelo real corresponde a T076 (A/P).
