-- Bloque 2 · retención de 12 meses calendario + hasta 24 h (RNF-C3-IN-01, RF-C3-IN-05/07).

CREATE TABLE chat.purge_run (
  run_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  cutoff_at    timestamptz NOT NULL,
  rows_purged  integer NOT NULL DEFAULT 0 CHECK (rows_purged >= 0),
  status       text NOT NULL CHECK (status IN ('en_curso', 'ok', 'error'))
);

GRANT SELECT, INSERT, UPDATE ON chat.purge_run TO chat_maint;
GRANT SELECT ON chat.purge_run TO admin_app;
GRANT USAGE ON SEQUENCE chat.purge_run_run_id_seq TO chat_maint;
GRANT UPDATE (question_text, answer_text, conversation_id, response_id, cited_documents, purged_at)
  ON chat.interaction TO chat_maint;
GRANT DELETE ON chat.conversation TO chat_maint;
