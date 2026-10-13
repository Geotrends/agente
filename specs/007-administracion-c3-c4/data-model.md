# Data Model — SPEC007

Diseño incremental sobre PostgreSQL16 (`kb`, `admin`, `chat`) y Qdrant existentes. Cubre RF-C3-AD-01..48, RF-C4-AD-01..05 y RNF-C3-AD-01..09; conserva privacidad/retención SPEC005 y evidencia SPEC006. No crea una base ni registro de textos anónimos.

## Tipos comunes

- `id`: UUID emitido por servidor, salvo `row_id` bigint interno ya existente. No nuevos identificadores ciudadanos; ni row_id ni IDs de conversación/respuesta en tableros o exportaciones.
- `revision`: bigint positivo, representado como string decimal en JSON. `expectedRevision` obligatorio al modificar una entidad existente; revisión obsoleta produce409 sin cambios.
- Tiempos técnicos: timestamptz UTC, ISO8601 con zona en JSON. Fechas civiles: YYYY-MM-DD válida, zona America/Bogota (denominada America/Bogotá en la fuente).
- Texto obligatorio: no vacío ni solo espacios. Recortar metadata, nunca contraseñas. Correo de cuenta trim/lowercase y único; nombre no es único.
- Dirección: catálogo institucional existente. Ecosistemas/Bienestar Animal/Gestión Ambiental y Secretaría (general) únicamente en contenido general autorizado por el catálogo; no texto arbitrario.
- URL pública: HTTPS con host válido, sin credenciales/caracteres de control. No descarga remota desde carga manual. Scraper añade política de hosts y corpus.
- Precios: string decimal base10 positivo, máximo cuatro decimales, sin exponentes y con cabida en numeric(20,10) existente. Costo numeric(24,12); NULL no es cero.
- Entrada JSON: rechazar claves desconocidas/duplicadas, enums inválidos y coerciones indebidas. SQL parametrizado; ordenación por lista permitida. Texto administrativo no ejecuta HTML, comandos o SQL.

## Cuenta, sesión y LoginIpGuard — US1

Reutilizar `admin.account`: id, display_name no vacío, email normalizado UNIQUE, profile exacto `administrador técnico|Gestor documental`, active, password_phc, must_change_password, failed_attempts, locked_until, created_at/updated_at. Añadir revision≥1. PHC argon2id con sal única por cuenta; nunca DTO/auditoría/notificación. Contraseña≥12 puntos de código, sin composición y sin trim. Temporal/nueva cuenta obliga cambio a una contraseña distinta antes de cualquier función distinta de password/session/logout.

Sesión existente: hashes de token/CSRF, account_id, created_at, last_request_at y revoked_at. No token claro en DB. Cookie actual HttpOnly/Secure/SameSite; treinta minutos sin solicitudes válidas vence. Desactivación, cambio de perfil, temporal y recuperación revocan todas las sesiones; reactivar no las revive. Cambiar contraseña propia conserva exclusivamente sesión actual según comportamiento vigente. Cuenta desactivada y su historia no se borran.

Nueva `admin.login_ip_guard`: ip_key hexadecimal64 de HMAC con secreto estable de instalación reservado, failures timestamptz[] dentro de ventana quince minutos, blocked_until nullable, updated_at. Sin IP clara, correo ni texto ciudadano; no vínculo con anonymous_usage. Veinte fallos→bloqueo quince minutos, éxito reinicia conteo pertinente; limpieza de filas sin ventana/bloqueo activo. Locks en orden IP→cuenta hacen atómicos contadores, sin pérdida ante concurrencia/reinicio. Cuenta: cinco fallos consecutivos→quince minutos y notificación de sistema. Respuestas401 uniformes; IP429/Retry-After antes de verificar credenciales.

Invariante DB y aplicación: siempre≥1 administrador activo; conservar trigger existente y comprobar desactivación/cambio de perfil concurrentes. Bootstrap solo instalación inicial vacía. Recuperación con procedimiento de exactamente dos parámetros bajo rol reservado, marca cambio/revoca/audita sin activar una desactivada. RF-C3-AD-05..13; RNF-C3-AD-01..06.

## Metadata documental, elemento y versión — US2

Ampliar `kb.kb_elemento` y `kb.kb_version`; no reemplazar la matriz ni conversiones SPEC001. Metadata candidata pertenece a su versión y no cambia metadata vigente hasta publicación. Elemento conserva identidad, referencia publicada y candidata pendiente separadas.

