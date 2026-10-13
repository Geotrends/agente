# Continuidad SPEC005 (T002)

Fecha: 2026-10-10. Propietarios técnicos y equivalencias reales; evita crear rutas, tablas o evidencias paralelas.

## Equivalencia de tablas y rutas reales

| Concepto del spec | Objeto real | Propietario de la corrección |
| --- | --- | --- |
| Conversación autorizada | `chat.conversation` (`transport_binding_hash`, `policy_version`, `clarification_pending`) | SPEC005 corrige en `backend/src/chat/conversations.ts` |
| Interacción registrada | `chat.interaction` (`row_id` interno, `response_id` UNIQUE) | SPEC005 en `chat/records.ts`, `chat/retention.ts` |
| Consumo anónimo | `chat.anonymous_usage` (6 campos) | SPEC005 en `chat/records.ts` |
| Valoración | `chat.valoracion` + función `chat.register_rating` (migración 007) | SPEC004 define; SPEC005 verifica |
| Contactos | `admin.contact_*` + `readContactSnapshot` | SPEC002; SPEC005 verifica lectura/presupuesto |
| Aviso/estado operativo | `admin.notification`, `admin.component_status` (`admin/operations.ts`) | SPEC002; SPEC005 añade episodio con modo |
| Evento de servicio (nuevo) | `admin.service_event` (migración **008**, solo si sigue libre) | SPEC005 |
| API | `/api/{session,chat/config,conversations,chat,ratings}` (+ `/api/admin/*`) | única; no se crea API paralela |

## Migraciones

Aplicadas y preservadas: `backend/migrations/chat/001`–`007` y `backend/migrations/001`–`004` (KB). **Siguiente número libre del esquema chat: 008.** Ninguna migración aplicada se reescribe.

## Evidencia compartida

- SPEC002 T092–T098 y SPEC004 T078–T084 se referencian, no se cierran por esta evidencia.
- Una corrida válida de SPEC005 puede citarse en SPEC002/004 si conserva versión, cantidades y componente.
- SPEC001 T082/T083 siguen siendo de SPEC001; IN-13 solo usa su reindexación.

## Reglas de trabajo

- Un propietario por corrección; una prueba por contradicción (debe fallar contra el código actual antes de corregir).
- Arnés con Origin explícito; no se amplía `CHAT_ALLOWED_ORIGINS` productivo para pruebas.
- Dobles solo en pruebas; toda evidencia etiqueta componente C/DB/A/P/H/B.
