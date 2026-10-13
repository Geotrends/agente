-- Un elemento se procesa una sola vez por corrida (FR-012, FR-013, SC-006).
-- Antes, procesar dos veces el mismo informe duplicaba las filas y desbalanceaba
-- "cargados + descartados = total del lote".
ALTER TABLE kb.kb_procesamiento ADD COLUMN corrida_id uuid REFERENCES kb.kb_corrida (id) ON DELETE SET NULL;

-- Las filas anteriores no tienen corrida: solo se quitan los duplicados exactos que dejó
-- el doble procesamiento (mismo documento, misma decisión, mismo instante de minuto).
DELETE FROM kb.kb_procesamiento a
 USING kb.kb_procesamiento b
 WHERE a.clave_elemento = b.clave_elemento
   AND a.decision = b.decision
   AND a.caracteres_nativos = b.caracteres_nativos
   AND a.confianza_ocr IS NOT DISTINCT FROM b.confianza_ocr
   AND date_trunc('hour', a.fecha) = date_trunc('hour', b.fecha)
   AND a.id > b.id
   AND NOT EXISTS (SELECT 1 FROM kb.kb_version v WHERE v.procesamiento_id = a.id);

-- NULL es distinto de NULL: las filas sin corrida no chocan entre sí.
CREATE UNIQUE INDEX kb_procesamiento_corrida_clave ON kb.kb_procesamiento (corrida_id, clave_elemento);
