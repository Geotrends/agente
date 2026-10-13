-- SPEC005 · eventos operativos de indisponibilidad (RF-C3-IN-04) y privilegios mínimos de la purga
-- (RNF-C3-IN-01). No altera migraciones aplicadas 001–007.
--
-- `admin.service_event` guarda UN evento técnico mínimo por indisponibilidad (modelos, búsqueda,
-- plazo): cuándo ocurrió, qué código y componente, y el modo si ya estaba validado. Sin texto de
-- consulta, categoría, identificadores públicos, IP, token, hash ni métricas de consumo. No
-- reconstruye ninguna consulta anónima: no tiene vínculo con `chat.*`.

CREATE TABLE admin.service_event (
  event_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  code        text NOT NULL CHECK (code IN ('SERVICIO_NO_DISPONIBLE')),
  component   text NOT NULL CHECK (component IN ('modelos', 'busqueda', 'plazo')),
  mode        text CHECK (mode IN ('conversación', 'anónima'))
);
CREATE INDEX service_event_occurred_idx ON admin.service_event (occurred_at DESC);

-- El runtime del panel solo inserta y lee eventos; nadie los edita ni los borra.
GRANT SELECT, INSERT ON admin.service_event TO admin_app;

-- La purga solo debe vaciar textos e identificadores públicos (RNF-C3-IN-01): los documentos
-- citados se conservan. La concesión original de 005 incluía `cited_documents`; se retira.
REVOKE UPDATE (cited_documents) ON chat.interaction FROM chat_maint;