Campos de versión: id, element_id, origin `manual|scraper`, author_account_id, uploaded_at, original_format, original_file_ref interna privada, content_hash hexadecimal64, converted_content_ref privada, metadata, accessed_at real, ocr_applied/ocr_confidence, processing_status y publication_state. Autor obligatorio en nueva manual; nullable solo en históricos/scraper sin autor humano identificable. No inventar autor de migración.

Metadata: type,title,direction,publicUrl,associatedProcedure obligatorios. Procedimiento código o `ninguno`; interno procedureCodes=[] para ninguno. code,version,updatedDate,validUntil opcionales/null en manual; presentar N/A sin guardar fechas falsas. CHECK de GMAS/procedimientos se amplía **solo** para origen manual, sin relajar extracción. PDF/DOCX/XLSX mínimos; las salvaguardas de OCR, tablas, formatos en blanco y corpus siguen condicionando publicación. Fecha de acceso real sirve para cita sin fecha de actualización.

Estados visibles: `Pendiente de aprobación|Publicado|Vencido|Derogado`, proyectados sobre enums existentes; estado técnico de procesamiento separado. Rechazado/retirado desaparece de matriz y solo conserva registro seguro. Una versión publicada por identidad puede coexistir con candidata. Mismo código o URL enlaza identidad; si cada uno señala un documento distinto,409/revisión sin fusión destructiva.

Metadata editable: título,tipo,dirección,enlace,procedimiento,versión,actualización,validez; código no se edita por AD39. Edición no cambia contenido/hash. Fecha futura de vencido válido restaura publicado, nunca pendiente/derogado. Validez date|null: disponible mientras fecha Bogotá≤validUntil; excluido desde comienzo del día siguiente incluso si el scheduler se retrasa. Evento de vencimiento único por documento/versión/fecha.

## ActiveGeneration, DocumentOperation y Cleanup — US2/US5

Nueva `kb.active_generation`: singleton con revision≥1, generation_id, collection_name interna, manifest_hash, committed_at. Manifest relaciona elementos con versión/hash, metadata_revision y calibration_ref. Reader limitado SELECT; nombre de colección no proviene del ciudadano/panel. Migrar generación inicial contrastando publicado real y colección actual.

Nueva `kb.document_operation`: id, kind `publish|replace|reject|withdraw|reindex|metadata`, actor_account_id, target_element/version nullable solo en reindex, expected_revision, phase, started_at, finished_at, attempts, previous_generation, candidate_collection, manifest_ref, error_code seguro, cleanup_pending, idempotency_key, payload_hash, created_at.

Fases exactas: `queued|preparing|prepared|committed|reconciling|cleaning|complete|failed`. Estado público En curso hasta complete/failed, luego Terminada/Fallida. finished_at null hasta terminación; attempts0..2 para indexación, exactamente un reintento tras fallo del primero. Índice único parcial para escritor KB activo; otra reindexación mientras activa409. Reinicio retoma diario y verifica realidad, no consume intentos infinitos por el ciclo.

Preparación construye colección completa separada. Primer fallo limpia/verifica parcial antes de reintentar; segundo mantiene pendiente/publicado anterior y notifica. SQL hace commit único de generación/metadata/versiones; recuperación apunta a colección concreta y alias kb_chunks se reconcilia como espejo. Antes de commit puede fallar sin sustituir anterior; después de commit nunca borra activa ni revierte a contenido ya eliminado. Fallo de limpieza deja En curso/reconciliación con aviso, no Terminada.

Recibo de limpieza: referencias privadas, identidad/hash, objeto eliminado, tiempo y comprobaciones de ausencia/count0; sin contenido ni rutas públicas. Inventariar SQL, todas las colecciones/archivos/caches/exportaciones administradas que puedan conservar versión anterior. Terminada solo tras borrado confirmado. Journal conserva metadata/hash, nunca copia de texto o rollback de contenido eliminado.

Rechazo/retirada excluyen vigente antes de consultas nuevas y terminan después de eliminación física. Recuperación valida estado/versión/validez y superpone metadata por request; sin proyección válida, indisponibilidad y nunca ausencia factual. Lock compartido durante lectura vectorial, exclusivo para eliminación física, sin registro/ID de consulta anónima. Revalidación antes de invocar/entregar evita datos obsoletos; una búsqueda adicional dentro presupuesto si cambia generación, después error seguro. Mantener plazos y probar cero errores durante actualización normal.

## RejectionWithdrawalRecord — US2

Nueva `kb.document_removal`: id, type `reject|withdraw`, document_identity_metadata segura, source_url, origin, content_hash, reason no vacío, actor_account_id, occurred_at. Fecha/hora se muestran desde timestamp. Solo los datos del registro exigido, sin archivo/texto/vectores. Índice por URLorigen+hash+tipo; scraper omite igualdad y admite nueva huella. Diseñar FKs para no retener contenido solo porque auditoría/citas lo referencian. Identidad documental histórica sin contenido puede permanecer fuera de matriz para atribución de citas.

