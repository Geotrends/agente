-- SPEC007 · contactos oficiales (RF-C3-AD-35..37): la lista inmediata nunca queda vacía ni siquiera
-- ante dos bajas simultáneas, y la descripción de un canal es obligatoria. No altera 001–009.

CREATE OR REPLACE FUNCTION admin.contact_immediate_keep_one() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, admin AS $$
BEGIN
  -- El candado serializa bajas concurrentes: la segunda ve la lista ya reducida por la primera.
  PERFORM pg_advisory_xact_lock(hashtext('admin.contact_immediate'));
  IF (SELECT count(*) FROM admin.contact_immediate) <= 1 THEN
    RAISE EXCEPTION 'La lista de canales inmediatos no puede quedar vacía' USING ERRCODE = 'check_violation', TABLE = 'contact_immediate';
  END IF;
  RETURN OLD;
END $$;

-- Descripción obligatoria: NOT VALID conserva filas históricas pero rige para altas y ediciones.
ALTER TABLE admin.contact_immediate
  ADD CONSTRAINT contact_immediate_description_ck CHECK (btrim(description) <> '') NOT VALID;
