"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export type Pestana = { id: string; titulo: ReactNode; contenido: ReactNode };

/**
 * Pestañas con el patrón ARIA (tablist/tab/tabpanel): flechas, Inicio y Fin mueven el foco y
 * activan la pestaña. Los paneles inactivos se ocultan pero siguen montados, así un formulario a
 * medio llenar no se pierde al cambiar de sección. Quien la usa refleja la pestaña en el hash
 * (`fijarHash`) para que una recarga vuelva a la misma sección.
 */
export default function AdminTabs({ etiqueta, pestanas, activa, onCambiar }: {
  etiqueta: string; pestanas: Pestana[]; activa: string; onCambiar: (id: string) => void;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const actual = pestanas.some(p => p.id === activa) ? activa : pestanas[0]?.id;

  function teclado(e: KeyboardEvent<HTMLDivElement>) {
    const i = pestanas.findIndex(p => p.id === actual);
    const destino = e.key === "ArrowRight" ? (i + 1) % pestanas.length
      : e.key === "ArrowLeft" ? (i - 1 + pestanas.length) % pestanas.length
      : e.key === "Home" ? 0 : e.key === "End" ? pestanas.length - 1 : -1;
    if (destino < 0) return;
    e.preventDefault();
    const id = pestanas[destino].id;
    onCambiar(id);
    refs.current[id]?.focus();
  }

  return <div className="admin-pestanas">
    <div role="tablist" aria-label={etiqueta} className="admin-pestanas-lista" onKeyDown={teclado}>
      {pestanas.map(p => <button key={p.id} ref={el => { refs.current[p.id] = el; }} type="button" role="tab" id={`${base}-tab-${p.id}`}
        aria-selected={p.id === actual} aria-controls={`${base}-panel-${p.id}`} tabIndex={p.id === actual ? 0 : -1}
        className="admin-pestana" onClick={() => onCambiar(p.id)}>{p.titulo}</button>)}
    </div>
    {pestanas.map(p => <div key={p.id} role="tabpanel" id={`${base}-panel-${p.id}`} aria-labelledby={`${base}-tab-${p.id}`}
      hidden={p.id !== actual} tabIndex={0} className="admin-pestanas-panel">{p.contenido}</div>)}
  </div>;
}

/** Refleja la pestaña en la URL sin agregar una entrada al historial. */
export function fijarHash(id: string) {
  if (window.location.hash !== `#${id}`) history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
}

/** Pestaña inicial: la del hash si existe entre las válidas; si no, la primera. */
export function pestanaDelHash(validas: readonly string[]): string {
  const h = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
  return validas.includes(h) ? h : validas[0];
}
