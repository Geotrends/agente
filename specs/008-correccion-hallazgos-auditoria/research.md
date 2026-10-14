# Research — SPEC008

Cada decisión se tomó leyendo el código actual (commit `b5f6cca`); las rutas son relativas a `backend/` salvo que se indique. No quedan `NEEDS CLARIFICATION`.

## R01 — Topes diarios del chat (NV-01, FR-001..003, FR-002a)

- **Hecho**: `ChatTrafficController` (`src/services/chatTraffic.ts`) ya implementa tope por IP, global, bloqueo por mensajes largos y persistencia en archivo JSON; `routes/chat.ts` solo importa `chatAdmissionQueue`. El día se calcula en UTC (`utcDay`).
- **Decisión**: invocar `checkAndRecordLongRequest` y `consumeDailyQuota` en `POST /api/chat` después de validar origen, tamaño y cuerpo, y **antes** de la cola de admisión y del LLM; los rechazos responden `429` con el código ya existente y sin registrar la interacción. Pasar el día a America/Bogotá (UTC−5 sin cambio de horario) para coincidir con FR-002 y con `secondsUntilNextUtcDay` renombrado a «siguiente día de Bogotá».
- **Falla del contador (FR-002a)**: si `load()`/`persist()` lanzan, usar un contador en memoria por proceso con tope `floor(limite/2)` (mínimo 1) y registrar una notificación de servicio agrupada (reutilizar el mecanismo de eventos de servicio, migración `008_eventos_servicio.sql`).
- **Alternativas**: contador en PostgreSQL (más robusto para varias réplicas, pero el despliegue es de una réplica y el archivo ya existe); descartada por costo.

## R02 — Publicar solo la versión aprobada (NV-02, NV-03, NV-10, FR-004..007)

- **Hecho**: el endpoint valida `expected_revision` al encolar, pero el worker promueve `kb_elemento.version_pendiente_id` vigente en el commit; la preparación filtra `estado_tecnico='procesado'` y el commit no. La limpieza posterior borra `archivosAnteriores` aunque el commit no haya promovido nada.
- **Decisión**:
  1. Columna `kb.document_operation.target_version_id`, fijada al encolar con el `version_pendiente_id` de ese instante.
  2. En la transacción de commit: `UPDATE ... WHERE version_pendiente_id = target_version_id AND estado_tecnico = 'procesado'`; si afecta 0 filas, abortar la transacción y terminar la operación como `failed` con `error_code='candidata_cambiada'`, conservando la vigente.
  3. La preparación indexa solo la versión objetivo.
  4. `finalizarTrasCommit` borra `archivosAnteriores` únicamente si el commit promovió (marca `promoted=true` en `payload`).
- **Alternativa**: bloquear con `SELECT ... FOR UPDATE` durante toda la preparación; descartada, retiene un bloqueo de minutos.

## R03 — Aplazar cargas durante una operación activa (FR-006, aclaración 2)

- **Decisión**: si existe una operación `publish/replace/reindex` no terminal sobre el elemento, `kb.registrar_carga_manual` y `sync` guardan la nueva versión en `kb_elemento.version_aplazada_id` en lugar de `version_pendiente_id`; al terminar la operación (`terminar`) el worker promueve la aplazada a pendiente (con `revision+1`) y notifica. La carga **no** se rechaza.
- **Alternativa**: rechazar con error (opción B de la aclaración) — descartada por el usuario.

## R04 — Retiro reanudable y cola sin bloqueo (NV-07, NV-08, FR-008/009, aclaración 3)

- **Hecho**: `procesarOperaciones` toma la operación más antigua no terminal y sale si su fase no cambió; cualquier excepción termina en `failed`, y `retirarDocumento` exige vigente (imposible tras `retirado_en`).
- **Decisión**:
  - Columnas `cleanup_attempts`, `next_attempt_at`, `needs_attention`.
  - La cola selecciona `phase NOT IN ('complete','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= now())`, ordenada por `created_at` — una operación en espera no bloquea a las demás.
  - Fallos transitorios (Qdrant/DB/IO) en `withdraw`, `reject` y limpieza: no `failed`; `cleanup_attempts+1`, espera 15 s·2^n hasta 5 intentos rápidos (15+30+60+120+240 s ≈ 7,75 min), después cada 60 min indefinidamente; al agotar los rápidos, `needs_attention=true` y **una** notificación agrupada.
  - Solo errores determinísticos (`sin_vigente`, `documento_inexistente`) terminan en `failed`.
  - Endpoint de reanudación inmediata (contrato [admin-operations.md](contracts/admin-operations.md)).

## R05 — Pendiente == publicada (NV-09, FR-010)

- **Decisión**: en `rechazar` y en la rama «hash cambió» de `sync`, si `version_pendiente_id = version_publicada_id`, solo poner `version_pendiente_id = NULL` (con `revision+1`), sin `DELETE` de la versión ni de su `archivo_ref`. Defensa adicional: `ON DELETE SET NULL` de `version_publicada_fk` se cambia a `ON DELETE RESTRICT` en la migración para que un borrado indebido falle en lugar de borrar silenciosamente la referencia (se valida en R05-T en pruebas).

