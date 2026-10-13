-- SPEC004 · valoración de respuestas (RF-C3-IN-09, RF-C4-UI-06, RNF-C3-IN-01).
-- Una valoración por interacción autorizada. Sin texto libre, sin IP, sin token ni identificadores
-- públicos duplicados: solo la fila interna de la interacción, la selección y el motivo cerrado.

CREATE TABLE chat.valoracion (
  interaction_row_id bigint NOT NULL REFERENCES chat.interaction (row_id),
  valoracion         text   NOT NULL CHECK (valoracion IN ('Útil', 'No útil')),
  motivo             text   CHECK (motivo IN (
                       'Información incorrecta', 'Información desactualizada',
                       'No responde mi pregunta', 'Difícil de entender', 'Otro')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Una sola valoración por interacción: la unicidad la impone PostgreSQL, no la interfaz.
  CONSTRAINT valoracion_unica UNIQUE (interaction_row_id),
  -- «Útil» → sin motivo; «No útil» → exactamente uno de los cinco.
  CONSTRAINT valoracion_motivo_ck CHECK (
    (valoracion = 'Útil' AND motivo IS NULL) OR (valoracion = 'No útil' AND motivo IS NOT NULL))
);

-- El runtime no lee interacciones ni escribe valoraciones directamente: registra mediante esta
-- función, que resuelve propiedad y vigencia y escribe en una sola transacción. `FOR SHARE` hace
-- que la purga (UPDATE de la fila) espere a la valoración o que la valoración vea la fila depurada.
CREATE FUNCTION chat.register_rating(
  p_response_id uuid, p_binding_hash text, p_valoracion text, p_motivo text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = chat, pg_temp AS $$
DECLARE
  v_row bigint;
BEGIN
  SELECT i.row_id INTO v_row
    FROM chat.interaction i
    JOIN chat.conversation c ON c.conversation_id = i.conversation_id
   WHERE i.response_id = p_response_id
     AND i.purged_at IS NULL
     AND c.transport_binding_hash = p_binding_hash
   FOR SHARE OF i;
  -- Inexistente, ajena, depurada o anónima: indistinguibles para el ciudadano.
  IF v_row IS NULL THEN RETURN false; END IF;
  BEGIN
    INSERT INTO chat.valoracion (interaction_row_id, valoracion, motivo) VALUES (v_row, p_valoracion, p_motivo);
  EXCEPTION WHEN unique_violation OR check_violation THEN
    RETURN false;
  END;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION chat.register_rating(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat.register_rating(uuid, text, text, text) TO chat_app;
-- Estadística de lectura para el panel; nadie del runtime ciudadano modifica valoraciones.
GRANT SELECT ON chat.valoracion TO admin_app, chat_maint;
