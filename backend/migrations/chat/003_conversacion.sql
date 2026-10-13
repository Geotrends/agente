-- Bloque 2 · conversaciones autorizadas (RF-C3-IN-01/02/07, RF-C3-DI-21, RF-C4-DC-02).
-- Solo existe una fila cuando la persona eligió «Autorizo». Nunca se crea para anónimas ni
-- guarda texto, historial ni preguntas: la aclaración pendiente es apenas un booleano.

CREATE TABLE chat.conversation (
  conversation_id         uuid PRIMARY KEY,
  created_at              timestamptz NOT NULL DEFAULT now(),
  authorized_at           timestamptz NOT NULL,
  policy_version          text NOT NULL CHECK (btrim(policy_version) <> ''),
  -- Hash de la credencial técnica que autoriza usar esta conversación; nunca se expone.
  transport_binding_hash  text NOT NULL,
  clarification_pending   boolean NOT NULL DEFAULT false,
  last_active_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_last_active_idx ON chat.conversation (last_active_at);

GRANT USAGE ON SCHEMA chat TO chat_app, chat_maint, admin_app;
GRANT SELECT, INSERT ON chat.conversation TO chat_app;
GRANT UPDATE (clarification_pending, last_active_at) ON chat.conversation TO chat_app;
-- La purga elimina conversaciones sin registros vigentes (T068).
GRANT SELECT, DELETE ON chat.conversation TO chat_maint;
