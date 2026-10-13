-- SPEC007 · administración documental (bloque 7: RF-C3-AD-01..04, 20..27, 32, 38/39, 47).
-- Corre como kb_writer (dueño del esquema). No altera migraciones aplicadas 001–004.
--
-- Principios: el contenido pendiente nunca es recuperable; la generación activa (colección física +
-- manifiesto) la decide PostgreSQL y Qdrant solo la refleja; retirar/rechazar elimina el contenido y
-- deja únicamente un registro seguro (documento, origen, huella, motivo, usuario, fecha).

ALTER TYPE kb.tipo_notificacion ADD VALUE IF NOT EXISTS 'documento_vencido';
ALTER TYPE kb.tipo_notificacion ADD VALUE IF NOT EXISTS 'fuente_retirada';
ALTER TYPE kb.tipo_notificacion ADD VALUE IF NOT EXISTS 'carga_rechazada';

-- ── Elemento: autoría, validez, revisión y retiro ───────────────────────────

ALTER TABLE kb.kb_elemento
  ADD COLUMN valido_hasta              date,
  ADD COLUMN autor_cuenta_id           uuid,
  ADD COLUMN revision                  bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD COLUMN retirado_en               timestamptz,
  ADD COLUMN vencimiento_avisado_para  date,
  ADD COLUMN actualizacion_automatica_deshabilitada boolean NOT NULL DEFAULT false;

