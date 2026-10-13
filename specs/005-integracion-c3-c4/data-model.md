# Data model: SPEC005

Diseño incremental sobre esquemas existentes. RF-C3-IN-01/03/05/06/07/08/09, RNF-C3-IN-01/10/12 y RF-C4-IN-01/02/03/05. No aplicar migraciones en esta fase.

## Entidades persistentes existentes

| Entidad física | Campos y relaciones | Validación / conservación |
| --- | --- | --- |
| `chat.conversation` | `conversation_id` UUID v4 PK, created_at, authorized_at, policy_version, transport_binding_hash, clarification_pending, last_active_at | Solo elección explícita Autorizo; propietario por bindingHash de sesión técnica. Sin pregunta/respuesta/historial. No recuperar sesión vieja tras expiración. |
| `chat.interaction` | row_id bigint interno; conversation_id FK; response_id UUID v4 UNIQUE; received_at UTC; mode; category; question_text/answer_text; result_type; cited_documents; duration_ms; visible_output_tokens; model; input_tokens/output_tokens; tariff_version; estimated_cost; purged_at | Solo éxito autorizado. ID público después de commit confirmado. Pregunta/respuesta saneadas independientemente de entrega. Fecha desde recepción, duración incluye cuerpo/auth/cola hasta la preparación del INSERT; la confirmación del propio commit no puede medirse dentro del valor que está confirmando. Latencia de entrega se mide por separado hasta cuerpo completo al cliente. |
| `chat.anonymous_usage` | **Solo** received_at, mode, model, input_tokens, output_tokens, estimated_cost | Un éxito anónimo=una fila. Sin PK ciudadano, UUID, categoría, resultado, documentos, duración, texto, historial, IP, token, hash ni valoración. |
| `chat.valoracion` | interaction_row_id FK a interaction.row_id UNIQUE; valoracion, motivo, created_at | Útil→motivo omitido en petición/NULL persistido; No útil→uno de 5 motivos. Función existente register_rating verifica propiedad/vigencia en transacción; compite con purga mediante lock de interacción. Conserva FK interna/estadísticas después de purga. |
| `chat.tariff` | version, model_id, region, currency, input/output_price_per_million, valid_from/to, source_url, registered_at | Misma tarifa de SPEC002, sin períodos solapados. Costo según modelo efectivo/consumo; no inventar tarifa ni costo cero si falta. |
| `chat.purge_run` | run_id, started_at, finished_at, cutoff_at, rows_purged, status | en_curso→ok/error. Dos ejecuciones horarias observadas; inicio/fin reales e idempotencia. |
| Contactos `admin.*` | Registro de recepción/general/inmediatos existente, revisión y auditoría | Snapshot íntegro validado, solo oficiales; edición autorizada visible sin redespliegue. No duplicar contacto en chat. |
| `admin.component_status` | component, status, last_success_at, last_failure_at, updated_at, threshold_applied, safe_reason | El registro recupera normal en primer éxito; estado observado, no «credenciales configuradas». Razones permitidas sin contenido/secretos. |
| `admin.notification` | id operativo, type, object_type/object_id, safe_description, state, first_at, last_at, repetitions, reviewed_by/at | Avisos de registro agrupados por episodio operativo, no ID ciudadano. Primer fallo incluye fecha/modo; continuaciones no incrementan avisos. Revisar no significa recuperar servicio. |

Los nombres físicos corresponden a migraciones 001–007. No crear `chat.conversacion` o `chat.interaccion` por nombres históricos de planes. Roles chat_app/admin_app/chat_maint permanecen; grants nuevos solo para lo necesario.

## Estado volátil ciudadano

Reusar PanelSession de SPEC004: epoch interno, decisión pendiente/autorizo/no_autorizo, conversationId opcional, política, categoría opcional, mensajes visibles, successfulPairs y activeAttempt. Ninguno persiste ni viaja al host como contenido.

- Pendiente→creación confirmada→autorizo; pendiente→no_autorizo sin creación. Campo de consulta solo después de apertura/datos/categoría.
- Historial: pares completos cronológicos, slice(-10) al enviar; primera autorizada y toda anónima omiten historial.
- Intento: payload congelado, sequence/epoch locales, retryCount 0..2, inicio/plazo; éxito agrega par autorizado, fallo no agrega. Reinicio invalida epoch antes de abortar y elimina token/IDs/contexto anterior según contrato de sesión.
- responseId solo de C3 confirmado; sin él no hay control de valoración ni elemento oculto enfocables.
- Ocultar conserva iframe/estado; recarga/cierre destruye estado. Nada en storage/cookies/URL/postMessage.

