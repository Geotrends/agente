-- Bloque 2 · calibración del umbral de relevancia por colección (RF-C3-DI-05, contracts/retrieval.md).
-- Una fila por colección candidata: el umbral viaja con el corpus que lo originó, de modo que
-- cada lectura resuelve colección + calibración compatible, sin ventana de corpus nuevo con
-- umbral viejo. El alias solo se mueve DESPUÉS de guardar la calibración de la candidata.

CREATE TABLE kb.kb_calibracion (
  coleccion          text PRIMARY KEY,
  creada_en          timestamptz NOT NULL DEFAULT now(),
  umbral             double precision NOT NULL CHECK (umbral = umbral AND umbral NOT IN ('Infinity', '-Infinity')),
  embedding_version  text NOT NULL,
  reranker_version   text NOT NULL,
  politica_version   text NOT NULL,
  corpus_hash        text NOT NULL,
  oro_hash           text NOT NULL,
  reporte            jsonb NOT NULL
);

GRANT SELECT ON kb.kb_calibracion TO app_reader;
