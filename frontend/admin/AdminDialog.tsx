"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Diálogo modal accesible (confirmaciones de retiro, rechazo, desactivación…). Usa `<dialog>`:
 * el navegador atrapa el foco, Escape cancela y al cerrar el foco vuelve al disparador. Cancelar
 * nunca produce una mutación.
 */
export default function AdminDialog({ abierto, titulo, onCancelar, children }: {
  abierto: boolean; titulo: string; onCancelar: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      previo.current = document.activeElement;
      if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
      d.querySelector<HTMLElement>("h2")?.focus();
    } else if (!abierto && d.open) {
      if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
      if (previo.current?.isConnected) (previo.current as HTMLElement).focus?.();
      else document.querySelector<HTMLElement>("main h1")?.focus();
    }
  }, [abierto]);

  return (
    <dialog ref={ref} className="admin-dialogo" aria-labelledby={tituloId} onCancel={e => { e.preventDefault(); onCancelar(); }}>
      <h2 tabIndex={-1} id={tituloId}>{titulo}</h2>
      {children}
    </dialog>
  );
}