## RequestContext interno propuesto

| Campo | Uso |
| --- | --- |
| receivedAt:Date UTC | Creado al llegar headers al backend, antes de body/auth; fecha persistida en éxito y evento seguro |
| startedMonotonicMs:number | Inicio monotónico para plazos y duración, sin depender de ajustes de reloj |
| expiresMonotonicMs:number | started+40000 ms como máximo; objetivo de finalización 39000 ms |
| signal:AbortSignal | Propaga cancelación a lectura/cola/búsqueda/SDK/DB y composición de error |
| terminalState | activa→respuesta o error o desconectada; solo una salida; cleanup en todas |
| persistenceState | no_iniciada→en_curso→confirmada, fallida/cancelada o indeterminada; responseId público solo confirmada |

No serializar RequestContext ni usarlo para identificar anónimas. Adquisición de pool, statement/lock/commit y cleanup se acotan al presupuesto restante. Cada conexión adquirida tarde se libera; query cancelada se observa y cliente se descarta cuando no puede garantizarse estado limpio. No usar timers como prueba de cancelación efectiva. Si el commit quedó indeterminado, no emitir ID ni reenviar texto para «repararlo»; observar transacción hasta resultado/rollback; no afirmar inexistencia de fila si se perdió confirmación. La finalización no debe esperar avisos en BD.

## Episodio de registro y evento técnico

**RegistryEpisode** (memoria segura de Operations/records): episodeId operativo aleatorio sin vínculo ciudadano, firstFailureAt, mode (`conversación`/`anónima`), state (`abierto`/`cerrado`), aviso (`pendiente`/`persistido`), recoveredAt opcional. No texto, categoría, responseId, conversationId, IP, token ni hash. Los errores previos a modo validado no crean un episodio de registro de consulta.

Transiciones: normal→primer fallo abre episodio y notifica una vez; más fallos conservan; primer éxito cierra, reporta registro normal y drena aviso pendiente serializadamente. Segundo episodio usa object_id operativo nuevo y no se mezcla con aviso anterior sin revisar. Si cae admin DB, se muestra buffer seguro en panel existente y se intenta persistir al recuperarse. La muerte del proceso pierde buffer volátil; no promete recuperar texto ni exact-once entre reinicios.

**Evento de indisponibilidad** propuesto: tabla operativa `admin.service_event` con event_id interno, occurred_at, code cerrado (`SERVICIO_NO_DISPONIBLE`), component cerrado (modelos/busqueda/plazo), mode opcional de contrato validado. Sin texto/IDs públicos ni métricas de consumo inventadas. Se guarda de mejor esfuerzo junto con aviso seguro; si cae DB se retiene únicamente ese evento seguro en memoria hasta recuperación, sin bloquear error≤40 s. Índice/roles por finalidad operativa; no añadir vínculo que reconstruya una consulta anónima. Una migración nueva (008 solo si sigue libre) agrega esta tabla y los permisos mínimos; no altera migraciones ya aplicadas.

## Depuración y protección de fuentes

A los 12 meses calendario se ponen a NULL question_text, answer_text, conversation_id, response_id; purged_at marca ejecución. Se conservan exactamente received_at, mode, category, result_type, cited_documents, duration_ms, visible_output_tokens, model, tokens, tarifa, costo y row_id. Fuentes son allowlist `{id,nombre,enlace,fecha}` derivadas del catálogo publicado, no salida arbitraria del modelo con datos personales. Valoración queda sobre row_id, sin UUID público copiado.

Eliminar conversaciones sin interacciones referenciadas según política existente de inactividad. Probar inexistencia de textos/IDs retirados en todas tablas/salidas y que otras conversaciones recientes conservan propiedad. Purga y valoración simultáneas usan función/locks existentes; valoración sobre UUID depurado rechaza.

## Evidencia sin ampliar registro ciudadano

Manifiesto offline: runId/caseId, versiones, hashes, requisitos, componentes reales/controlados, cantidad/tiempo/status/validación, resultado y referencias. Identificadores operativos de corrida nunca se añaden a consulta o tabla anónima. Para pruebas se usa PII sintética; credenciales/headers/textos de ciudadanos reales se excluyen de artefactos. Conciliación anónima por multiset de seis campos en ventana de tráfico exclusiva, no por fila global o nueva identidad.
