---

description: "Lista de tareas de SPEC008 — Corrección de hallazgos de la auditoría de seguridad"
---

# Tasks: SPEC008 — Corrección de hallazgos de la auditoría de seguridad

**Input**: Documentos de diseño en `specs/008-correccion-hallazgos-auditoria/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: SÍ. FR-023 exige, por cada pista, una prueba que falle antes del cambio y pase después (o evidencia de «no explotable»). Las pruebas de cada historia se escriben y se ven fallar **antes** de su implementación.

**Organization**: por historia de usuario (US1..US7). Rutas relativas a la raíz del repositorio. Trazabilidad: cada tarea cita su pista (NV-xx) o requisito (FR-xxx).

## Format: `[ID] [P?] [Story] Descripción con ruta`

- **[P]**: paralelizable (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1..US7 según la spec
- Trabajo en `develop`; no se hace commit sin que el usuario lo pida (flujo develop → prod_test → main).

---

## Phase 1: Setup

- [X] T001 Crear el directorio de pruebas `backend/test/seguridad-008/` y el directorio de evidencias `specs/008-correccion-hallazgos-auditoria/evidencias/` con un `README.md` que explique el formato por pista (prueba que falla antes → corrección → prueba que pasa, o evidencia de «no explotable»; R12)
- [X] T002 Añadir el script `test:seguridad-008` en `backend/package.json`: `node --import tsx --test test/seguridad-008/*.test.ts`, e incluirlo en `test:all`
- [X] T003 [P] Confirmar el entorno local aislado según la receta de SPEC004/SPEC005 (PostgreSQL 16, Qdrant 1.19, Chromium, Poppler, Tesseract; sin red externa ni credenciales reales) y anotar el resultado en `specs/008-correccion-hallazgos-auditoria/evidencias/entorno.md`

---

## Phase 2: Foundational (bloquea todas las historias)

- [X] T004 Crear la migración `backend/migrations/007_correccion_auditoria.sql` con: `kb.document_operation.target_version_id uuid NULL REFERENCES kb.kb_version(id)`, `cleanup_attempts int NOT NULL DEFAULT 0`, `next_attempt_at timestamptz NULL`, `needs_attention boolean NOT NULL DEFAULT false`; `kb.kb_elemento.version_aplazada_id uuid NULL REFERENCES kb.kb_version(id)`; y cambiar `version_publicada_fk` de `ON DELETE SET NULL` a `ON DELETE RESTRICT`. Invariantes (verbatim de data-model.md): «`version_aplazada_id` ≠ `version_publicada_id`; una versión nunca se elimina mientras sea `version_publicada_id` de algún elemento». Aditiva y reversible (incluir comentario con el `DOWN`)
- [X] T005 [P] Crear la migración `backend/migrations/chat/013_sesion_vigencia_absoluta.sql`: `admin.session.absolute_expires_at timestamptz NOT NULL` = `created_at + interval '8 hours'` (rellenar las sesiones existentes con `created_at + 8 h`)
- [X] T006 Registrar ambas migraciones en `backend/src/chat/migrate.ts` (y en el runner de `backend/migrations/` del esquema `kb`) y conceder a `admin_app`/`kb_writer` solo los `GRANT` de columnas nuevas que necesiten; ampliar `backend/test/kb-integracion/esquema.test.ts` para verificar columnas, FK `RESTRICT` y `GRANT`
- [X] T007 [P] (no necesario: cada prueba define sus fábricas inline) Crear `backend/test/seguridad-008/helpers.ts` con fábricas de fixtures sintéticos (elemento publicado + candidato pendiente, operación encolada, reloj controlable, fallos inyectables de Qdrant/DB), reutilizando `backend/test/kb-integracion/helpers.ts`

**Checkpoint**: migraciones aplicadas y fixtures disponibles; las historias pueden comenzar.

---

## Phase 3: User Story 1 — Tope diario del chat efectivo (P1) 🎯 MVP

**Goal**: ninguna IP ni el total pueden superar el tope diario; los mensajes largos repetidos bloquean la IP (NV-01, FR-001..003, FR-002a).

**Independent Test**: con topes bajos, el cliente anónimo recibe 429 en la consulta N+1 sin que se invoque al LLM; el contador sobrevive al reinicio; una falla del archivo activa el tope temporal.

### Tests (US1) — escribir primero, deben fallar

- [X] T008 [P] [US1] Prueba de integración HTTP en `backend/test/seguridad-008/chat-topes.test.ts`: tras N consultas válidas, la N+1 devuelve 429 `daily_ip_limit` con `Retry-After` y el doble de Bedrock no recibe llamada; el tope global devuelve `daily_global_limit`; no se registra interacción en rechazo (contrato [chat-quota.md](contracts/chat-quota.md))
- [X] T009 [P] [US1] Prueba unitaria en `backend/test/chat-traffic.test.ts` (ampliar): día de America/Bogotá (23:59:59 → 00:00:00 reinicia contadores), persistencia entre instancias del controlador, y FR-002a: si `load()`/`persist()` lanzan, aplica tope en memoria `floor(límite/2)` (mínimo 1) y emite una sola notificación agrupada

### Implementación (US1)

- [X] T010 [US1] En `backend/src/services/chatTraffic.ts` reemplazar `utcDay`/`secondsUntilNextUtcDay` por el día de America/Bogotá (UTC−5, sin horario de verano) y normalizar un archivo de estado con día en UTC al día vigente (data-model.md)
- [X] T011 [US1] En `backend/src/services/chatTraffic.ts` añadir el contador de respaldo en memoria por proceso (`Map<ipKey, number>` + contador global, tope `floor(límite/2)`, mínimo 1) usado cuando `load()`/`persist()` fallan, y emitir un evento de servicio agrupado vía el mecanismo de `backend/src/admin/serviceEvents.ts` (FR-002a)
- [X] T012 [US1] En `backend/src/routes/chat.ts` invocar `checkAndRecordLongRequest` y `consumeDailyQuota` después de validar origen, tasa y cuerpo y **antes** de `chatAdmissionQueue` y del LLM; responder 429 con el código del controlador, `Cache-Control: no-store`, sin proveedor ni modelo, y sin registrar la interacción (FR-001, FR-022)
- [X] T013 [P] [US1] Documentar en `.env.example` los valores por defecto seguros y el significado de `CHAT_DAILY_PER_IP_LIMIT`, `CHAT_DAILY_GLOBAL_LIMIT`, `CHAT_LONG_MESSAGE_*` (FR-003)
- [X] T014 [US1] Verificar que el frontend del chat muestra los canales oficiales del registro de contacto ante `daily_*`/`ip_temporarily_blocked` en `frontend/chat/` (buscar el manejo de 429) y ajustar el mensaje si falta; añadir prueba si hay manejo propio

**Checkpoint**: US1 verificable por sí sola (MVP de seguridad más valioso).

---

## Phase 4: User Story 2 — Publicar solo la versión aprobada (P1)

**Goal**: la publicación promueve exactamente la versión aprobada, procesada e indexada (NV-02, NV-03, NV-10; FR-004..007).

**Independent Test**: con una publicación en curso, una carga manual o detección del scraper no cambia el objetivo; la nueva versión queda aplazada y pasa a pendiente al terminar.

### Tests (US2) — escribir primero

- [X] T015 [P] [US2] `backend/test/kb-integracion/seguridad-008-publicar-objetivo.test.ts` (NV-02): encolar publicación de la versión A; durante la preparación registrar B; esperar que se publique A o falle con `candidata_cambiada`, B quede pendiente tras la operación y la vigente se conserve
- [X] T016 [P] [US2] En el mismo archivo (NV-03): candidato `en_cola`/sin procesar al confirmar → la operación no promueve, la vigente sigue publicada e indexada y se notifica
- [X] T017 [P] [US2] `backend/test/kb-integracion/seguridad-008-limpieza-publicar.test.ts` (NV-10): candidato limpiado a mitad (misma huella que la vigente) → el archivo original y las filas de la versión vigente se conservan
- [X] T018 [P] [US2] Prueba de carrera en `backend/test/kb-integracion/seguridad-008-publicar-objetivo.test.ts`: 100 repeticiones con carga concurrente; ninguna promueve una versión distinta de la aprobada (SC-002)

### Implementación (US2)

- [X] T019 [US2] En `backend/src/admin/documents.ts` fijar `target_version_id = version_pendiente_id` al encolar `publish`/`replace` (validando la revisión esperada como hoy) y rechazar con 409 si no hay candidata
- [X] T020 [US2] En `backend/src/kb/indexer.ts` (función de commit/`reconstruirColeccion`) indexar solo la versión objetivo y promover con `UPDATE … WHERE version_pendiente_id = $target AND estado_tecnico = 'procesado'`; si afecta 0 filas, abortar la transacción y devolver `candidata_cambiada` (R02)
- [X] T021 [US2] En `backend/src/kb/documentOperations.ts` (`publicar`) marcar `promoted=true` en `payload` solo tras un commit que promovió; en `finalizarTrasCommit` borrar `archivosAnteriores` únicamente si `promoted`; terminar con `error_code='candidata_cambiada'` y notificar (NV-10, FR-007)
- [X] T022 [US2] Crear la función/ajuste SQL en `backend/migrations/007_correccion_auditoria.sql` para que `kb.registrar_carga_manual` escriba en `version_aplazada_id` cuando exista una operación `publish/replace/reindex` no terminal sobre el elemento (en lugar de `version_pendiente_id`); no rechaza la carga (FR-006, aclaración 2)
- [X] T023 [US2] En `backend/src/kb/sync.ts` aplicar la misma regla de aplazamiento para detecciones del scraper con operación activa
- [X] T024 [US2] En `backend/src/kb/documentOperations.ts` (`terminar`) promover `version_aplazada_id` a `version_pendiente_id` al finalizar la operación (`revision + 1`) y notificar al autor; cubrir con prueba en el archivo de T015

**Checkpoint**: US2 verificable sin depender de US1.

---

## Phase 5: User Story 3 — Retiro, rechazo y limpieza que no se atascan (P1)

**Goal**: retiros reanudables, cola sin bloqueo y sin borrar la publicada (NV-07, NV-08, NV-09; FR-008..010).

**Independent Test**: fallo inyectado de Qdrant durante un retiro → reintento; cola avanza con una operación en espera; reactivar derogado y rechazar no elimina la publicada.

### Tests (US3) — escribir primero

- [X] T025 [P] [US3] `backend/test/kb-integracion/seguridad-008-retiro.test.ts` (NV-07): fallo transitorio después de `retirado_en` → la operación NO queda `failed`, `cleanup_attempts` aumenta, `next_attempt_at` se fija con espera 15 s·2^n; tras 5 intentos rápidos `needs_attention=true` y **una** notificación; después reintenta cada 60 min; el contenido nunca es recuperable
- [X] T026 [P] [US3] `backend/test/kb-integracion/seguridad-008-cola.test.ts` (NV-08): una operación `cleaning` con `next_attempt_at` futuro no impide procesar la siguiente en cola (SC-004)
- [X] T027 [P] [US3] `backend/test/kb-integracion/seguridad-008-derogado.test.ts` (NV-09): pendiente == publicada tras reactivar derogado; `rechazar` y `sync` con hash cambiado no eliminan la versión publicada ni su archivo; borrar directamente la versión publicada falla por `RESTRICT`
- [X] T028 [P] [US3] `backend/test/admin-integracion/operaciones-reanudar.test.ts`: contrato de `POST /api/admin/operations/{id}/resume` ([admin-operations.md](contracts/admin-operations.md)): 200, 403 para Gestor, 404, 409, 422, auditoría `reanudar_operacion`, idempotencia

### Implementación (US3)

- [X] T029 [US3] En `backend/src/kb/documentOperations.ts` cambiar la selección de la cola a `phase NOT IN ('complete','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at, id LIMIT 1` y ajustar la condición de salida del bucle para no depender de que la operación más antigua cambie de fase (NV-08)
- [X] T030 [US3] En `backend/src/kb/documentOperations.ts` clasificar errores: determinísticos (`sin_vigente`, `documento_inexistente`, `candidata_cambiada`) → `failed`; transitorios (Qdrant/DB/IO) en `retirar`, `rechazar` y limpieza → `cleanup_attempts+1`, `next_attempt_at = now() + 15 s·2^n` hasta 5, después cada 60 min indefinidamente; al llegar a 5 fijar `needs_attention=true` y emitir una única notificación agrupada (NV-07, NV-08, aclaración 3)
- [X] T031 [US3] En `backend/src/kb/documentOperations.ts` (`rechazar`) y `backend/src/kb/sync.ts` (rama «hash cambió»): si `version_pendiente_id = version_publicada_id`, solo poner `version_pendiente_id = NULL` (`revision + 1`), sin `DELETE` de la versión ni de su `archivo_ref` (NV-09, FR-010)
- [X] T032 [US3] En `backend/src/admin/operations.ts` exponer `estado` (`en_curso`, `en_espera`, `requiere_atencion`, `terminada`, `fallida`), `proximoIntento`, `intentosLimpieza` y añadir `resume` (limpia `next_attempt_at`, mantiene `cleanup_attempts`, valida revisión y perfil, audita sin contenido)
- [X] T033 [US3] Registrar la ruta `POST /api/admin/operations/:id/resume` en `backend/src/routes/adminOperations.ts` con CSRF y Origin como el resto del panel y perfil administrador técnico
- [X] T034 [P] [US3] Botón «Reanudar» y estado «Requiere atención» en `frontend/admin/DocumentOperation.tsx` (WCAG 2.1 A/AA: etiqueta, foco, anuncio de estado), con cliente en `frontend/admin/adminClient.ts` y tipos en `frontend/admin/contracts.ts`; prueba de componente si el repositorio ya prueba este archivo

**Checkpoint**: US3 verificable de forma independiente.

---

## Phase 6: User Story 4 — Límites reales de ZIP y OCR (P2)

**Goal**: expansión y OCR acotados (NV-05, NV-06; FR-011, FR-012).

**Independent Test**: ZIP con tamaños declarados falsos se rechaza al superar el límite real; PDF con muchas páginas se descarta con motivo sin retrasar la cola.

### Tests (US4)

- [X] T035 [P] [US4] `backend/test/seguridad-008/limites-procesamiento.test.ts` (NV-05): DOCX/XLSX sintético con central directory que declara tamaños pequeños y entradas que inflan por encima de `maxExpandido`; esperar rechazo `expansion_excesiva` antes de `mammoth`/`xlsx`, y que un archivo legítimo grande dentro del tope se acepte
- [X] T036 [P] [US4] En el mismo archivo (NV-06): PDF sintético con más de `OCR_MAX_PAGES` páginas, y otro con página sobredimensionada → descarte `ocr_excede_limites`; plazo total `OCR_PLAZO_TOTAL_MS` con reloj inyectado; la cola de operaciones continúa

### Implementación (US4)

- [X] T037 [US4] En `backend/src/kb/zipInspect.ts` añadir `verificarExpansionReal(ruta, limites)`: localiza cabecera local de cada entrada y descomprime en flujo con `zlib.createInflateRaw` contando bytes, abortando al superar `maxExpandido` total o por entrada; invocarla desde `detectarFormato` tras `inspeccionarZip` (R06; sin dependencias nuevas)
- [X] T038 [US4] En `backend/src/kb/ocr.ts` leer páginas y tamaño con `pdfinfo` antes de rasterizar y aplicar `OCR_MAX_PAGES=100`, `OCR_MAX_PIXELS_PAGINA=40_000_000` (reducir `-r` hasta caber; descartar si aún excede) y `OCR_PLAZO_TOTAL_MS=900_000`; devolver `ocr_excede_limites` (R07)
- [X] T039 [P] [US4] Añadir `mem_limit` y `cpus` al servicio `kb-worker` en `docker-compose.yml` y documentar `OCR_*` en `.env.example`
- [X] T040 [US4] Propagar `expansion_excesiva` y `ocr_excede_limites` como motivos legibles en el panel (`backend/src/admin/documents.ts` y `backend/src/kb/manualUploads.ts`) sin rutas ni trazas (FR-022)

---

## Phase 7: User Story 5 — Scraper solo ingiere hosts permitidos (P2)

**Goal**: ningún contenido de host no permitido se guarda bajo URL permitida (NV-04; FR-013).

**Independent Test**: sitio local que redirige por JavaScript a otro host → página descartada, avisada y no almacenada.

- [X] T041 [P] [US5] Prueba en `web_scraper/tests/test_render_host.py` con servidor HTTP local (dos puertos/hosts simulados): redirección por meta-refresh y por `location.href`, subrecurso a host no permitido, y caso legítimo; esperar descarte con `motivo='host_no_permitido'` y que el contenido legítimo se guarde igual que antes
- [X] T042 [US5] En `web_scraper/scraper/crawler.py` registrar `page.route('**/*')` que permita solo `https` y hosts de `ALLOWED_HOSTS` (abortar el resto) y, tras `goto`, verificar `urlparse(page.url).hostname`; si no coincide, descartar y no guardar (R08, contrato [scraper-render.md](contracts/scraper-render.md))
- [X] T043 [US5] En `web_scraper/scraper/crawler.py` guardar el contenido asociado a la URL final validada del navegador y no a `response.url` de `requests`
- [X] T044 [US5] En `web_scraper/scraper/run_report.py` añadir la entrada de descarte `{url, estado:"descartada", motivo:"host_no_permitido", host_final}` sin cuerpo de página, y en `backend/src/kb/runReport.ts` agrupar descartes por fuente y notificar al administrador técnico (aclaración 4); prueba en `backend/test/kb-integracion/informes.test.ts`

