"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Diálogo modal accesible (confirmaciones de retiro, rechazo, desactivación…). Usa `<dialog>`:
 * el navegador atrapa el foco, Escape cancela y al cerrar el foco vuelve al disparador. Cancelar
 * nunca produce una mutación.
 */
export default function AdminDialog({ abierto, titulo, onCancelar, children }: {
  abierto: boolean; titulo: string; onCancelar: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      previo.current = document.activeElement;
      if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    } else if (!abierto && d.open) {
      d.close();
      (previo.current as HTMLElement | null)?.focus?.();
    }
  }, [abierto]);

  return (
    <dialog ref={ref} className="admin-dialogo" aria-labelledby="dialogo-titulo" onCancel={e => { e.preventDefault(); onCancelar(); }}>
      <h2 id="dialogo-titulo">{titulo}</h2>
      {children}
    </dialog>
  );
}
