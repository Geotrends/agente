-- SPEC008 — corrección de hallazgos de la auditoría de seguridad (NV-02, NV-03, NV-07..NV-10).
--
-- Aditiva y reversible. DOWN (manual):
--   ALTER TABLE kb.kb_elemento DROP COLUMN version_aplazada_id;
--   ALTER TABLE kb.document_operation DROP COLUMN target_version_id, DROP COLUMN cleanup_attempts,
--     DROP COLUMN next_attempt_at, DROP COLUMN needs_attention;
--   ALTER TABLE kb.kb_elemento DROP CONSTRAINT version_publicada_fk,
--     ADD CONSTRAINT version_publicada_fk FOREIGN KEY (version_publicada_id) REFERENCES kb.kb_version (id) ON DELETE SET NULL;
--   (y restaurar kb.registrar_carga_manual desde 005_administracion_documental.sql)

-- La operación de publicación queda atada a la versión que el administrador aprobó (NV-02, NV-03).
ALTER TABLE kb.document_operation
  ADD COLUMN target_version_id uuid REFERENCES kb.kb_version (id) ON DELETE SET NULL,
  ADD COLUMN cleanup_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at  timestamptz,
  ADD COLUMN needs_attention  boolean NOT NULL DEFAULT false;

-- Versión recibida mientras había una publicación/rechazo en curso: espera al final de la operación.
ALTER TABLE kb.kb_elemento
  ADD COLUMN version_aplazada_id uuid REFERENCES kb.kb_version (id) ON DELETE SET NULL,
  ADD CONSTRAINT version_aplazada_distinta CHECK (version_aplazada_id IS NULL OR version_aplazada_id <> version_publicada_id);

-- Una versión nunca desaparece en silencio mientras sea la publicada de un elemento (NV-09).
ALTER TABLE kb.kb_elemento DROP CONSTRAINT version_publicada_fk;
ALTER TABLE kb.kb_elemento
  ADD CONSTRAINT version_publicada_fk FOREIGN KEY (version_publicada_id) REFERENCES kb.kb_version (id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS kb.document_operation_cola;
CREATE INDEX document_operation_cola ON kb.document_operation (created_at)
  WHERE phase NOT IN ('complete', 'failed');

-- Carga manual: con una publicación o un rechazo en curso sobre el mismo elemento, la versión nueva
-- se aplaza (no cambia el objetivo de la operación) y pasa a pendiente al terminar (FR-006).
CREATE OR REPLACE FUNCTION kb.registrar_carga_manual(
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
  v_activa    boolean := false;
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
    SELECT EXISTS (SELECT 1 FROM kb.document_operation
                    WHERE element_id = v_elem.id AND kind IN ('publish', 'replace', 'reject')
                      AND phase NOT IN ('complete', 'failed')) INTO v_activa;
    -- Sin versión publicada, la metadata del elemento es la candidata; con publicada, no se toca.
    -- Con una operación en curso tampoco se toca: la candidata aprobada no debe cambiar.
    IF v_elem.version_publicada_id IS NULL AND NOT v_activa THEN
      UPDATE kb.kb_elemento SET codigo = p_codigo, nombre = p_nombre, tipo = p_tipo, direccion = p_direccion,
             url_origen = p_url, version_documento = p_version, fecha_actualizacion = p_fecha_actualizacion,
             valido_hasta = p_valido_hasta, formato_original = p_formato,
             procedimientos_origen = COALESCE(p_procedimientos, '{}'), revision = revision + 1, actualizado_en = now()
       WHERE id = v_elem.id;
    END IF;
    IF v_activa THEN
      IF v_elem.version_aplazada_id IS NOT NULL THEN
        SELECT archivo_ref INTO v_viejo FROM kb.kb_version WHERE id = v_elem.version_aplazada_id;
      END IF;
    ELSIF v_elem.version_pendiente_id IS NOT NULL THEN
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

  IF v_activa THEN
    UPDATE kb.kb_elemento SET version_aplazada_id = NULL WHERE id = v_elem.id;
    IF v_elem.version_aplazada_id IS NOT NULL THEN
      DELETE FROM kb.kb_version WHERE id = v_elem.version_aplazada_id
        AND id IS DISTINCT FROM v_elem.version_publicada_id AND id IS DISTINCT FROM v_elem.version_pendiente_id;
    END IF;
    UPDATE kb.kb_elemento SET version_aplazada_id = v_ver, autor_cuenta_id = COALESCE(autor_cuenta_id, p_actor),
           actualizado_en = now() WHERE id = v_elem.id;
  ELSE
    IF v_elem.version_pendiente_id IS NOT NULL THEN
      DELETE FROM kb.kb_version WHERE id = v_elem.version_pendiente_id AND id IS DISTINCT FROM v_elem.version_publicada_id;
    END IF;
    UPDATE kb.kb_elemento SET version_pendiente_id = v_ver, autor_cuenta_id = COALESCE(autor_cuenta_id, p_actor),
           actualizado_en = now() WHERE id = v_elem.id;
  END IF;

  elemento_id := v_elem.id; version_id := v_ver; archivo_reemplazado := v_viejo;
  RETURN NEXT;
END $$;

-- El panel no lee la tabla de elementos: esta función entrega la versión pendiente que se aprueba.
-- Bloquea la fila en modo compartido para que la lectura sea coherente con la revisión validada.
CREATE FUNCTION kb.version_pendiente_de(p_elemento uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
  SELECT version_pendiente_id FROM kb.kb_elemento WHERE id = p_elemento FOR SHARE
$$;
REVOKE ALL ON FUNCTION kb.version_pendiente_de(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION kb.version_pendiente_de(uuid) TO admin_app;
    GRANT INSERT (target_version_id) ON kb.document_operation TO admin_app;
    GRANT UPDATE (cleanup_attempts, next_attempt_at, needs_attention) ON kb.document_operation TO admin_app;
  END IF;
END $$;
