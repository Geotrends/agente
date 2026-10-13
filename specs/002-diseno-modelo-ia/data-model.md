# Modelo de datos — Bloque 2

Fecha:2026-10-08. Diseño, no migraciones implementadas. [Investigación](research.md), [contrato público](contracts/chat-api.md), [contrato administrativo](contracts/admin-api.md).

## Propiedad y permisos

Preservar `kb` con su writer/lector actuales y alias publicado Qdrant. Añadir `chat` y `admin`, propietarios no-login controlados por migrador privilegiado separado. Runtime chat solo operaciones necesarias en conversación/interacción/consumo y lectura de snapshot/contactos/tarifas; runtime admin acceso específico a cuentas/sesiones/contactos/estado/avisos, sin modificar KB ni auditoría. Rol de mantenimiento limitado a purga y estado programado. Usar funciones parametrizadas para mutaciones auditadas y protección del último administrador; ejecución restringida y search_path seguro. Roles SQL no equivalen a perfiles de usuario.

Migraciones numeradas nuevas, transaccionales, registro de aplicación por esquema; no editar 001 aplicada. Bootstrap se ejecuta también con volúmenes existentes, sin depender del entrypoint de primer arranque. Cada tabla nueva necesita grants/revokes explícitos; nunca conceder propietario o superusuario al backend. RF-C3-DI-16, RF-C3-AD-41, constitución III/VII.

## Entidades de conversación

### Conversation — `chat.conversacion`

- `conversation_id`: UUIDv 4, emitido exclusivamente backend; PK mientras vigente.
- `created_at`: timestamptz; `authorized_at`: timestamptz, evidencia de decisión Autorizo; `policy_version`: versión de política mostrada.
- `transport_binding_hash`: hash de credencial técnica vigente que autoriza usar esta conversación; nunca expuesto ni usado en modo anónimo persistente.
- `clarification_pending`: booleano, inicialmente false; no historial ni texto en esta tabla.
- `last_active_at`: timestamptz para operación; no inventar duración contractual de consentimiento.

Relación 1:N con interacciones autorizadas; rechazo de UUID desconocido o de otra sesión técnica. No crear para No autorizo. No confiar en UUID presentado por cliente como autorización. Al depurar todas sus interacciones vencidas, eliminar registro de conversación si ya no tiene filas vigentes; una nueva conversación requiere UUID nuevo. IN-01/02, C4-DC-02.

### Interaction — `chat.interaccion`

- `row_id`: bigint técnico interno, sin significado ciudadano ni exposición pública; conserva estadísticas después de purga.
- `conversation_id`: UUID FK nullable; `response_id`: UUIDv 4 nullable, único mientras existe; emitido solo tras commit.
- `received_at`: timestamptz, `mode`: constante conversación.
- `category`: enum Ecosistemas/Bienestar Animal/Gestión Ambiental o null; `question_text`, `answer_text`: texto previamente saneado.
- `result_type`: respondida/sin información/fuera de alcance/aclaración; `cited_documents`: snapshot de identificador/nombre/URL/fecha, vacío salvo respondida.
- `duration_ms`: entero≥0; `visible_output_tokens`: entero 0..2200.
- `model`: gpt-oss-20b/gpt-oss-120b/none; `input_tokens`, `output_tokens`: entero≥0; `tariff_version`: FK nullable si none; `estimated_cost`: decimal no negativo.
- `purged_at`: timestamptz nullable.

Para consultas sin LLM: modelo none, tokens 0/costo 0 demostrables, no tarifa; para consultas con LLM no permitir tokens ni tarifa inventados. Fuentes y respuesta deben corresponder; no guardar razonamiento, cuerpoAWS ni error crudo. Tras 12 meses y≤24 h, vaciar textos y conversation_id/response_id; conservar campos restantes del contrato (categoría/tipo/fuentes/modelo/tokens/costo/duración), registrar ejecución. No hay ruta administrativa para recuperar textos depurados. DI-16, IN-03/05/06 y RNF-IN-01.

### AnonymousTechnicalRecord — `chat.consumo_anonimo`

Únicamente `received_at`, `mode=anónima`, `model`, `input_tokens`, `output_tokens`, `estimated_cost`. Modelo/tokens/costo de DI-16; tarifa vigente se usa al calcular pero no añadir enlaces a ciudadano ni campos no exigidos. No PK de consulta, UUID, conversation_id/response_id, texto/hash, token/IP, categoría, tipo de resultado, documentos, historial, duración ni valoración. Índice por fecha/modelo para operación; varias filas iguales son válidas. Sin fila de conversación.