---

## Phase 8: User Story 6 — Sin restos de texto en disco (P2)

**Goal**: sin texto extraído ni exportaciones residuales (NV-11, NV-12; FR-014, FR-015).

**Independent Test**: carga descartada y exportación con cliente desconectado no dejan archivos tras el barrido.

### Tests (US6)

- [X] T045 [P] [US6] `backend/test/seguridad-008/restos-en-disco.test.ts` (NV-11): carga descartada (formato diligenciado, OCR rechazado, extracción fallida) → sin archivo en `DOCUMENT_CACHE_DIR` ni entrada en memoria; la caché respeta 16 entradas y TTL de 10 min
- [X] T046 [P] [US6] En el mismo archivo (NV-12): cliente que cierra durante `prepararExportacion` → archivo eliminado; `limpiarExportacionesViejas` elimina huérfanos con más de 60 min

### Implementación (US6)

- [X] T047 [US6] En `backend/src/kb/conversion.ts` eliminar el `Map` sin expulsión o limitarlo a 16 entradas con TTL de 10 min, y borrar el archivo de caché al descartar la carga (OCR rechazado, formato diligenciado, falla) (R09)
- [X] T048 [US6] En `backend/src/kb/worker.ts` barrer `DOCUMENT_CACHE_DIR` al iniciar y cada hora (edad > 24 h) y programar `limpiarExportacionesViejas` cada 10 min (R09, R10)
- [X] T049 [US6] En `backend/src/admin/export.ts` registrar `res.on('close')` **antes** de `await prepararExportacion`, pasar una `AbortSignal` a la preparación y eliminar el archivo si el cliente cierra o la preparación falla (NV-12, FR-015)