## DocumentIdentity — referencias históricas sin contenido

Proyección o tabla `kb.document_identity` de metadata segura, fuera de la matriz de documentos cargados: id estable, códigos/enlaces equivalentes validados, título/dirección y fecha de metadata. Permite atribuir citas históricas tras retiro sin conservar archivo/texto/vectores. No es otra base ni contenido recuperable. Mapear IDs de citas existentes contra identidades reales durante migración; los no resueltos se señalan como metadata no disponible, nunca se inventa dirección. Toda cita nueva usa identidad estable ya validada. Ranking usa metadata vigente cuando existe, última metadata institucional segura cuando retirado; no puede crear documentos/citas de consultas anónimas. RF-C3-AD-20/22/24/44.

## Enlace y propuesta — US3

Nueva `kb.scraper_link`: id,url UNIQUE HTTPS,direction,justification no vacía,active,revision,changed_by/at,list_version. Snapshot interno por corrida `{version,hash,links,createdAt,configHash}` publicado atómicamente por worker para Pythonoffline; nunca código ejecutable ni credenciales de escritor.

Nueva `kb.link_proposal`: id,owner_account_id,type `add|remove`,url,direction,justification,state,created_at,decided_by/at,rejection_reason,revision. Estados exactos `Pendiente de validación|Aprobada|Rechazada|Retirada`; decisión solo técnico sobre pendiente, rechazo exige motivo, retirada solo pendiente propia. Campos de decisión null antes de ella; decisión/enlace/list_version/auditoría atómicos. Estado final no se cambia por segunda decisión.

Lista de hosts en configuración desplegada, ninguna tabla editable desde panel. Quitar origen mantiene publicado y marca automatic_update_disabled solo scraper; aviso si hay publicados afectados con enlace/fecha/hora/usuario/documentos. Siguiente corrida no verifica semilla ni documentos del enlace quitado. Marca desaparece al reagregar/retirar/reemplazar, manual siempre false. Alcance cerrado se valida aparte de host permitido.

## Notification, Counters, Audit y ComponentStatus — US5

Ampliar admin.notification y kb.kb_notificacion: scope `sistema|carga`, owner_account_id obligatorio en carga/null en sistema, document_identity opcional, type allowlist existente ampliada a eventos aprobados, object_type/id seguros,description saneada,first_at,last_at,repetitions≥1,state `No revisada|Revisada`,reviewed_by/at null hasta revisión, revision≥1.

Unión SQL autorizada con IDs namespace KB/admin. Única No revisada por tipo/objeto/scope/owner; repetición suma y cambia última ocurrencia, contador cuenta filas. Revisada permanece y evento posterior crea otra. Técnico todas; Gestor solo rechazo/OCR/indexación de sus propias cargas. Nunca correo/webhook/contraseña/texto/PHC/SQL/rutas.

Counters:{notifications≥0,pending?≥0,openImprovements?≥0}; técnico los tres, Gestor solo avisos propios. Pending UNION documentos/propuestas pendientes, ordenfecha ascendente/id, days≥0 civil Bogotá. Contadores reflejan commit efectivo, no solo202 encolado.

Auditorías KB/admin existentes append-only en proyección común: actor_account_id **o** actor_db_role real,action,object_type/id,at,result. Preserve actores históricos identificables, sin inventar usuarios ni copiar payloads/documentos/secretos. UPDATE/DELETE revocados; aceptadas auditadas misma tx, rechazos tras rollback en otra tx segura. Procedimiento invocado por wrapper restringido usa actor operativo real, no propietario definer; no parámetros sensibles en loggingDB.

ComponentStatus persistido: dos modelos/reranker/registro/scraper, status `normal|degradado|no comprobado`,last_success,last_failure,observed_at,thresholdApplied si aplica y última corrida con resultado seguro. Hydrate al reiniciar; falta de evidencia no es normal. Eventos del criterio visibles<60s. DB que impide validar sesión no habilita vista pública ni cache de permisos.

## Contacts — US4

Reusar admin.contact_meta/reception/general/immediate, CAS de revisión global. Recepción tres campos obligatorios sin removal; general tres obligatorios; inmediatos≥1. Phone/WhatsApp usan `[0-9 +()-]` y al menos un dígito; correo válido, URLHTTPS. Name/description no vacíos; descripción≤120 puntos de código. Posición entero≥1 única/contigua tras reorden. Valor/revisión/auditoría en tx, lector ciudadano snapshot vigente sin TTL obsoleto ni LLM. Conservar validaciones y salida existente.

