# US1 local — continuidad y decisión de datos (T022)

Fecha: 2026-10-10. Componentes: **C + DB** (backend, PostgreSQL real aislado, proveedor doble) y **C emulado** (Chromium headless con API simulada). **No** acredita A/P/B: sin AWS, nginx, portal ni dispositivos reales. No cierra T035 de SPEC003 ni tareas de SPEC002/004.

## Cantidades ejecutadas

| Caso | Prueba | Cantidades | Resultado |
| --- | --- | --- | --- |
| C301 | `di-integracion/consent.test.ts` «C301» | 3 conversaciones × 3 turnos (9 filas, 3 por conversación), 5 anónimas (0 filas de conversación/interacción nuevas, `anonymous_usage`=5), 3 IDs sin derecho (no emitido, ajeno, depurado por la purga real) → 400 `conversationId`, 0 llamadas al modelo, 0 registros | pasa |
| C302 | `consent.test.ts` «12 solicitudes» + «C302» | 12 peticiones (8 válidas / 4 inválidas); 15 pares enviados → 10 efectivos; pares incompletos/vacíos y historial sin conversación → 400 antes de modelo y registro | pasa |
| C401 | `frontend/test/in-continuity.spec.ts` (6) | autorizar = 1 ID; anónimo = 0 creaciones; nueva conversación y recarga = IDs distintos y sin storage; creación fallida; doble clic = 1 creación | 6/6 pasan |
| C402 | `in-continuity.spec.ts` (3) | 12 turnos autorizados con 0,1,…,10,10 pares y primer par del turno 12 = turno 2; anónimo 4 turnos sin historial/ID; fallo fuera de historial y 401 sin replay ni sesión nueva | 3/3 pasan |
| T021 | `frontend/test/in-session.test.ts` | token vencido: renovación solo en modo anónimo; conversación autorizada no renueva; 401 no reenvía | 5/5 pasan |

## Cambios de código

- `frontend/shared/session.ts`, `chat/sessionReducer.ts`, `chat/types.ts`, `chat/QueryFailure.tsx`, `chat/ChatContext.tsx`: la credencial de una conversación autorizada no se renueva en silencio; un fallo de sesión marca `sessionLost` y solo «Nueva conversación» reanuda. Una creación por autorización (guarda síncrona).
- `backend/src/chat/conversations.ts`, `routes/conversations.ts`, `chat/handleChat.ts`: lectura/creación de conversación acotadas al presupuesto; una base de propiedad que no responde da `SERVICIO_NO_DISPONIBLE`, nunca modo anónimo.

## Matriz de identificadores

| Identificador | Resultado |
| --- | --- |
| propio, credencial propia | 200, modo conversación, `responseId` único |
| UUID v4 no emitido | 400 `conversationId` |
| de otra credencial | 400 `conversationId` (mismo mensaje) |
| conversación depurada (inactiva >24 h sin interacciones) | 400 `conversationId` |
| ausente + historial | 400 `historial` |

## Salvedades

Datos 100 % sintéticos; ningún texto ciudadano real. La suite Playwright usa un host fixture y la API simulada (`page.route`); la propiedad de IDs la prueba el backend con base real. Tráfico real nginx/navegador real queda para T076/T077.