El anonimato es ausencia de contenido e identificadores persistentes, no un UUID denominado anónimo. Captura de red de aceptación con datos sintéticos y solo en entorno de prueba. DI-16 e IN-07; C4-DC-02.

### Tariff — `admin.tarifa_modelo`

`version` PK, `model_id` de allowlist, `region`, `currency`, `input_price_per_million`, `output_price_per_million` NUMERIC≥0, `valid_from`, `valid_to` nullable, `source_url` oficial, `registered_at`. Sin periodos activos solapados por modelo/región. Configurada por operador de despliegue/migrador, no edición nueva del panel sin requisito. Coste = (inputTokens×precioEntrada + outputTokens×precioSalida)/1.000.000 con aritmética decimal y precisión documentada; almacenar snapshot/version en autorizadas para recálculo. Anónimas guardan solo resultado estimado conforme IN-07; tarifas históricas permiten reconstruir por fecha/modelo. No inventar tarifa 0 para consultaAWS. DI-16.

### PurgeRun — `chat.purga_ejecucion`

`run_id` técnico, `started_at`, `finished_at`, `cutoff_at`, `rows_purged`, `status`; sin texto ni UUID ciudadano. Tarea horaria idempotente, cortes de 12 meses de calendario y no 365 d fijos; garantiza 12 meses+24 h. Transacción actualiza textos/IDs y libera referencias a conversación; restricciones de FK no impiden purga. RNF-IN-01.

## Entidades de contactos

### ContactRegistry — `admin.contacto_registro`

Singleton con `revision` bigint creciente, `updated_at`, `updated_by`; agrupa las tres entidades siguientes. Lectura consistente por snapshot/una transacción en cada consulta, sin caché obsoleta. Todas mutaciones compare-and-swap contra revision; conflicto 409 sin cambios.

### ReceptionChannels — `admin.contacto_recepcion`

Singleton: `pqrsd_url` https obligatoria, `whatsapp` número con dígitos/símbolos permitidos y `email` válido. No nulos/vacíos ni eliminación. Validadores versionados: WhatsApp permite dígitos, espacio,+,-, paréntesis, con al menos un dígito; rechazar letras, no imponer longitud nacional no especificada. No generar valores por prompt. AD-35, DI-24.

### GeneralContact — `admin.contacto_general`

Singleton: `phone` por mismo conjunto permitido, `email` válido, `contact_url` https. Tres datos obligatorios y validación por campo. AD-36, DI-20.

### ImmediateChannel — `admin.contacto_inmediato`

`id` UUID técnico, `name` no vacío, `description`≤120 caracteres, `type` teléfono/correo/url, `value` válido según tipo, `position` entero ordenado y único por snapshot. CRUD/reordenación transaccionales, lista nunca vacía, todos losIDs pertenecen a lista al reordenar. AD-37, DI-19. Snapshot de consulta incluye nombres/valores/orden/revision; cambiar registro repercute en siguiente respuesta.

## Identidad administrativa

### AdminAccount — `admin.cuenta`

`id` UUID, `email` único, `display_name`, `profile` solo administrador técnico/Gestor documental, `active` boolean, `password_phc` argon2id con sal única, `must_change_password`, `failed_attempts`, `locked_until`, `created_at`, `updated_at`. Sin contraseña reversible. Nueva/temporal implica cambio obligatorio distinto de temporal. Nunca activar un tercer perfil. Operaciones de baja/cambio de perfil se serializan con lock transaccional e invariante al menos 1 administrador activo; ni concurrencia puede romperla. AD-08/09/10; RNF-AD-01/02/03/04.

### AdminSession — `admin.sesion`

`token_hash` PK, `account_id` FK, `created_at`, `last_request_at`, `revoked_at`, `csrf_token_hash`; solo hash de secreto de sesión, token opaco en cookie segura. Vence tras 30 min sin solicitud real suya; login bloqueado 5 fallos/15 min por cuenta; IP20 fallos en 15 min → bloqueo 15 min antes de verificar credenciales; login exitoso reinicia los fallos de esa IP (19 fallidos+éxito+5 sin bloqueo). Store de intentosIP sin contenido, saneado y solo para administración. Cerrar sesiones al desactivar o cambiar contraseña según contrato; sesión temporal solo permite cambiar password/logout. RNF-AD-04/05/06 y AD-10.

