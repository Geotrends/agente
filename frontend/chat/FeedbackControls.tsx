"use client";
import { useId, useState } from "react";
import { MOTIVOS, type Motivo } from "../shared/feedbackContracts";
import { useChat } from "./ChatContext";
import { isRatable } from "./feedbackState";
import { GRACIAS_VALORACION } from "./texts";
import type { VisibleMessage } from "./types";

/**
 * Valoración bajo una respuesta elegible (RF-C4-UI-06): «Útil» / «No útil» y, para «No útil», un
 * único motivo entre cinco, sin texto libre. No se renderiza nada (ni oculto enfocable) si la
 * respuesta no es elegible (anónimo, sin responseId, fallo).
 */
export function FeedbackControls({ message }: { message: VisibleMessage }) {
  const chat = useChat();
  const { session } = chat;
  const groupId = useId();
  const [motivo, setMotivo] = useState<Motivo | "">("");
  if (!isRatable(session, message) || !message.responseId) return null;
  const id = message.responseId;
  const fb = session.feedbackByResponse[id];
  const phase = fb?.phase ?? "idle";

  if (phase === "confirmed") {
    return <p role="status" className="feedback-thanks">{GRACIAS_VALORACION}</p>;
  }
  const busy = phase === "sending";
  const failed = phase === "failed";
  const locked = fb?.selected; // tras enviar o fallar, la selección ya no cambia (unicidad)
  const showReasons = phase === "choosing" || (locked === "No útil" && (busy || failed));
  const reason = (fb?.reason ?? motivo) as Motivo | "";

  return (
    <div className="feedback" role="group" aria-label="Valorar esta respuesta">
      <span className="feedback-label">¿Le fue útil esta respuesta?</span>
      <button type="button" className="button"
        disabled={busy || failed}
        onClick={() => chat.rate(id, "Útil")}>Útil</button>
      <button type="button" className="button" aria-expanded={showReasons}
        disabled={busy || failed}
        onClick={() => { if (phase === "idle") chat.startRating(id); }}>No útil</button>

      {showReasons && (
        <fieldset className="feedback-reasons">
          <legend>¿Por qué no fue útil? Elija una opción</legend>
          {MOTIVOS.map(m => (
            <label key={m} className="feedback-reason">
              <input type="radio" name={`motivo-${groupId}`} value={m} checked={reason === m}
                disabled={busy || failed} onChange={() => setMotivo(m)} />
              {m}
            </label>
          ))}
          <button type="button" className="button" disabled={busy || !reason}
            onClick={() => { if (reason) chat.rate(id, "No útil", reason); }}>
            {failed ? "Reintentar valoración" : "Enviar valoración"}
          </button>
        </fieldset>
      )}

      {phase === "failed" && locked === "Útil" && (
        <button type="button" className="button" onClick={() => chat.rate(id, "Útil")}>Reintentar valoración</button>
      )}
      {phase === "failed" && (
        <p role="alert" className="feedback-error">No se pudo registrar su valoración. La respuesta sigue disponible; puede intentarlo de nuevo.</p>
      )}
    </div>
  );
}
