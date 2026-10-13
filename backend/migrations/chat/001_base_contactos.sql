-- Bloque 2 · registro de contactos oficiales (RF-C3-AD-35/36/37, RF-C3-DI-19/20/24).
-- Se ejecuta como `chat_owner` (SET LOCAL ROLE lo hace el migrador). No contiene valores
-- oficiales: la operación los carga desde el panel; mientras falten, la readiness queda bloqueada.

-- Singleton con la revisión global del registro. CAS: toda mutación exige la revisión vigente.
CREATE TABLE admin.contact_meta (
  id          smallint PRIMARY KEY CHECK (id = 1),
  revision    bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
INSERT INTO admin.contact_meta (id) VALUES (1);

-- Recepción: tres canales obligatorios, no nulos/vacíos ni eliminables.
CREATE TABLE admin.contact_reception (
  id         smallint PRIMARY KEY CHECK (id = 1),
  pqrsd_url  text NOT NULL CHECK (pqrsd_url ~ '^https://[^[:space:]]+$'),
  whatsapp   text NOT NULL CHECK (whatsapp ~ '^[0-9 +()-]*[0-9][0-9 +()-]*$'),
  email      text NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- Contacto general: tres datos obligatorios.
CREATE TABLE admin.contact_general (
  id           smallint PRIMARY KEY CHECK (id = 1),
  phone        text NOT NULL CHECK (phone ~ '^[0-9 +()-]*[0-9][0-9 +()-]*$'),
  email        text NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  contact_url  text NOT NULL CHECK (contact_url ~ '^https://[^[:space:]]+$')
);

-- Canales de atención inmediata: lista ordenada, nunca vacía una vez cargada.
CREATE TABLE admin.contact_immediate (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (btrim(name) <> ''),
  description  text NOT NULL CHECK (char_length(description) <= 120),
  type         text NOT NULL CHECK (type IN ('teléfono', 'correo', 'url')),
  value        text NOT NULL,
  position     integer NOT NULL CHECK (position >= 1),
  CONSTRAINT contact_immediate_position_uq UNIQUE (position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT contact_immediate_value_ck CHECK (
    (type = 'teléfono' AND value ~ '^[0-9 +()-]*[0-9][0-9 +()-]*$') OR
    (type = 'correo'   AND value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') OR
    (type = 'url'      AND value ~ '^https://[^[:space:]]+$'))
);

-- La lista no puede quedar vacía por borrado (la carga inicial sí parte de vacío).
CREATE FUNCTION admin.contact_immediate_keep_one() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, admin AS $$
BEGIN
  IF (SELECT count(*) FROM admin.contact_immediate) <= 1 THEN
    RAISE EXCEPTION 'La lista de canales inmediatos no puede quedar vacía' USING ERRCODE = 'check_violation', TABLE = 'contact_immediate';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER contact_immediate_keep_one BEFORE DELETE ON admin.contact_immediate
  FOR EACH ROW EXECUTE FUNCTION admin.contact_immediate_keep_one();

-- Permisos: el panel edita; el chat solo lee.
GRANT USAGE ON SCHEMA admin TO chat_app, admin_app;
GRANT SELECT ON admin.contact_meta, admin.contact_reception, admin.contact_general, admin.contact_immediate
  TO chat_app, admin_app;
GRANT INSERT, UPDATE ON admin.contact_reception, admin.contact_general TO admin_app;
GRANT UPDATE ON admin.contact_meta TO admin_app;
GRANT INSERT, UPDATE, DELETE ON admin.contact_immediate TO admin_app;
