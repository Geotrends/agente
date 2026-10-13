-- Estado de procesamiento de la corrida: distingue "en proceso" de "procesada".
-- Antes la fila se insertaba al empezar y una corrida a medias parecía terminada.
-- Las filas existentes ya terminaron: quedan como 'procesada'.
ALTER TABLE kb.kb_corrida
  ADD COLUMN estado    text NOT NULL DEFAULT 'procesada' CHECK (estado IN ('en_proceso', 'procesada')),
  ADD COLUMN latido_en timestamptz NOT NULL DEFAULT now();