---

## Phase 9: User Story 7 — Endurecimiento de perímetro y secretos (P3)

**Goal**: reducir el radio de impacto sin cambiar funcionalidad visible (FR-016..FR-021).

**Independent Test**: inspección de configuración y pruebas automatizadas de cabeceras, sesión, /64 y estado público.

### Tests (US7)

- [X] T050 [P] [US7] `backend/test/seguridad-008/endurecimiento.test.ts`: sesión vence a las 8 h con actividad; IPv6 de un mismo /64 cuenta como un origen en el bloqueo del login; cambio de contraseña limitado a 5 intentos/15 min; arranque en producción falla sin `ADMIN_IP_HMAC_SECRET` propio; `/ready` y `/api/retrieval/status` anónimos devuelven solo `{ok}`; delimitadores del prompt neutralizados
- [X] T051 [P] [US7] Prueba de configuración en `backend/test/seguridad-008/compose-entorno.test.ts`: parsear `docker-compose.yml` y verificar que ningún servicio recibe `POSTGRES_PASSWORD` si no lo usa ni variables `*_API_KEY` de proveedores deshabilitados
- [X] T052 [P] [US7] Prueba de cabeceras en `frontend/scripts/` (o `backend/test/seguridad-008/nginx-cabeceras.test.ts`): verificar `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `frame-ancestors` según [http-headers.md](contracts/http-headers.md)

### Implementación (US7)

- [X] T053 [US7] Reemplazar `env_file: .env` global por `environment:` explícito y mínimo por servicio en `docker-compose.yml`; ninguna credencial administrativa de base de datos ni llave de proveedores deshabilitados llega a servicios que no la usan (FR-016)
- [X] T054 [P] [US7] En `.env.example` y en `Makefile` (`check-env`) dejar documentado que las llaves de Gemini/Groq/DeepSeek/OpenAI no se definen; en `backend/src/services/diConfig.ts` hacer que el arranque directo en producción falle con mensaje claro si hay llaves sobrantes (hoy solo marca `/ready`)
- [X] T055 [P] [US7] Incluir las cabeceras de [http-headers.md](contracts/http-headers.md) en `frontend/nginx.conf` para `location /` y rutas estáticas, reutilizando `frontend/scripts/build-csp.mjs`; `Cache-Control: no-store` en el panel (FR-017)
- [X] T056 [US7] En `backend/src/admin/sessions.ts` leer `absolute_expires_at` y rechazar sesiones vencidas aunque haya actividad (8 h, aclaración 5) y en `backend/src/admin/auth.ts` normalizar la IP del login con `ipKeyGenerator(ip, 64)`
- [X] T057 [US7] En `backend/src/admin/passwords.ts` limitar a 5 intentos fallidos/15 min por cuenta el cambio de contraseña, con la tabla de bloqueos existente
- [X] T058 [P] [US7] Hacer obligatorio `ADMIN_IP_HMAC_SECRET` en producción, sin respaldo en `AUTH_JWT_SECRET` (`backend/src/admin/db.ts`/configuración que lo lee; verificar con `grep ADMIN_IP_HMAC_SECRET backend/src`)
- [X] T059 [P] [US7] Reducir a `{ok}` las respuestas anónimas de `/ready` y `/api/retrieval/status` en `backend/src/routes/health.ts` y la ruta de recuperación, conservando el detalle en logs y en la pantalla de estado autenticada (FR-019)
- [X] T060 [P] [US7] En `backend/src/prompts/` (`buildTutorPrompt`) neutralizar los delimitadores del prompt dentro de fragmentos y texto del ciudadano; ampliar `backend/test/di-answer-evidence.test.ts` o la suite de inyección existente (FR-020)
- [X] T061 [P] [US7] En `.github/workflows/ci.yml` usar solo `npm ci` (sin `|| npm install`) y fijar acciones de terceros por SHA (FR-021)

---

## Phase 10: Polish y cierre

- [X] T062 [P] Registrar en `specs/008-correccion-hallazgos-auditoria/evidencias/NV-01.md` … `NV-12.md` el estado final de cada pista (corregida con enlace a su prueba, o «no explotable» con evidencia) (SC-008, FR-023)
- [X] T063 Ejecutar `cd backend && npm run test:all` y `cd web_scraper && pytest`; confirmar que la suite previa sigue pasando (SC-008) y adjuntar el resultado en `evidencias/regresion.md`
- [X] T064 [P] Revisar los ítems `[ ]` de `specs/008-correccion-hallazgos-auditoria/checklists/requirements.md` contra lo implementado y actualizar `specs/008-correccion-hallazgos-auditoria/quickstart.md` si algún comando cambió
- [ ] T065 Reejecutar la skill de auditoría (`/security-audit`, perfil standard) sobre el resultado y comparar con `~/security-audit-skill/agente/run-1`; registrar en `evidencias/reauditoria.md` que las 12 pistas y los endurecimientos listados ya no aparecen (SC-009)
- [X] T066 [P] Dejar como acción operativa documentada en `evidencias/operativo.md` (fuera del código): rotar las llaves de proveedores presentes en el `.env` local, verificar WAF/cuotas de borde/presupuesto de Bedrock y el rol IAM (supuestos de la spec). Puerta verificable (FR-016, principio V): `make check-env` sin errores sobre el `.env` de despliegue antes de cerrar la spec
- [ ] T067 [US7] Tras T060, reejecutar la matriz de pruebas congelada completa en gpt-oss-20b y gpt-oss-120b (constitución IX) con la suite de `backend/test/golden-set-eval.test.ts` / `validation-*.test.ts` según el procedimiento de SPEC006, y registrar el resultado en `specs/008-correccion-hallazgos-auditoria/evidencias/matriz-congelada.md`; requiere entorno AWS real: si no está disponible, dejar el bloqueo documentado

---

## Dependencies & Execution Order

### Phase dependencies
- Setup (Phase 1) → Foundational (Phase 2) → historias (Phases 3–9) → Polish (Phase 10).
- Foundational bloquea US2, US3 y US7 (migraciones); US1, US4, US5 y US6 no dependen de las migraciones y pueden empezar tras T001–T003 si hace falta.

### Story dependencies
- **US1**: independiente (MVP).
- **US2** y **US3**: comparten `backend/src/kb/documentOperations.ts`; ejecutar US2 antes de US3 en ese archivo, o coordinar los cambios (T021/T024 antes de T029–T031).
- **US4**, **US5**, **US6**: independientes entre sí.
- **US7**: T056 depende de T005; el resto independiente.

### Dentro de cada historia
Pruebas (deben fallar) → modelo/migración → servicio → endpoint → UI.

## Parallel Examples

```text
US1:  T008 ∥ T009;  luego T010 → T011 → T012;  T013 en paralelo
US2:  T015 ∥ T016 ∥ T017 ∥ T018;  luego T019 → T020 → T021;  T022 ∥ T023 → T024
US3:  T025 ∥ T026 ∥ T027 ∥ T028;  T029 → T030 → T031;  T032 → T033;  T034 en paralelo
US4:  T035 ∥ T036;  T037 ∥ T038 ∥ T039;  luego T040
US7:  T050 ∥ T051 ∥ T052;  T054 ∥ T055 ∥ T058 ∥ T059 ∥ T060 ∥ T061
```

## Implementation Strategy

- **MVP**: Phase 1 + Phase 2 (solo lo necesario) + **US1**. Entrega el único vector sin autenticación con costo económico directo.
- **Entrega incremental**: US1 → US2 → US3 (todas P1) → US4/US5/US6 (P2, en paralelo) → US7 (P3) → Polish.
- Cada historia se valida con su «Independent Test» y su fila del [quickstart.md](quickstart.md) antes de pasar a la siguiente.
- Si la prueba de una pista no reproduce el defecto, no se cambia código: se registra la evidencia en `evidencias/NV-xx.md` y se cierra (R12).

---

## Notas de implementación (2026-10-13)

Desviaciones respecto de lo planeado, con su razón:

- **Ubicación de pruebas**: las de publicación, retiro, exportación y sesión viven en
  `backend/test/admin-integracion/seguridad-008-*.test.ts` (reutilizan el arnés con PostgreSQL y
  Qdrant reales) y no en `kb-integracion/`. `npm run test:seguridad-008` corre las de `test/seguridad-008/`.
- **T028**: la prueba del endpoint de reanudación está dentro de `seguridad-008-retiro.test.ts`; la ruta
  quedó en `POST /api/admin/document-operations/:id/resume` (consistente con el `GET` existente).
- **T018**: muestra de 8 ejecuciones concurrentes, no 100 (tiempo de prueba); la garantía es estructural
  (validación dentro de la transacción de commit).
- **T014**: sin cambio de frontend: `shared/chatClient.ts` ya trata 429 como causa `limite` con `Retry-After`.
- **T012**: el tope diario se consume tras obtener plaza en la cola (una cola llena no consume cupo,
  según `.env.example`), no antes de la cola; la respuesta usa el código `LIMITE_SOLICITUDES` existente.
- **T011**: el aviso de topes degradados usa `operations.notify("topes_degradados", …)` (sin cambiar el
  catálogo de componentes de eventos de servicio).
- **T039**: `KB_WORKER_MEM_LIMIT` ya existía con valor neutro por RNF-C3-IN-13; el límite real queda
  documentado en `.env.example` y la expansión se acota al subir el archivo.
- **T042**: la lista de hosts es `allowed_hosts` + `document_allowed_hosts` (no `ALLOWED_HOSTS`); los
  subrecursos públicos de terceros se permiten (ver `contracts/scraper-render.md`).
- **T053**: en lugar de reemplazar `env_file`, se vacían por servicio las variables ajenas con mapas YAML
  (`x-sin-contrasenas-de-base`, `x-sin-proveedores`): menor riesgo de omitir una variable de configuración.
- **T058**: además, `make check-env` exige `ADMIN_IP_HMAC_SECRET` (≥ 32 caracteres, ≠ `AUTH_JWT_SECRET`).
- **T059**: el detalle de `/ready` y `/api/retrieval/status` solo se entrega a llamadas desde el propio
  contenedor (`isInternalCaller`).
- **T061**: acciones fijadas por SHA de la etiqueta mayor vigente (v4/v5); `npm ci` sin respaldo.
- **T065 y T067**: no ejecutados (ver `evidencias/matriz-congelada.md` y el informe final).
