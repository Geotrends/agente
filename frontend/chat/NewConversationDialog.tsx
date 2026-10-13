"use client";
import { useEffect, useRef } from "react";
import { NUEVA_CONVERSACION_PREGUNTA } from "./texts";

/**
 * Confirmación de nueva conversación (RF-C4-UI-05): diálogo modal DENTRO del iframe. Foco inicial en
 * «Cancelar», Tab contenido en el diálogo y Escape cancela. No detiene el reloj de 45 s ni pierde una
 * respuesta que llegue mientras se decide: el estado de la conversación sigue vivo debajo.
 */
export function NewConversationDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { cancelRef.current?.focus(); }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // el nivel superior (ocultar panel) no debe verlo
      onCancel();
    } else if (e.key === "Tab") {
      // Foco contenido entre los dos botones.
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  return (
    <div className="dialog-backdrop" onKeyDown={onKeyDown}>
      <div role="dialog" aria-modal="true" aria-labelledby="nueva-conv-titulo" className="dialog">
        <p id="nueva-conv-titulo">{NUEVA_CONVERSACION_PREGUNTA}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="button" onClick={onCancel}>Cancelar</button>
          <button ref={confirmRef} type="button" className="button" onClick={onConfirm}>Iniciar nueva</button>
        </div>
      </div>
    </div>
  );
}
