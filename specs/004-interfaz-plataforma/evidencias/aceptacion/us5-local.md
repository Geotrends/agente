# US5 — resultados locales (T072)

Fecha 2026-10-10. Adapter **controlled** para la UI (API simulada con `page.route`) y **PostgreSQL 16 real** para el servicio de valoración. Lector de pantalla real: pendiente.

| Suite | Resultado |
| --- | --- |
| `backend/test/ui-integracion/feedback-api.test.ts` — **B09**: 12 envíos (7 válidos: 2 «Útil» + 5 motivos; 5 inválidos: ID inexistente, duplicado, motivo ausente, motivo con «Útil», motivo fuera de lista), cruce con el registro; texto libre, `null`, tipos, ID ajeno/depurado/anónimo, 401/403, `no-store`, mensaje uniforme | 3/3 |
| `backend/test/ui-integracion/feedback-database.test.ts` — dos envíos concurrentes: un 201 y un 400; sin INSERT/UPDATE/DELETE/DDL directos; purga de 12 meses no bloqueada por la FK y estadística conservada; carrera purga/valoración; migración limpia/existente/idempotente | 5/5 |
| `frontend/test/feedback.test.tsx` — elegibilidad, 6 variantes IN-05, «Útil»/5 motivos, doble clic, pérdida de acuse, nueva epoch, a11y básica | 14/14 |
| `frontend/test/feedback.spec.ts` — 10 valoradas (5 útiles / 5 no útiles, una por motivo), 3 anónimas sin controles, teclado, pérdida de acuse, nueva conversación con valoración pendiente | 5/5 |
| `frontend/test/feedback-a11y.spec.ts` — axe A/AA en disponible, motivo, enviando, confirmada y fallida | 1/1, 0 violaciones |

## Comprobaciones clave

- «Gracias por su valoración» **solo** con `201 {responseId, registrada:true}` del mismo `responseId`; un 400 (duplicado tras pérdida de acuse) o un 503 se muestran como fallo y **no** como éxito; la respuesta permanece y la consulta no se reenvía.
- Tras un fallo solo se puede reintentar la misma selección (no se permite cambiar para evadir la unicidad).
- Ningún `responseId` se fabrica en el cliente; sin ID (fallo de registro) y anónimo: cero controles, cero elementos enfocables ocultos y cero solicitudes.
- Servicio sin LLM; mensaje 400 uniforme (`No se pudo registrar la valoración.`) que no distingue inexistente/ajena/depurada/duplicada.
- La fila se escribe en la misma transacción que valida propiedad; la purga la espera (`FOR SHARE`).

## Pendiente

- Lector de pantalla real y zoom 200 % (T080); diez valoraciones contra la KB y Bedrock reales (T081).
- Aplicación de la migración 007 sobre el volumen real existente del usuario (despliegue autorizado).
