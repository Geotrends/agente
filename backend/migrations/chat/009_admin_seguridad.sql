-- SPEC007 · acceso, cuentas, auditoría y avisos propios (RF-C3-AD-05..13, 28..31, 41; RNF-C3-AD-01..06).
-- No altera migraciones aplicadas 001–008. Se ejecuta como chat_owner.

-- Revisión optimista de cuenta (CAS en altas/cambios de perfil/actividad).
ALTER TABLE admin.account ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1);
GRANT UPDATE (revision) ON admin.account TO admin_app;

-- Bloqueo por IP (RNF-C3-AD-06): solo el HMAC de la IP, nunca la dirección ni vínculo con registros de consulta.
CREATE TABLE admin.login_ip_guard (
  ip_key         text PRIMARY KEY CHECK (ip_key ~ '^[0-9a-f]{64}$'),
  failures       timestamptz[] NOT NULL DEFAULT '{}',
  blocked_until  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.login_ip_guard TO admin_app;

-- Auditoría: actor cuenta O rol real de base de datos (recuperación fuera del panel, RF-C3-AD-41).
ALTER TABLE admin.audit ADD COLUMN actor_db_role text;
CREATE INDEX audit_time_idx ON admin.audit (occurred_at DESC, id DESC);
CREATE INDEX audit_actor_idx ON admin.audit (actor_account_id, occurred_at DESC);
CREATE INDEX audit_action_idx ON admin.audit (action, occurred_at DESC);

-- Avisos: alcance, propietario verificado, objeto documental y revisión (RF-C3-AD-28..31).
ALTER TABLE admin.notification
  ADD COLUMN scope             text   NOT NULL DEFAULT 'sistema' CHECK (scope IN ('sistema', 'carga')),
  ADD COLUMN owner_account_id  uuid   REFERENCES admin.account (id),
  ADD COLUMN document_identity text,
  ADD COLUMN revision          bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD COLUMN owner_key         uuid GENERATED ALWAYS AS (COALESCE(owner_account_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  ADD CONSTRAINT notification_owner_ck CHECK (scope = 'sistema' OR owner_account_id IS NOT NULL);
DROP INDEX admin.notification_grouped;
CREATE UNIQUE INDEX notification_grouped ON admin.notification (type, object_type, object_id, scope, owner_key) WHERE state = 'no_revisada';
CREATE INDEX notification_scope_idx ON admin.notification (scope, owner_account_id, state, last_at DESC);
GRANT UPDATE (revision) ON admin.notification TO admin_app;

-- Recuperación reservada (RF-C3-AD-12/13): procedimiento de exactamente dos parámetros, solo para el
-- rol operativo reservado. No activa cuentas desactivadas ni cambia perfiles; revoca sesiones y audita.
CREATE PROCEDURE admin.recover_password(p_email text, p_temporary_phc text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, admin AS $$
DECLARE v_id uuid;
BEGIN
  IF p_temporary_phc IS NULL OR p_temporary_phc NOT LIKE '$argon2id$%' THEN
    RAISE EXCEPTION 'credencial_temporal_no_valida' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE admin.account
     SET password_phc = p_temporary_phc, must_change_password = true, failed_attempts = 0,
         locked_until = NULL, revision = revision + 1, updated_at = now()
   WHERE email = lower(btrim(p_email))
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'cuenta_inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE admin.session SET revoked_at = now() WHERE account_id = v_id AND revoked_at IS NULL;
  INSERT INTO admin.audit (actor_db_role, action, object_type, object_id, result)
  VALUES (session_user, 'cuenta.recuperacion', 'cuenta', v_id::text, 'ok');
END $$;

-- Auditoría del intento fallido, ya fuera de la transacción revertida (el wrapper la invoca tras el error).
CREATE PROCEDURE admin.record_recovery_failure(p_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, admin AS $$
BEGIN
  INSERT INTO admin.audit (actor_db_role, action, object_type, object_id, result)
  VALUES (session_user, 'cuenta.recuperacion', 'cuenta',
          nullif(left(regexp_replace(coalesce(p_reason, ''), '[^a-z_]', '', 'g'), 40), ''), 'error');
END $$;

REVOKE ALL ON PROCEDURE admin.recover_password(text, text) FROM PUBLIC;
REVOKE ALL ON PROCEDURE admin.record_recovery_failure(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA admin TO contractor_recovery;
GRANT EXECUTE ON PROCEDURE admin.recover_password(text, text) TO contractor_recovery;
GRANT EXECUTE ON PROCEDURE admin.record_recovery_failure(text) TO contractor_recovery;
