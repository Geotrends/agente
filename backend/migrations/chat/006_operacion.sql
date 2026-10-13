-- Bloque 2 · estado operativo y avisos del panel (RF-C3-AD-28/29/30/48, RF-C3-DI-06).

CREATE TABLE admin.component_status (
  component         text PRIMARY KEY CHECK (component IN ('gpt-oss-20b', 'gpt-oss-120b', 'reranker', 'registro', 'scraper')),
  status            text NOT NULL CHECK (status IN ('normal', 'degradado', 'no comprobado')),
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Solo el reranker informa si el umbral de relevancia se aplicó.
  threshold_applied boolean,
  safe_reason       text
);

CREATE TABLE admin.notification (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL,
  object_type      text NOT NULL CHECK (object_type IN ('componente', 'cuenta', 'documento')),
  object_id        text NOT NULL,
  safe_description text NOT NULL,
  state            text NOT NULL DEFAULT 'no_revisada' CHECK (state IN ('no_revisada', 'revisada')),
  first_at         timestamptz NOT NULL,
  last_at          timestamptz NOT NULL,
  repetitions      integer NOT NULL DEFAULT 1 CHECK (repetitions >= 1),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  CONSTRAINT notification_reviewed_ck CHECK ((state = 'revisada') = (reviewed_at IS NOT NULL))
);
-- Una sola no revisada por tipo y objeto; revisar conserva la fila y la siguiente ocurrencia abre otra.
CREATE UNIQUE INDEX notification_grouped ON admin.notification (type, object_type, object_id) WHERE state = 'no_revisada';
CREATE INDEX notification_last_idx ON admin.notification (last_at DESC);

GRANT SELECT, INSERT ON admin.component_status TO admin_app;
GRANT UPDATE ON admin.component_status TO admin_app;
GRANT SELECT, INSERT ON admin.notification TO admin_app;
GRANT UPDATE (state, last_at, repetitions, reviewed_by, reviewed_at, safe_description) ON admin.notification TO admin_app;
