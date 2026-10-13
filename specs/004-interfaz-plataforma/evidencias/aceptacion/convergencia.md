# Convergencia SPEC002 / SPEC003 → SPEC004 (T002)

Tabla de equivalencias entre artefactos planificados y rutas reales, y propietario de cada brecha. Ninguna tarea previa se marca por existencia de archivo.

## Rutas SPEC003 → reales

| SPEC003 (planificado) | Real hoy | Destino SPEC004 |
| --- | --- | --- |
| `frontend/src/context/ChatContext.tsx` | `frontend/shared/consent.ts` (reducer) + estado local en `smart/SmartAgentPanel.tsx` | `frontend/chat/ChatContext.tsx`, `sessionReducer.ts` (T010/T014) |
| `frontend/src/components/ChatBot/ChatWidget.tsx` | `smart/SmartAgentPanel.tsx` | delega en `frontend/chat/ChatPanel.tsx` (T026) |
| `…/ConsentPrompt.tsx`, `WelcomeMessage.tsx` | bloque `consent-box` de `SmartAgentPanel` | `frontend/chat/StartupFlow.tsx` (T014) |
| `…/EmergencyContacts.tsx` | sección `urgent-channels` de `SmartAgentPanel` | `frontend/chat/ContactChannels.tsx` (T048) |
| `frontend/src/services/api.ts` | `fetchWithSession` en `shared/session.ts` + fetch inline | `frontend/shared/chatClient.ts` (T011) |
| `/api/contacts/emergency` | `GET /api/chat/config` (campo `contactos`) | contrato español de SPEC002 |

## Contrato ciudadano

Fuente única: `specs/002-diseno-modelo-ia/contracts/chat-api.md` y `contracts/citizen-api.md` de SPEC004. Campos `pregunta`, `conversationId`, `categoria`, `historial[{pregunta,respuesta}]`; sin `message/history/provider/model/autoRoute/autorizo`. Config: `GET /api/chat/config`. ID: `POST /api/conversations` `{autorizacion:true,policyVersion}`.

## Tareas reutilizadas de SPEC002 (marcadas, a verificar en T008/T018)

| Superficie | Tareas | Evidencia de código |
| --- | --- | --- |
| Contrato/validación | T006/T013/T014 | `backend/src/chat/{contracts,validateRequest,errors}.ts` |
| Conversaciones/registro | T043/T044 | `chat/{conversations,records}.ts`, migraciones 003/004 |
| Retención | T063/T064 | `chat/retention.ts`, migración 005 |
| Perímetro | T070 | `chat/perimeter.ts` |
| Bedrock | T056/T058 | `src/bedrock/`, `chat/orchestrator.ts` |
| Contactos admin | T011/T035–T038/T069 | `routes/adminContacts.ts`, migración 001 |
| Config | T068 | `routes/chatConfig.ts` |

## Brechas que completa SPEC004

| Brecha | Tarea | Propietario |
| --- | --- | --- |
| Token solo memoria | T011 | frontend/shared |
| Cliente español con plazo 45 s | T011/T045 | frontend/shared |
| Servicio de valoración (RF-C3-IN-09) | T061–T068 | backend/chat + migración 007 |
| Launcher/iframe/CSP | T022–T028 | frontend/widget, nginx |
| Renderer AST + ExternalLink | T034–T037 | frontend/shared |
| Reintentos/espera/fallo | T044–T049 | frontend/chat |
| Nueva conversación | T055–T058 | frontend/chat |
| Pruebas real AWS/portal/dispositivos | T077–T083 | externo; permanecen pendientes si falta acceso |

## Limitaciones declaradas

Las tareas T092–T098 de SPEC002 (AWS real) y T035 de SPEC003 (navegador real) permanecen pendientes; SPEC004 no las da por cumplidas.
