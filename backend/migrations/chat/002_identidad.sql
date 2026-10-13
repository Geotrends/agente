-- Bloque 2 · identidad, sesiones y auditoría del panel (RF-C3-AD-08/41, RNF-C3-AD-01/03/07).

CREATE TABLE admin.account (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  display_name          text NOT NULL CHECK (btrim(display_name) <> ''),
  profile               text NOT NULL CHECK (profile IN ('administrador técnico', 'Gestor documental')),
  active                boolean NOT NULL DEFAULT true,
  password_phc          text NOT NULL CHECK (password_phc LIKE '$argon2id$%'),
  must_change_password  boolean NOT NULL DEFAULT true,
  failed_attempts       integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_email_uq UNIQUE (email)
);

-- Solo el hash del secreto de sesión; el token opaco vive en la cookie.
CREATE TABLE admin.session (
  token_hash       text PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES admin.account (id),
  csrf_token_hash  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_request_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz
);
CREATE INDEX session_account_idx ON admin.session (account_id);

-- Auditoría append-only: ni el runtime ni el propietario pueden modificarla.
CREATE TABLE admin.audit (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_account_id  uuid,
  action            text NOT NULL,
  object_type       text NOT NULL,
  object_id         text,
  result            text NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION admin.audit_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría es de solo anexado' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON admin.audit
  FOR EACH ROW EXECUTE FUNCTION admin.audit_append_only();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON admin.audit
  FOR EACH STATEMENT EXECUTE FUNCTION admin.audit_append_only();

-- Invariante: siempre queda al menos un administrador técnico activo, también
-- ante dos operaciones concurrentes (el candado serializa la comprobación).
CREATE FUNCTION admin.keep_one_active_technical() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, admin AS $$
DECLARE restantes integer;
BEGIN
  IF OLD.profile <> 'administrador técnico' OR NOT OLD.active THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.profile = OLD.profile AND NEW.active THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('admin.keep_one_active_technical'));
  SELECT count(*) INTO restantes FROM admin.account
    WHERE profile = 'administrador técnico' AND active AND id <> OLD.id;
  IF restantes = 0 THEN
    RAISE EXCEPTION 'Debe quedar al menos un administrador técnico activo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER account_keep_one_technical BEFORE UPDATE OR DELETE ON admin.account
  FOR EACH ROW EXECUTE FUNCTION admin.keep_one_active_technical();

-- Permisos del panel: sin DELETE de cuentas ni UPDATE/DELETE de auditoría.
GRANT SELECT, INSERT ON admin.account TO admin_app;
GRANT UPDATE (display_name, profile, active, password_phc, must_change_password,
              failed_attempts, locked_until, updated_at) ON admin.account TO admin_app;
GRANT SELECT, INSERT, UPDATE ON admin.session TO admin_app;
GRANT DELETE ON admin.session TO admin_app;
GRANT SELECT, INSERT ON admin.audit TO admin_app;
GRANT USAGE ON SEQUENCE admin.audit_id_seq TO admin_app;
-- chat_app no toca identidad.
