-- Bloque 2 · registro de consultas autorizadas, consumo anónimo y tarifas
-- (RF-C3-DI-16, RF-C3-IN-03/05/06/07, RNF-C3-IN-01).

-- Tarifas versionadas por modelo y región; sin periodos activos solapados.
CREATE TABLE chat.tariff (
  version                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id                 text NOT NULL CHECK (model_id IN ('openai.gpt-oss-20b-1:0', 'openai.gpt-oss-120b-1:0')),
  region                   text NOT NULL CHECK (btrim(region) <> ''),
  currency                 text NOT NULL CHECK (btrim(currency) <> ''),
  input_price_per_million  numeric(20,10) NOT NULL CHECK (input_price_per_million >= 0),
  output_price_per_million numeric(20,10) NOT NULL CHECK (output_price_per_million >= 0),
  valid_from               timestamptz NOT NULL,
  valid_to                 timestamptz,
  source_url               text NOT NULL CHECK (source_url ~ '^https://[^[:space:]]+$'),
  registered_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tariff_period_ck CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT tariff_no_overlap EXCLUDE USING gist (
    model_id WITH =, region WITH =, tstzrange(valid_from, valid_to) WITH &&)
);

-- Consulta autorizada: una fila por consulta. Tras la purga se vacían los textos y los
-- identificadores ciudadanos, y se conservan las estadísticas.
CREATE TABLE chat.interaction (
  row_id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id      uuid REFERENCES chat.conversation (conversation_id) ON DELETE SET NULL,
  response_id          uuid UNIQUE,
  received_at          timestamptz NOT NULL,
  mode                 text NOT NULL DEFAULT 'conversación' CHECK (mode = 'conversación'),
  category             text CHECK (category IN ('Ecosistemas', 'Bienestar Animal', 'Gestión Ambiental')),
  question_text        text,
  answer_text          text,
  result_type          text NOT NULL CHECK (result_type IN ('respondida', 'sin información', 'fuera de alcance', 'aclaración')),
  cited_documents      jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms          integer NOT NULL CHECK (duration_ms >= 0),
  visible_output_tokens integer NOT NULL CHECK (visible_output_tokens BETWEEN 0 AND 2200),
  model                text NOT NULL CHECK (model IN ('gpt-oss-20b', 'gpt-oss-120b', 'none')),
  input_tokens         integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens        integer NOT NULL CHECK (output_tokens >= 0),
  tariff_version       bigint REFERENCES chat.tariff (version),
  estimated_cost       numeric(24,12) CHECK (estimated_cost >= 0),
  purged_at            timestamptz,
  -- Ruta sin LLM: costo cero demostrable. Con LLM: costo y tarifa juntos, o ninguno (nunca un 0 inventado).
  CONSTRAINT interaction_cost_ck CHECK (
    (model = 'none' AND estimated_cost = 0 AND tariff_version IS NULL) OR
    (model <> 'none' AND tariff_version IS NOT NULL AND estimated_cost IS NOT NULL) OR
    (model <> 'none' AND tariff_version IS NULL AND estimated_cost IS NULL))
);
CREATE INDEX interaction_received_idx ON chat.interaction (received_at);
CREATE INDEX interaction_conversation_idx ON chat.interaction (conversation_id);

-- Consumo anónimo: solo estos seis campos. Sin clave de consulta, UUID, texto, hash, token,
-- IP, categoría, tipo de resultado, documentos, historial, duración ni valoración.
CREATE TABLE chat.anonymous_usage (
  received_at    timestamptz NOT NULL,
  mode           text NOT NULL DEFAULT 'anónima' CHECK (mode = 'anónima'),
  model          text NOT NULL CHECK (model IN ('gpt-oss-20b', 'gpt-oss-120b', 'none')),
  input_tokens   integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens  integer NOT NULL CHECK (output_tokens >= 0),
  estimated_cost numeric(24,12) CHECK (estimated_cost >= 0)
);
CREATE INDEX anonymous_usage_received_idx ON chat.anonymous_usage (received_at);

GRANT SELECT ON chat.tariff TO chat_app, chat_maint, admin_app;
GRANT INSERT ON chat.tariff TO admin_app;
GRANT INSERT ON chat.interaction, chat.anonymous_usage TO chat_app;
GRANT SELECT, UPDATE ON chat.interaction TO chat_maint;
GRANT SELECT ON chat.anonymous_usage TO chat_maint;
GRANT USAGE ON SEQUENCE chat.interaction_row_id_seq TO chat_app;
GRANT USAGE ON SEQUENCE chat.tariff_version_seq TO admin_app;
-- Las estadísticas las lee el panel (solo agregados, ver operaciones).
GRANT SELECT ON chat.interaction, chat.anonymous_usage TO admin_app;
