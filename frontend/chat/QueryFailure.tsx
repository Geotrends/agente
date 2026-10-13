"use client";
import { useEffect, useState } from "react";
import { useChat } from "./ChatContext";
import { Reception } from "./ContactChannels";
import { failureMessage } from "../shared/chatErrors";

/**
 * Fallo de consulta: mensaje fijo + canales de recepción del snapshot + «Reintentar» (solo si es
 * recuperable y quedan reintentos). Jamás muestra códigos, campos ni mensajes internos.
 */
export function QueryFailure() {
  const { session, contacts, retry, ensureContacts } = useChat();
  const at = session.activeAttempt;
  const [waiting, setWaiting] = useState(0);
  const retryAfter = at?.failure?.retryAfterSeconds;

  useEffect(() => {
    if (!retryAfter) { setWaiting(0); return; }
    setWaiting(retryAfter);
    const t = setInterval(() => setWaiting(w => (w <= 1 ? (clearInterval(t), 0) : w - 1)), 1000);
    return () => clearInterval(t);
  }, [retryAfter, at?.sequence, at?.retryCount]);

  if (!at || (at.phase !== "fallido" && at.phase !== "agotado")) return null;
  const canRetry = at.phase === "fallido" && at.failure?.retryable === true;

  return (
    <section className="query-failure" role="alert" aria-label="No fue posible responder">
      <p>{failureMessage(at.failure ? "fallo" : undefined)}</p>
      {session.sessionLost && <p>La conversación ya no está disponible. Use «Nueva conversación» para continuar.</p>}
      <Reception contacts={contacts} onRetry={ensureContacts} />
      {canRetry && (
        <button type="button" className="button" disabled={waiting > 0} onClick={retry}>
          Reintentar{waiting > 0 ? ` (en ${waiting} s)` : ""}
        </button>
      )}
    </section>
  );
}