Bootstrap cuenta inicial por CLI protegida de infraestructura con input porstdin/TTY, sin contraseña en args/env/logs/repositorio; esquema preparado y activo, must_change_password=true. Interfaz completa de alta/baja/reset de cuentas pertenece a bloque 7; probar invariantes mediante integración/CLI controlada y proteger operaciones ya expuestas.

## Operación y auditoría

### OperationalState — `admin.estado_componente`

`component` PK (20b, 120b, reranker, registro, scraper), `status` normal/degradado/no comprobado, `last_success_at`, `last_failure_at`, `updated_at`, `threshold_applied` solo reranker, `safe_reason` estructural sin texto de consulta. Estado DB más overlay volátil del runtime para mostrar DB/write fallando; no consultar exclusivamente la DB averiada para diagnosticarla. Scraper usa última corrida KB real; permisos lectura específicos al admin. AD-48.

### SystemNotification — `admin.notificacion`

`id` UUID interno, `type`, `object` identificador de componente/cuenta/documento, `safe_description`, `state` no_revisada/revisada, `first_at`, `last_at`, `repetitions`, `reviewed_by`, `reviewed_at`. Única no_revisada por tipo+objeto; upsert incrementa contador/fecha. Revisar conserva fila y actor/fecha; nueva ocurrencia tras revisión crea otra. IN-08 limita fallo de escritura a 1 aviso por episodio, no uno por consulta; descripciones sin payload. Integrar listaKB y operación por servicio común con contador técnico, nunca dar runtime acceso dueñoKB. AD-28/29/30.

### AuditEvent — `admin.auditoria`

`id` bigint, `actor_account_id`, `action`, `object_type/id`, `result`, `occurred_at`, cambios de configuración permitidos sin contraseña/documentos/texto de ciudadano. Inserts de mutation exitoso en misma transacción; fallida registra rechazo sin mutar contactos; runtime sinUPDATE/DELETE y sin endpoint correspondiente. Auditoría de fallos de autenticación no almacena password. AD-41 y RNF-AD-07.

## Recuperación y evidencia offline

No añadir tablas documentales paralelas. Payload Qdrant referencia elemento/versión KB y conserva nombre/URL/fechaActualización/fechaAcceso/fragmento/texto/código/tipo. Texto≤1000 incluyendo contexto textual añadido; metadatos fuera del conteo no se confunden con cuerpo. Tablas atómicas; colección y calibración tienen huella de versiones.

`CalibrationReport` artefacto offline: id/fecha, corpusAlias/collection/hash, embeddings/reranker/retrievalPolicy versions, goldenSetHash, lista de umbrales finitos, por cada valor IDs de preguntas respondibles/ausentes, falsa abstención/recall complementario, selectedThreshold y regla de elección. No preguntas de ciudadanos reales sin autorización. DI-05/12/13/14.

`AcceptanceRun` artefacto offline: versión Git+cambios locales identificados, imagen, corpus/contactos/tarifas/prompt, matriz/hash, modelo forzado solo en runner privado, resultado por ID/caso y evidencia manual. Fallos clasificados Datos/Recuperación/Modelo con prioridad original, corregidos y reevaluados. Todos los requisitos DI y VA-01/03/05.

## Estados y transiciones

- Acceso sin decisión → Autorizo: conversación backend; No autorizo: sesión técnica volátil sin fila conversación. No reutilizar registros CSV como prueba de autorización.
- Consulta suficiente → respondida; fuera del ámbito → fuera de alcance; insuficiente → aclaración pendiente; segunda insuficiente → sin información; respuesta suficiente después de aclaración → respondida y limpiarpendiente.
- Anónima: no hay estado pendiente entre consultas. Cada pregunta se evalúa por sí misma, sin historial ni UUID de conversación, conforme C4-DC-02. DI-21 controla turnos encadenados solo con autorización; en anónimo la aclaración pide una nueva pregunta completa.
- Principal falla → respaldo; ambos fallan → error seguro y estado. Reranker falla → RRF y thresholdApplied=false; siguiente éxito → normal.
- Escritura falla → respuesta sinresponseId +1 aviso/episodio; primer éxito → normal. Sin reintentos que persistan contenido de respuestas ya entregadas sin identificador.
- Contacto mutation válida+revision actual → nuevo snapshot+auditoría; inválida/stale/perfil indebido → sin cambios.
- Interacción cumple 12 meses → purgada en≤24 h, irreversible por interfaces del runtime.
