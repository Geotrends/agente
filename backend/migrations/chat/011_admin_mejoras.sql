-- SPEC007 · casos de mejora (RF-C4-AD-03..05): un caso por interacción elegible, sin copiar texto.
-- No altera 001–010. Corre como chat_owner. `anonymous_usage` NO tiene gancho: lo anónimo nunca genera caso.

CREATE TABLE admin.improvement_case (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_row_id  bigint NOT NULL UNIQUE REFERENCES chat.interaction (row_id),
  origins             text[] NOT NULL CHECK (cardinality(origins) BETWEEN 1 AND 2 AND origins <@ ARRAY['sin información', 'No útil']),
  created_at          timestamptz NOT NULL,   -- fecha real del primer origen
  updated_at          timestamptz NOT NULL DEFAULT now(),
  failure_type        text CHECK (failure_type IN ('Datos', 'Recuperación', 'Modelo')),
  status              text NOT NULL DEFAULT 'Registrada'
    CHECK (status IN ('Registrada', 'En análisis', 'En ajuste', 'Ajustada', 'Validada', 'Cerrada')),
  revision            bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  finding_ref         text CHECK (finding_ref IS NULL OR finding_ref ~ '^[A-Za-z0-9._:-]{1,80}$'),
  -- El tipo de fallo (REAL) es condición para entrar a «En ajuste» y no se pierde después.
  CONSTRAINT improvement_failure_ck CHECK (status IN ('Registrada', 'En análisis') OR failure_type IS NOT NULL)
);
CREATE INDEX improvement_case_status_idx ON admin.improvement_case (status, created_at);
CREATE INDEX improvement_case_failure_idx ON admin.improvement_case (failure_type);

-- Historia append-only de cada cambio de estado (actor, fecha, nota, evidencias seguras).
CREATE TABLE admin.improvement_transition (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id          uuid NOT NULL REFERENCES admin.improvement_case (id),
  from_state       text NOT NULL,
  to_state         text NOT NULL,
  actor_account_id uuid NOT NULL,
  at               timestamptz NOT NULL DEFAULT now(),
  note             text,
  failure_type     text,
  evidence_refs    jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision_from    bigint NOT NULL,
  revision_to      bigint NOT NULL,
  CONSTRAINT transition_close_note_ck CHECK (to_state <> 'Cerrada' OR btrim(coalesce(note, '')) <> '')
);
CREATE INDEX improvement_transition_case_idx ON admin.improvement_transition (case_id, at);

CREATE FUNCTION admin.improvement_transition_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'La historia de casos es de solo anexado' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER improvement_transition_append_only BEFORE UPDATE OR DELETE ON admin.improvement_transition
  FOR EACH ROW EXECUTE FUNCTION admin.improvement_transition_append_only();

-- Crea o fusiona el caso de una interacción autorizada. DML local, sin red ni LLM.
CREATE FUNCTION admin.register_improvement_origin(p_row bigint, p_origin text, p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = admin, chat, pg_catalog AS $$
BEGIN
  INSERT INTO admin.improvement_case (interaction_row_id, origins, created_at)
  VALUES (p_row, ARRAY[p_origin], p_at)
  ON CONFLICT (interaction_row_id) DO UPDATE
    SET origins = (SELECT array_agg(DISTINCT o ORDER BY o) FROM unnest(admin.improvement_case.origins || EXCLUDED.origins) o),
        created_at = LEAST(admin.improvement_case.created_at, EXCLUDED.created_at),
        updated_at = now();
END $$;

CREATE FUNCTION admin.improvement_from_interaction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = admin, chat, pg_catalog AS $$
BEGIN
  IF NEW.result_type = 'sin información' AND NEW.purged_at IS NULL THEN
    PERFORM admin.register_improvement_origin(NEW.row_id, 'sin información', NEW.received_at);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER improvement_from_interaction AFTER INSERT ON chat.interaction
  FOR EACH ROW EXECUTE FUNCTION admin.improvement_from_interaction();

CREATE FUNCTION admin.improvement_from_rating() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = admin, chat, pg_catalog AS $$
BEGIN
  IF NEW.valoracion = 'No útil' THEN
    PERFORM admin.register_improvement_origin(NEW.interaction_row_id, 'No útil', NEW.created_at);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER improvement_from_rating AFTER INSERT ON chat.valoracion
  FOR EACH ROW EXECUTE FUNCTION admin.improvement_from_rating();

-- Respaldo idempotente de lo ya registrado: conserva las fechas reales y no reconstruye lo depurado.
INSERT INTO admin.improvement_case (interaction_row_id, origins, created_at)
SELECT i.row_id,
       ARRAY(SELECT o FROM unnest(ARRAY[
              CASE WHEN i.result_type = 'sin información' THEN 'sin información' END,
              CASE WHEN v.valoracion = 'No útil' THEN 'No útil' END]) o WHERE o IS NOT NULL ORDER BY o),
       LEAST(CASE WHEN i.result_type = 'sin información' THEN i.received_at END,
             CASE WHEN v.valoracion = 'No útil' THEN v.created_at END)
  FROM chat.interaction i LEFT JOIN chat.valoracion v ON v.interaction_row_id = i.row_id
 WHERE i.purged_at IS NULL AND (i.result_type = 'sin información' OR v.valoracion = 'No útil')
ON CONFLICT (interaction_row_id) DO NOTHING;

-- Permisos: el panel lee y cambia solo estado/tipo/revisión/enlace; la historia solo se anexa.
GRANT SELECT ON admin.improvement_case, admin.improvement_transition TO admin_app;
GRANT UPDATE (status, failure_type, revision, updated_at, finding_ref) ON admin.improvement_case TO admin_app;
GRANT INSERT ON admin.improvement_transition TO admin_app;
GRANT USAGE ON SEQUENCE admin.improvement_transition_id_seq TO admin_app;
REVOKE ALL ON FUNCTION admin.register_improvement_origin(bigint, text, timestamptz) FROM PUBLIC;