## Tariff y Statistics — US7

Reusar chat.tariff numeric(20,10) y versiones históricas; no reescribir precios viejos. ModelID exactos20b/120b autorizados y región configurada, currencyUSD. Nueva edición input/outputPerMillion string decimal>0 hasta4 decimales; source_url institucional vigente se conserva. valid_from del servidor al guardar, cierre valid_to anterior y periodo[desde,hasta), CAS con versión vigente. Lock por modelo/región y exclusión GIST existente sin solapamientos; misma marca que cree intervalo vacío se rechaza409.

Registro sigue calculando con received_at y decimal.js escala12; consulta recibida antes del guardado usa anterior aun terminando después. Costo histórico inmutable; NULL indica no disponible, no0.

DTO agregados sin textos ni identificadores: uso total/diario conv+anon, categorías/tipos solo conv y anonimato aparte; citas autorizadas deduplicadas por documento/respuesta→top10/citasdesc/nombreasc; dirección/nombre desde catálogo histórico seguro sin contenido. Valoraciones Útil/No útil y cinco motivos de feedback.ts, porcentajes0 si total0. Consumo ambas tablas por modelo, unknownCostCount/totalparcial explícitos, none separado. Rango default treinta días civiles incluyendo hoy y29 anteriores Bogotá→UTC [fromInclusive,toExclusive).

## InteractionView, ImprovementCase y Transition — US6

InteractionView solo autorizadas, nueve campos fecha-hora/categoría/pregunta/respuesta/tipo/citas/modelo/valoración, enmascaramiento vigente. No conversation_id/response_id/row_id en filas exportadas; row_id solo cursor interno. JOIN valoración1a1. Texto null si purged_at no null **o** edad≥12 meses calendario, disponibilidad `disponible|depurada`. Export no lee anonymous_usage ni reconstruye texto.

Nueva `admin.improvement_case`: idUUID,interaction_row_id BIGINT UNIQUE FK chat.interaction,origins[] conjunto `sin información|No útil`,created_at primer origen,updated_at,failure_type `Datos|Recuperación|Modelo` nullable antes de En ajuste,status exacto,revision≥1,finding_ref006 nullable. Categoría/pregunta/motivo desde interacción/valoración actual, **ninguna copia persistida**. Un caso por interacción elegible y causas dobles fusionadas; no hook sobre anonymous_usage. Backfill idempotente conserva fechas reales y no reconstruye depurado.

Estados exactos `Registrada → En análisis → En ajuste → Ajustada → Validada → Cerrada`, sin salto/retroceso. REAL exigido antes de En ajuste, nota no vacía al cerrar, evidencia posterior de ajuste/corrida aplicable para Validada/Cerrada. No transiciona hallazgo/recepción006.

Nueva `admin.improvement_transition`: id,case_id,from_state,to_state,actor_account_id,at,note nullable salvo cierre,failure_type,evidence_refs seguras,revision_from/to. Append-only. Notas saneadas sin reproducir texto ciudadano/secretos; referencia006 privada comprobada por hash/run/release, no path arbitrario del usuario. Invalid state/revision→409 sin cambios.

## Índices, roles y relaciones

Índices por orden/filtro: avisos scope/owner/state/last_at; pendientes fecha/id; propuestas owner/state/date; removals URL/hash; interacciones received_at,row_id/category/result; valoración UNIQUE row_id; mejoras status/failure/date y UNIQUE FK; auditoría actor/action/time; tarifas modelo/región/range; operación activa UNIQUE parcial.

kb_writer único escritor documental; app_reader SELECT manifest/metadata vigente; chat_app registra consulta/valoración mediante funciones existentes, no CRUDpanel. admin_app opera API autorizada y funciones mínimas de comandos KB, sin DDL ni modificación general de matriz. chat_owner NOLOGIN mantiene admin/chat, roles de migración fuera del runtime. contractor_recovery reservado solo CALL/helper de auditoría, sin privilegios de runtime. Worker usa actor verificado del comando creado por backend, no rol/credencial suministrado en payload.

Cuenta→cargas/propuestas/avisos/acciones; elemento→versiones→operación→generación; rechazo/retiro→registro sin contenido; enlace→snapshot→corrida; interacción autorizada→valoración/caso único→transiciones; tarifas→consumo histórico; cambios/evidencias→release006. Las referencias no obligan a conservar contenido que el PDF exige eliminar.

Avisos históricos sin autor verificable se conservan solo para técnico; no se asignan a un Gestor por heurística. La migración no inventa propietarios para hacer pasar AD31. Revisión nueva de avisos tiene CAS, y las filas previas reciben revisión inicial manteniendo historial.
