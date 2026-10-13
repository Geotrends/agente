"use client";
import { useChat } from "./ChatContext";
import { BUSCANDO } from "./texts";

/**
 * Región `status` estable: siempre en el DOM para que el lector la anuncie sin mover el foco.
 * Con `prefers-reduced-motion` la animación se retira pero el texto se conserva (CSS).
 */
export function QueryStatus() {
  const { session } = useChat();
  const busy = session.activeAttempt?.phase === "enviando";
  return (
    <div role="status" aria-live="polite" className="query-status">
      {busy && (
        <>
          <span className="dot-animation" aria-hidden="true"><span className="dot" /><span className="dot" /><span className="dot" /></span>
          <span>{BUSCANDO}</span>
        </>
      )}
    </div>
  );
}