-- «ninguno» (sin procedimiento) solo es válido en cargas manuales; la extracción conserva su regla.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'kb.kb_elemento'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%cardinality(procedimientos_origen)%' LOOP
    EXECUTE format('ALTER TABLE kb.kb_elemento DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE kb.kb_elemento
  ADD CONSTRAINT procedimientos_origen_no_vacio CHECK (origen = 'manual' OR cardinality(procedimientos_origen) > 0);
-- Un documento manual no es «automático»: nunca lleva la marca de fuente retirada.
ALTER TABLE kb.kb_elemento
  ADD CONSTRAINT marca_solo_scraper CHECK (NOT actualizacion_automatica_deshabilitada OR origen = 'scraper');

-- ── Versión: origen, autor, archivo privado y metadata candidata ────────────

ALTER TABLE kb.kb_version
  ADD COLUMN origen               kb.origen_elemento NOT NULL DEFAULT 'scraper',
  ADD COLUMN autor_cuenta_id      uuid,
  ADD COLUMN subida_en            timestamptz,
  ADD COLUMN formato_original     text,
  ADD COLUMN archivo_ref          text,            -- ruta privada relativa al directorio de cargas
  ADD COLUMN metadatos_candidatos jsonb,           -- metadata propuesta; la vigente vive en kb_elemento
  ADD COLUMN estado_tecnico       text NOT NULL DEFAULT 'procesado'
    CHECK (estado_tecnico IN ('en_cola', 'procesando', 'procesado', 'descartado', 'error'));

-- ── Generación activa y manifiesto (autoridad SQL de lo que se sirve) ───────

CREATE TABLE kb.active_generation (
  singleton        boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision         bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  generation_id    uuid NOT NULL,
  collection_name  text NOT NULL,
  manifest_hash    char(64) NOT NULL,
  committed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kb.generation_manifest (
  generation_id      uuid NOT NULL,
  element_id         uuid NOT NULL,
  version_id         uuid NOT NULL,
  content_hash       char(64) NOT NULL,
  metadata_revision  bigint NOT NULL,
  PRIMARY KEY (generation_id, element_id)
);
CREATE INDEX generation_manifest_version ON kb.generation_manifest (version_id);

-- ── Operaciones durables (publicar, reemplazar, rechazar, retirar, reindexar, metadata) ──

CREATE TABLE kb.document_operation (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                  text NOT NULL CHECK (kind IN ('publish', 'replace', 'reject', 'withdraw', 'reindex', 'metadata')),
  actor_account_id      uuid NOT NULL,
  element_id            uuid,
  version_id            uuid,
  expected_revision     bigint,
  phase                 text NOT NULL DEFAULT 'queued'
    CHECK (phase IN ('queued', 'preparing', 'prepared', 'committed', 'reconciling', 'cleaning', 'complete', 'failed')),
  started_at            timestamptz,
  finished_at           timestamptz,
  attempts              integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
  previous_generation   uuid,
  previous_collection   text,
  candidate_collection  text,
  manifest_ref          uuid,
  error_code            text,
  cleanup_pending       boolean NOT NULL DEFAULT false,
  idempotency_key       text,
  payload_hash          char(64),
  payload               jsonb,       -- motivo y campos; nunca contenido documental
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operacion_objetivo CHECK (kind = 'reindex' OR element_id IS NOT NULL),
  CONSTRAINT operacion_terminada CHECK ((phase IN ('complete', 'failed')) = (finished_at IS NOT NULL))
);
-- Una sola reindexación activa: otra mientras tanto se rechaza (RF-C3-AD-47).
CREATE UNIQUE INDEX document_operation_reindex_activa ON kb.document_operation ((true))
  WHERE kind = 'reindex' AND phase NOT IN ('complete', 'failed');
CREATE UNIQUE INDEX document_operation_idempotencia ON kb.document_operation (actor_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX document_operation_cola ON kb.document_operation (created_at) WHERE phase NOT IN ('complete', 'failed');

-- Recibo de limpieza: qué se eliminó y la comprobación de ausencia (sin contenido ni rutas públicas).
CREATE TABLE kb.cleanup_receipt (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id   uuid REFERENCES kb.document_operation (id) ON DELETE SET NULL,
  object_kind    text NOT NULL CHECK (object_kind IN ('coleccion', 'puntos', 'version_sql', 'archivo', 'conversion')),
  object_ref     text NOT NULL,
  identity_hash  char(64),
  deleted_at     timestamptz NOT NULL DEFAULT now(),
  verified_absent boolean NOT NULL,
  detail         text
);

-- ── Rechazo y retiro: solo registro seguro (RF-C3-AD-22/24) ────────────────

CREATE TABLE kb.document_removal (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type               text NOT NULL CHECK (type IN ('reject', 'withdraw')),
  element_key        text NOT NULL,            -- código o URL normalizada
  identity_id        uuid,                     -- kb.document_identity.id (sin contenido)
  document_name      text NOT NULL,
  source_url         text NOT NULL,
  origin             kb.origen_elemento NOT NULL,
  content_hash       char(64) NOT NULL,
  reason             text NOT NULL CHECK (btrim(reason) <> ''),
  actor_account_id   uuid NOT NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now()
);
-- El scraper omite el contenido con la misma huella; una huella nueva vuelve a pendiente.
CREATE INDEX document_removal_url_hash ON kb.document_removal (source_url, origin, content_hash, type);

-- ── Identidad documental histórica (atribución de citas sin conservar contenido) ──

CREATE TABLE kb.document_identity (
  id            uuid PRIMARY KEY,               -- = kb_elemento.id mientras exista
  element_key   text NOT NULL,
  codigo        text,
  titulo        text NOT NULL,
  direccion     kb.direccion NOT NULL,
  tipo          kb.tipo_elemento NOT NULL,
  url_origen    text NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_identity_key ON kb.document_identity (element_key);

INSERT INTO kb.document_identity (id, element_key, codigo, titulo, direccion, tipo, url_origen)
SELECT id, clave, codigo, nombre, direccion, tipo, url_origen FROM kb.kb_elemento
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION kb.sync_document_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, kb AS $$
BEGIN
  INSERT INTO kb.document_identity (id, element_key, codigo, titulo, direccion, tipo, url_origen, actualizado_en)
  VALUES (NEW.id, NEW.clave, NEW.codigo, NEW.nombre, NEW.direccion, NEW.tipo, NEW.url_origen, now())
  ON CONFLICT (id) DO UPDATE SET element_key = EXCLUDED.element_key, codigo = EXCLUDED.codigo, titulo = EXCLUDED.titulo,
    direccion = EXCLUDED.direccion, tipo = EXCLUDED.tipo, url_origen = EXCLUDED.url_origen, actualizado_en = now();
  RETURN NEW;
END $$;
CREATE TRIGGER kb_elemento_identidad AFTER INSERT OR UPDATE ON kb.kb_elemento
  FOR EACH ROW EXECUTE FUNCTION kb.sync_document_identity();

-- ── Notificaciones: alcance y propietario verificado (RF-C3-AD-28..31) ──────

ALTER TABLE kb.kb_notificacion
  ADD COLUMN alcance            text   NOT NULL DEFAULT 'sistema' CHECK (alcance IN ('sistema', 'carga')),
  ADD COLUMN propietario_cuenta uuid,
  ADD COLUMN identidad_documento text,
  ADD COLUMN revision           bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD COLUMN propietario_clave  uuid GENERATED ALWAYS AS (COALESCE(propietario_cuenta, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  ADD CONSTRAINT notificacion_carga_con_propietario CHECK (alcance = 'sistema' OR propietario_cuenta IS NOT NULL);
DROP INDEX kb.kb_notificacion_agrupada;
CREATE UNIQUE INDEX kb_notificacion_agrupada ON kb.kb_notificacion (tipo, objeto, alcance, propietario_clave)
  WHERE estado = 'no_revisada';
CREATE INDEX kb_notificacion_propietario ON kb.kb_notificacion (alcance, propietario_cuenta, estado, ultima_en DESC);

-- ── Vistas de lectura ───────────────────────────────────────────────────────

-- Vigencia civil en Bogotá: disponible durante TODO el día de validez (hasta 23:59:59) y excluido
-- desde el comienzo del día siguiente. El instante es un parámetro para poder probarla sin reloj.
CREATE FUNCTION kb.vigente_en(p_valido_hasta date, p_instante timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_valido_hasta IS NULL OR p_valido_hasta >= (p_instante AT TIME ZONE 'America/Bogota')::date
$$;
GRANT EXECUTE ON FUNCTION kb.vigente_en(date, timestamptz) TO app_reader;

-- Lo recuperable: solo la versión PUBLICADA de elementos publicados, no retirados y dentro de su
-- validez civil en Bogotá (disponible durante todo el día de validez, excluido desde el siguiente).
CREATE VIEW kb.v_recuperacion AS
SELECT e.id AS elemento_id, e.version_publicada_id AS version_id, e.clave, e.codigo, e.nombre, e.tipo, e.direccion,
       e.url_origen, e.url_padre, e.fecha_actualizacion, e.valido_hasta, e.revision, v.fecha_acceso, v.hash_contenido,
       (e.estado IN ('publicado') AND e.retirado_en IS NULL AND kb.vigente_en(e.valido_hasta, now())) AS vigente
  FROM kb.kb_elemento e
  JOIN kb.kb_version v ON v.id = e.version_publicada_id;

-- Matriz administrativa: las 12 columnas heredadas más origen, autor, validez y candidata.
CREATE VIEW kb.v_matriz_admin AS
SELECT
  e.id, e.revision, e.clave,
  COALESCE(e.codigo, 'N/A') AS codigo,
  e.nombre,
  CASE e.tipo WHEN 'procedimiento' THEN 'Procedimiento' WHEN 'formato' THEN 'Formato'
    WHEN 'norma' THEN 'Norma' WHEN 'pagina' THEN 'Página' ELSE 'Documento' END AS tipo,
  CASE e.direccion WHEN 'ecosistemas' THEN 'Ecosistemas' WHEN 'bienestar_animal' THEN 'Bienestar Animal'
    WHEN 'gestion_ambiental' THEN 'Gestión Ambiental' ELSE 'Secretaría (general)' END AS direccion,
  e.url_origen,
  CASE
    WHEN e.estado = 'derogado' THEN 'Derogado'
    WHEN e.estado = 'pendiente_aprobacion' THEN 'Pendiente de aprobación'
    WHEN e.estado = 'vencido' OR NOT kb.vigente_en(e.valido_hasta, now()) THEN 'Vencido'
    ELSE 'Publicado' END AS estado,
  COALESCE(e.version_documento, 'N/A') AS version,
  COALESCE(to_char(e.fecha_actualizacion, 'DD/MM/YYYY'), 'N/A') AS fecha_actualizacion,
  upper(e.formato_original) AS formato_original,
  CASE WHEN e.ocr_aplicado THEN 'Sí' ELSE 'No' END AS uso_ocr,
  to_char(e.fecha_carga AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI') AS fecha_carga,
  CASE WHEN cardinality(e.procedimientos_origen) = 0 THEN 'ninguno' ELSE array_to_string(e.procedimientos_origen, ', ') END AS procedimiento_origen,
  e.origen, e.fuente, e.autor_cuenta_id, e.fecha_carga AS fecha_carga_ts,
  to_char(e.valido_hasta, 'YYYY-MM-DD') AS valido_hasta,
  e.version_publicada_id IS NOT NULL AS tiene_vigente,
  e.version_pendiente_id IS NOT NULL AS tiene_candidata,
  e.actualizacion_automatica_deshabilitada AS sin_actualizacion_automatica,
  vp.estado_tecnico AS estado_candidata, vp.subida_en AS candidata_subida_en,
  vp.autor_cuenta_id AS candidata_autor_cuenta_id, vp.id AS candidata_version_id
FROM kb.kb_elemento e
LEFT JOIN kb.kb_version vp ON vp.id = e.version_pendiente_id
WHERE e.retirado_en IS NULL;

-- El enlace de un código solo existe mientras el documento sea recuperable: retirado, vencido o
-- derogado dejan de enlazarse en la consulta siguiente (la caché del chat es de segundos).
CREATE OR REPLACE VIEW kb.v_codigos_publicados AS
SELECT codigo, COALESCE(url_descarga, url_origen) AS url
  FROM kb.kb_elemento
 WHERE estado = 'publicado' AND codigo IS NOT NULL AND retirado_en IS NULL AND kb.vigente_en(valido_hasta, now());

-- ── Permisos de lectura y de encolado del panel ─────────────────────────────

GRANT SELECT ON kb.v_recuperacion, kb.active_generation, kb.generation_manifest TO app_reader;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT USAGE ON SCHEMA kb TO admin_app;
    GRANT SELECT ON kb.v_matriz_admin, kb.document_operation, kb.document_removal, kb.active_generation, kb.kb_auditoria, kb.document_identity TO admin_app;
    GRANT UPDATE (revision) ON kb.kb_notificacion TO admin_app;
    -- El panel solo crea el comando: fase, intentos y colecciones los controla el worker.
    GRANT INSERT (kind, actor_account_id, element_id, expected_revision, idempotency_key, payload_hash, payload)
      ON kb.document_operation TO admin_app;
  END IF;
END $$;

-- ── Registro de una carga manual (RF-C3-AD-01/02) ───────────────────────────
--
-- El panel no escribe en la matriz: llama a esta función con la cuenta de la sesión. Resuelve la
-- identidad por código o por enlace; si cada uno señala un documento distinto no fusiona (KB409).
-- La versión nace PENDIENTE y «en cola»: no es recuperable hasta que el worker la procese y un
-- administrador la publique.
CREATE FUNCTION kb.registrar_carga_manual(
  p_actor uuid, p_clave text, p_codigo text, p_nombre text, p_tipo kb.tipo_elemento, p_direccion kb.direccion,
  p_url text, p_version text, p_fecha_actualizacion date, p_valido_hasta date, p_procedimientos text[],
  p_formato text, p_hash char(64), p_archivo_ref text, p_metadatos jsonb
) RETURNS TABLE (elemento_id uuid, version_id uuid, nuevo boolean, archivo_reemplazado text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE
  v_por_clave uuid;
  v_por_url   uuid;
  v_elem      kb.kb_elemento%ROWTYPE;
  v_ver       uuid;
  v_viejo     text;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'actor_requerido' USING ERRCODE = 'KB400'; END IF;
  SELECT id INTO v_por_clave FROM kb.kb_elemento WHERE clave = p_clave AND retirado_en IS NULL;
  SELECT id INTO v_por_url FROM kb.kb_elemento WHERE (url_origen = p_url OR clave = p_url) AND retirado_en IS NULL LIMIT 1;
  IF v_por_clave IS NOT NULL AND v_por_url IS NOT NULL AND v_por_clave <> v_por_url THEN
    RAISE EXCEPTION 'identidad_ambigua' USING ERRCODE = 'KB409';
  END IF;
  SELECT * INTO v_elem FROM kb.kb_elemento WHERE id = COALESCE(v_por_clave, v_por_url) FOR UPDATE;

  IF v_elem.id IS NULL THEN
    INSERT INTO kb.kb_elemento (clave, codigo, nombre, tipo, direccion, url_origen, estado, version_documento,
                                fecha_actualizacion, formato_original, procedimientos_origen, fuente, origen,
                                valido_hasta, autor_cuenta_id)
    VALUES (p_clave, p_codigo, p_nombre, p_tipo, p_direccion, p_url, 'pendiente_aprobacion', p_version,
            p_fecha_actualizacion, p_formato, COALESCE(p_procedimientos, '{}'), 'manual', 'manual',
            p_valido_hasta, p_actor)
    RETURNING * INTO v_elem;
    nuevo := true;
  ELSE
    nuevo := false;
    -- Sin versión publicada, la metadata del elemento es la candidata; con publicada, no se toca.
    IF v_elem.version_publicada_id IS NULL THEN
      UPDATE kb.kb_elemento SET codigo = p_codigo, nombre = p_nombre, tipo = p_tipo, direccion = p_direccion,
             url_origen = p_url, version_documento = p_version, fecha_actualizacion = p_fecha_actualizacion,
             valido_hasta = p_valido_hasta, formato_original = p_formato,
             procedimientos_origen = COALESCE(p_procedimientos, '{}'), revision = revision + 1, actualizado_en = now()
       WHERE id = v_elem.id;
    END IF;
    IF v_elem.version_pendiente_id IS NOT NULL THEN
      SELECT archivo_ref INTO v_viejo FROM kb.kb_version WHERE id = v_elem.version_pendiente_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO kb.kb_version (elemento_id, hash_contenido, hash_original, contenido_md, fecha_acceso, origen,
                               autor_cuenta_id, subida_en, formato_original, archivo_ref, metadatos_candidatos, estado_tecnico)
    VALUES (v_elem.id, p_hash, p_hash, '', now(), 'manual', p_actor, now(), p_formato, p_archivo_ref, p_metadatos, 'en_cola')
    RETURNING id INTO v_ver;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'contenido_repetido' USING ERRCODE = 'KB410';
  END;

  IF v_elem.version_pendiente_id IS NOT NULL THEN
    DELETE FROM kb.kb_version WHERE id = v_elem.version_pendiente_id AND id IS DISTINCT FROM v_elem.version_publicada_id;
  END IF;
  UPDATE kb.kb_elemento SET version_pendiente_id = v_ver, autor_cuenta_id = COALESCE(autor_cuenta_id, p_actor),
         actualizado_en = now() WHERE id = v_elem.id;

  elemento_id := v_elem.id; version_id := v_ver; archivo_reemplazado := v_viejo;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION kb.registrar_carga_manual(uuid, text, text, text, kb.tipo_elemento, kb.direccion, text, text, date, date, text[], text, char, text, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION kb.registrar_carga_manual(uuid, text, text, text, kb.tipo_elemento, kb.direccion, text, text, date, date, text[], text, char, text, jsonb) TO admin_app;
  END IF;
END $$;

-- ── Edición de metadata (RF-C3-AD-39) ───────────────────────────────────────
--
-- Cambia solo campos permitidos (el código y la huella no se editan). Sobre la versión VIGENTE
-- actualiza el elemento; sobre la CANDIDATA actualiza su metadata sin tocar lo vigente. Una fecha
-- de validez futura restaura un documento vencido, nunca uno pendiente ni derogado.
CREATE FUNCTION kb.editar_metadata_documento(
  p_elemento uuid, p_revision bigint, p_destino text, p_cambios jsonb, p_actor uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE
  e kb.kb_elemento%ROWTYPE;
  v_hoy date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_valido date;
BEGIN
  SELECT * INTO e FROM kb.kb_elemento WHERE id = p_elemento AND retirado_en IS NULL FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'no_encontrado' USING ERRCODE = 'KB404'; END IF;
  IF e.revision <> p_revision THEN RAISE EXCEPTION 'revision_obsoleta' USING ERRCODE = 'KB412'; END IF;
  IF p_destino NOT IN ('vigente', 'candidata') THEN RAISE EXCEPTION 'destino_invalido' USING ERRCODE = 'KB400'; END IF;

  IF p_destino = 'candidata' THEN
    IF e.version_pendiente_id IS NULL THEN RAISE EXCEPTION 'sin_candidata' USING ERRCODE = 'KB422'; END IF;
    UPDATE kb.kb_version SET metadatos_candidatos = COALESCE(metadatos_candidatos, '{}'::jsonb) || COALESCE(p_cambios -> 'candidatos', '{}'::jsonb)
     WHERE id = e.version_pendiente_id;
  ELSIF e.version_publicada_id IS NULL THEN
    RAISE EXCEPTION 'sin_vigente' USING ERRCODE = 'KB422';
  END IF;

  -- Sin versión publicada la metadata del elemento ES la candidata; con publicada solo el destino «vigente» la toca.
  IF p_destino = 'vigente' OR e.version_publicada_id IS NULL THEN
    v_valido := CASE WHEN p_cambios ? 'validoHasta' THEN NULLIF(p_cambios ->> 'validoHasta', '')::date ELSE e.valido_hasta END;
    UPDATE kb.kb_elemento SET
      nombre = COALESCE(p_cambios ->> 'nombre', nombre),
      tipo = COALESCE((p_cambios ->> 'tipo')::kb.tipo_elemento, tipo),
      direccion = COALESCE((p_cambios ->> 'direccion')::kb.direccion, direccion),
      url_origen = COALESCE(p_cambios ->> 'urlOrigen', url_origen),
      version_documento = CASE WHEN p_cambios ? 'version' THEN NULLIF(p_cambios ->> 'version', '') ELSE version_documento END,
      fecha_actualizacion = CASE WHEN p_cambios ? 'fechaActualizacion' THEN NULLIF(p_cambios ->> 'fechaActualizacion', '')::date ELSE fecha_actualizacion END,
      valido_hasta = v_valido,
      procedimientos_origen = CASE WHEN p_cambios ? 'procedimientos'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_cambios -> 'procedimientos')) ELSE procedimientos_origen END,
      estado = CASE WHEN estado = 'vencido' AND version_publicada_id IS NOT NULL
                      AND (v_valido IS NULL OR v_valido >= v_hoy) THEN 'publicado'::kb.estado_elemento ELSE estado END,
      vencimiento_avisado_para = CASE WHEN v_valido IS DISTINCT FROM valido_hasta THEN NULL ELSE vencimiento_avisado_para END,
      revision = revision + 1, actualizado_en = now()
     WHERE id = e.id;
  ELSE
    UPDATE kb.kb_elemento SET revision = revision + 1, actualizado_en = now() WHERE id = e.id;
  END IF;

  IF p_destino = 'vigente' AND e.version_publicada_id IS NOT NULL THEN
    -- El payload de Qdrant se sincroniza con una operación durable; la consulta ya usa lo nuevo.
    INSERT INTO kb.document_operation (kind, actor_account_id, element_id, expected_revision, payload)
    VALUES ('metadata', p_actor, e.id, e.revision + 1, '{}'::jsonb);
  END IF;
  RETURN e.revision + 1;
END $$;

REVOKE ALL ON FUNCTION kb.editar_metadata_documento(uuid, bigint, text, jsonb, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION kb.editar_metadata_documento(uuid, bigint, text, jsonb, uuid) TO admin_app;
  END IF;
END $$;
