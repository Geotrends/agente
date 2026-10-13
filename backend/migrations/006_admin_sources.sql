-- SPEC007 · fuentes y propuestas de enlaces del scraper (RF-C3-AD-14..19, 33, 34).
-- Corre como kb_writer. La lista de HOSTS permitidos NO vive aquí (solo cambia con un despliegue);
-- aquí viven los enlaces (semillas) que el scraper recorre y las propuestas de las personas.

CREATE TABLE kb.scraper_link_list (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision   bigint NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
INSERT INTO kb.scraper_link_list DEFAULT VALUES;

CREATE TABLE kb.scraper_link (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url            text NOT NULL UNIQUE CHECK (url LIKE 'https://%'),
  source         text NOT NULL,              -- fuente del scraper que lo recorre (por host)
  direction      kb.direccion NOT NULL,
  justification  text NOT NULL CHECK (btrim(justification) <> ''),
  active         boolean NOT NULL DEFAULT true,
  revision       bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  changed_by     uuid,                       -- NULL = semilla inicial
  changed_by_name text,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  list_version   bigint NOT NULL DEFAULT 1,
  removal_reason text
);
CREATE INDEX scraper_link_active ON kb.scraper_link (active, source);

CREATE TABLE kb.link_proposal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id  uuid NOT NULL,
  owner_name        text,
  type              text NOT NULL CHECK (type IN ('add', 'remove')),
  url               text NOT NULL CHECK (url LIKE 'https://%'),
  direction         kb.direccion NOT NULL,
  justification     text NOT NULL CHECK (btrim(justification) <> ''),
  state             text NOT NULL DEFAULT 'Pendiente de validación'
    CHECK (state IN ('Pendiente de validación', 'Aprobada', 'Rechazada', 'Retirada')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_by        uuid,
  decided_by_name   text,
  decided_at        timestamptz,
  rejection_reason  text,
  revision          bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CONSTRAINT decision_coherente CHECK (
    (state = 'Pendiente de validación' AND decided_at IS NULL AND rejection_reason IS NULL)
    OR (state = 'Retirada' AND rejection_reason IS NULL)
    OR (state = 'Aprobada' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NULL)
    OR (state = 'Rechazada' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND btrim(coalesce(rejection_reason, '')) <> '')
  )
);
CREATE INDEX link_proposal_owner ON kb.link_proposal (owner_account_id, state, created_at DESC);
CREATE INDEX link_proposal_state ON kb.link_proposal (state, created_at);

-- ── Funciones de escritura (el panel no escribe directamente) ───────────────

CREATE FUNCTION kb.proponer_enlace(p_owner uuid, p_owner_name text, p_type text, p_url text, p_direction kb.direccion, p_justification text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE v_id uuid;
BEGIN
  IF p_type = 'remove' AND NOT EXISTS (SELECT 1 FROM kb.scraper_link WHERE url = p_url AND active) THEN
    RAISE EXCEPTION 'enlace_no_vigente' USING ERRCODE = 'KB404';
  END IF;
  IF p_type = 'add' AND EXISTS (SELECT 1 FROM kb.scraper_link WHERE url = p_url AND active) THEN
    RAISE EXCEPTION 'enlace_ya_vigente' USING ERRCODE = 'KB409';
  END IF;
  INSERT INTO kb.link_proposal (owner_account_id, owner_name, type, url, direction, justification)
  VALUES (p_owner, p_owner_name, p_type, p_url, p_direction, p_justification) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION kb.retirar_propuesta(p_id uuid, p_owner uuid, p_revision bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE p kb.link_proposal%ROWTYPE;
BEGIN
  SELECT * INTO p FROM kb.link_proposal WHERE id = p_id FOR UPDATE;
  -- Una propuesta ajena no revela su existencia.
  IF p.id IS NULL OR p.owner_account_id <> p_owner THEN RAISE EXCEPTION 'no_encontrada' USING ERRCODE = 'KB404'; END IF;
  IF p.revision <> p_revision THEN RAISE EXCEPTION 'revision_obsoleta' USING ERRCODE = 'KB412'; END IF;
  IF p.state <> 'Pendiente de validación' THEN RAISE EXCEPTION 'no_pendiente' USING ERRCODE = 'KB409'; END IF;
  UPDATE kb.link_proposal SET state = 'Retirada', revision = revision + 1 WHERE id = p_id;
  RETURN p.revision + 1;
END $$;

-- Aplica la quita de un enlace: lo desactiva, sube la versión de la lista, marca los documentos
-- publicados del scraper cuyo origen es ese enlace y avisa (solo técnico) si los había.
CREATE FUNCTION kb.aplicar_quita_enlace(p_url text, p_actor uuid, p_actor_name text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE
  v_version bigint;
  v_docs jsonb;
  v_base text := rtrim(p_url, '/');
BEGIN
  UPDATE kb.scraper_link_list SET revision = revision + 1 RETURNING revision INTO v_version;
  UPDATE kb.scraper_link SET active = false, revision = revision + 1, changed_by = p_actor, changed_by_name = p_actor_name,
         changed_at = now(), list_version = v_version, removal_reason = p_reason WHERE url = p_url;
  WITH afectados AS (
    UPDATE kb.kb_elemento SET actualizacion_automatica_deshabilitada = true, revision = revision + 1
     WHERE origen = 'scraper' AND estado = 'publicado' AND retirado_en IS NULL
       AND (rtrim(url_origen, '/') = v_base OR rtrim(coalesce(url_padre, ''), '/') = v_base
            OR url_origen LIKE v_base || '/%' OR url_origen LIKE v_base || '?%')
     RETURNING id, clave, nombre)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'clave', clave, 'nombre', nombre) ORDER BY clave), '[]'::jsonb)
    INTO v_docs FROM afectados;
  IF jsonb_array_length(v_docs) > 0 THEN
    INSERT INTO kb.kb_notificacion (tipo, objeto, descripcion)
    VALUES ('fuente_retirada', p_url,
            'Enlace quitado: ' || p_url || ' · ' || to_char(now() AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI')
            || ' · por ' || coalesce(p_actor_name, 'usuario del panel') || ' · documentos que siguen publicados sin actualización automática: '
            || (SELECT string_agg(d ->> 'clave', ', ') FROM jsonb_array_elements(v_docs) d))
    ON CONFLICT (tipo, objeto, alcance, propietario_clave) WHERE estado = 'no_revisada'
    DO UPDATE SET repeticiones = kb.kb_notificacion.repeticiones + 1, ultima_en = now(), descripcion = EXCLUDED.descripcion;
  END IF;
  RETURN jsonb_build_object('listVersion', v_version, 'documents', v_docs);
END $$;

-- Agrega (o reactiva) un enlace y retira la marca «sin actualización automática» de sus documentos.
CREATE FUNCTION kb.aplicar_alta_enlace(p_url text, p_source text, p_direction kb.direccion, p_justification text, p_actor uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE v_version bigint; v_id uuid; v_base text := rtrim(p_url, '/');
BEGIN
  UPDATE kb.scraper_link_list SET revision = revision + 1 RETURNING revision INTO v_version;
  INSERT INTO kb.scraper_link (url, source, direction, justification, active, changed_by, changed_by_name, list_version)
  VALUES (p_url, p_source, p_direction, p_justification, true, p_actor, p_actor_name, v_version)
  ON CONFLICT (url) DO UPDATE SET source = EXCLUDED.source, direction = EXCLUDED.direction, justification = EXCLUDED.justification,
    active = true, revision = kb.scraper_link.revision + 1, changed_by = EXCLUDED.changed_by, changed_by_name = EXCLUDED.changed_by_name,
    changed_at = now(), list_version = EXCLUDED.list_version, removal_reason = NULL
  RETURNING id INTO v_id;
  UPDATE kb.kb_elemento SET actualizacion_automatica_deshabilitada = false, revision = revision + 1
   WHERE actualizacion_automatica_deshabilitada AND origen = 'scraper'
     AND (rtrim(url_origen, '/') = v_base OR rtrim(coalesce(url_padre, ''), '/') = v_base
          OR url_origen LIKE v_base || '/%' OR url_origen LIKE v_base || '?%');
  RETURN jsonb_build_object('id', v_id, 'listVersion', v_version);
END $$;

CREATE FUNCTION kb.decidir_propuesta(p_id uuid, p_actor uuid, p_actor_name text, p_revision bigint, p_aprobar boolean,
                                     p_motivo text, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE p kb.link_proposal%ROWTYPE; v_res jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO p FROM kb.link_proposal WHERE id = p_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'no_encontrada' USING ERRCODE = 'KB404'; END IF;
  IF p.revision <> p_revision THEN RAISE EXCEPTION 'revision_obsoleta' USING ERRCODE = 'KB412'; END IF;
  IF p.state <> 'Pendiente de validación' THEN RAISE EXCEPTION 'ya_decidida' USING ERRCODE = 'KB409'; END IF;
  IF NOT p_aprobar AND btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'motivo_requerido' USING ERRCODE = 'KB400'; END IF;
  IF p_aprobar THEN
    IF p.type = 'add' THEN
      v_res := kb.aplicar_alta_enlace(p.url, p_source, p.direction, p.justification, p_actor, p_actor_name);
    ELSE
      IF NOT EXISTS (SELECT 1 FROM kb.scraper_link WHERE url = p.url AND active) THEN
        RAISE EXCEPTION 'enlace_no_vigente' USING ERRCODE = 'KB404';
      END IF;
      v_res := kb.aplicar_quita_enlace(p.url, p_actor, p_actor_name, p.justification);
    END IF;
  END IF;
  UPDATE kb.link_proposal SET state = CASE WHEN p_aprobar THEN 'Aprobada' ELSE 'Rechazada' END,
         decided_by = p_actor, decided_by_name = p_actor_name, decided_at = now(),
         rejection_reason = CASE WHEN p_aprobar THEN NULL ELSE btrim(p_motivo) END, revision = revision + 1
   WHERE id = p_id;
  RETURN v_res;
END $$;

CREATE FUNCTION kb.agregar_enlace_directo(p_actor uuid, p_actor_name text, p_url text, p_source text, p_direction kb.direccion,
                                          p_justification text, p_expected_list bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
BEGIN
  IF (SELECT revision FROM kb.scraper_link_list FOR UPDATE) <> p_expected_list THEN
    RAISE EXCEPTION 'revision_lista_obsoleta' USING ERRCODE = 'KB412';
  END IF;
  IF EXISTS (SELECT 1 FROM kb.scraper_link WHERE url = p_url AND active) THEN
    RAISE EXCEPTION 'enlace_ya_vigente' USING ERRCODE = 'KB409';
  END IF;
  RETURN kb.aplicar_alta_enlace(p_url, p_source, p_direction, p_justification, p_actor, p_actor_name);
END $$;

CREATE FUNCTION kb.quitar_enlace_directo(p_actor uuid, p_actor_name text, p_id uuid, p_justification text,
                                         p_expected_revision bigint, p_expected_list bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE l kb.scraper_link%ROWTYPE;
BEGIN
  IF (SELECT revision FROM kb.scraper_link_list FOR UPDATE) <> p_expected_list THEN
    RAISE EXCEPTION 'revision_lista_obsoleta' USING ERRCODE = 'KB412';
  END IF;
  SELECT * INTO l FROM kb.scraper_link WHERE id = p_id FOR UPDATE;
  IF l.id IS NULL OR NOT l.active THEN RAISE EXCEPTION 'no_encontrada' USING ERRCODE = 'KB404'; END IF;
  IF l.revision <> p_expected_revision THEN RAISE EXCEPTION 'revision_obsoleta' USING ERRCODE = 'KB412'; END IF;
  RETURN kb.aplicar_quita_enlace(l.url, p_actor, p_actor_name, p_justification);
END $$;

-- Las semillas iniciales las siembra el worker desde la configuración desplegada (idempotente).
CREATE FUNCTION kb.sembrar_enlaces(p_links jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kb AS $$
DECLARE n integer := 0; r jsonb; v bigint;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_links) LOOP
    IF NOT EXISTS (SELECT 1 FROM kb.scraper_link WHERE url = r ->> 'url') THEN
      UPDATE kb.scraper_link_list SET revision = revision + 1 RETURNING revision INTO v;
      INSERT INTO kb.scraper_link (url, source, direction, justification, list_version)
      VALUES (r ->> 'url', r ->> 'source', (r ->> 'direction')::kb.direccion,
              'Semilla inicial de la base de conocimiento (configuración desplegada)', v);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION kb.proponer_enlace(uuid, text, text, text, kb.direccion, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kb.retirar_propuesta(uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION kb.aplicar_quita_enlace(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kb.aplicar_alta_enlace(text, text, kb.direccion, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kb.decidir_propuesta(uuid, uuid, text, bigint, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kb.agregar_enlace_directo(uuid, text, text, text, kb.direccion, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION kb.quitar_enlace_directo(uuid, text, uuid, text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION kb.sembrar_enlaces(jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT USAGE ON SCHEMA kb TO admin_app;
    GRANT SELECT ON kb.scraper_link, kb.scraper_link_list, kb.link_proposal TO admin_app;
    GRANT EXECUTE ON FUNCTION kb.proponer_enlace(uuid, text, text, text, kb.direccion, text) TO admin_app;
    GRANT EXECUTE ON FUNCTION kb.retirar_propuesta(uuid, uuid, bigint) TO admin_app;
    GRANT EXECUTE ON FUNCTION kb.decidir_propuesta(uuid, uuid, text, bigint, boolean, text, text) TO admin_app;
    GRANT EXECUTE ON FUNCTION kb.agregar_enlace_directo(uuid, text, text, text, kb.direccion, text, bigint) TO admin_app;
    GRANT EXECUTE ON FUNCTION kb.quitar_enlace_directo(uuid, text, uuid, text, bigint, bigint) TO admin_app;
  END IF;
END $$;