## R06 — Expansión real de ZIP (NV-05, FR-011)

- **Hecho**: `inspeccionarZip` confía en tamaños declarados del directorio central; `mammoth`/`xlsx` leen sin tope.
- **Decisión**: añadir `verificarExpansionReal(ruta, limites)` que, para cada entrada, localiza su cabecera local y la descomprime en flujo con `zlib.createInflateRaw`, contando bytes y abortando al superar `maxExpandido` total o por entrada; se invoca después de `inspeccionarZip` en la detección de formato. Sin dependencias nuevas. Además, `mem_limit` para `kb-worker` en `docker-compose.yml` y mantener `--max-old-space-size`.
- **Alternativa**: librería de descompresión con límites (p. ej. `yauzl`); descartada para no añadir dependencias a una pieza de seguridad que ya parsea cabeceras.

## R07 — OCR acotado (NV-06, FR-012)

- **Decisión**: antes de rasterizar, `pdfinfo` entrega páginas y tamaño; límites configurables `OCR_MAX_PAGES=100`, `OCR_MAX_PIXELS_PAGINA=40_000_000` (si la página excede, reducir `-r` hasta caber, y descartar si aún excede) y `OCR_PLAZO_TOTAL_MS=900_000` por documento. Al superar cualquiera, el documento se descarta con motivo (`ocr_excede_limites`) y la cola continúa. Los valores son valores por defecto; se calibran en el plan de pruebas con un PDF de ~10 páginas.

## R08 — Navegador del scraper (NV-04, FR-013, aclaración 4)

- **Decisión**: en el contexto de Playwright registrar `page.route('**/*')` que valida el host de cada solicitud contra la lista permitida (https) y aborta el resto; tras `goto`, comparar `urlparse(page.url).hostname` con la lista; si no coincide, descartar y registrar en el informe de ejecución con `motivo='host_no_permitido'`. El guardado usa la URL validada de la respuesta final del navegador, no la de `requests`. El backend ya convierte avisos del informe en notificaciones agrupadas para el administrador técnico.

## R09 — Caché de extracción (NV-11, FR-014)

- **Decisión**: eliminar el `Map` a nivel de módulo o limitarlo a 16 entradas con TTL de 10 min; los archivos del directorio de caché llevan nombre por huella y se borran al descartar la carga (OCR rechazado, formato diligenciado, falla) y por barrido al iniciar y cada hora (edad > 24 h).

## R10 — Exportaciones (NV-12, FR-015)

- **Decisión**: registrar `res.on('close')` **antes** de `await prepararExportacion`; pasar una `AbortSignal` y eliminar el archivo si el cliente cierra o la preparación falla; programar `limpiarExportacionesViejas` en el worker/servidor cada 10 min con tope de edad de 60 min.

## R11 — Endurecimiento (FR-016..FR-021)

| Tema | Decisión |
|---|---|
| Entorno por servicio | Reemplazar `env_file: .env` global por `environment:` explícito por servicio (lista mínima); retirar de `.env` y de `.env.example` las llaves de proveedores deshabilitados; `check-env` y `validateDiConfig` ya los rechazan: añadir verificación al arranque directo del backend en producción |
| Cabeceras | Plantilla nginx incluida en `location /` y estáticos: `Content-Security-Policy` (reutiliza `scripts/build-csp.mjs`), `frame-ancestors`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Bloqueo por IP | Pasar la IP por `ipKeyGenerator(ip, 64)` en el login del panel (ya usado por el chat) |
| Sesión absoluta | Columna `absolute_expires_at` = creación + 8 h (aclaración 5); el middleware la comprueba además de la inactividad de 30 min |
| Cambio de contraseña | Limitación de 5 intentos/15 min por cuenta usando la tabla de bloqueos existente |
| HMAC de IP | `ADMIN_IP_HMAC_SECRET` obligatorio en producción; sin respaldo en `AUTH_JWT_SECRET` |
| Estado público | `/api/retrieval/status` y `/ready` devuelven solo `{ok}`; el detalle queda en el log y en el panel |
| Prompt | Escapar/neutralizar los delimitadores del prompt dentro de fragmentos y texto del ciudadano en `buildTutorPrompt` |
| CI | `npm ci` sin `|| npm install`; acciones fijadas por SHA |

## R12 — Estrategia de validación por pista

Para cada NV: (1) prueba que reproduce el defecto con datos sintéticos y servicios locales; (2) corrección; (3) la misma prueba pasa; (4) si la prueba (1) no reproduce, se registra en `evidencias/` con la razón y no se cambia el código (FR-023). Entorno: receta local de SPEC004/SPEC005 (PostgreSQL, Qdrant y Chromium locales; sin red externa).
