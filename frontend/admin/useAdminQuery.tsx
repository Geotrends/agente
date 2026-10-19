"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { llamar, mensajeError } from "./adminClient";

type PageLike = { items: unknown[]; total: number; nextCursor: string | null };
const isPage = (value: unknown): value is PageLike => !!value && typeof value === "object" && "items" in value && Array.isArray(value.items) && "nextCursor" in value;

/** A query owns its responses: obsolete requests never overwrite a newer filter. */
export function useAdminQuery<T>(path: string) {
  const [state, setState] = useState<{ path: string; data: T | null; error: string; busy: boolean; announcement: string }>({ path, data: null, error: "", busy: true, announcement: "" });
  const active = useRef<{ path: string; controller: AbortController } | null>(null);
  const currentPath = useRef(path);
  currentPath.current = path;

  const cargar = useCallback(async (cursor?: string) => {
    if (cursor && active.current?.path === path) return;
    active.current?.controller.abort();
    const request = { path, controller: new AbortController() };
    active.current = request;
    setState(prev => ({ ...prev, path, data: prev.path === path ? prev.data : null, error: "", busy: true }));
    const url = cursor ? `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : path;
    const focused = document.activeElement;
    const r = await llamar<T>("GET", url, undefined, { signal: request.controller.signal });
    if (request.controller.signal.aborted || active.current !== request || currentPath.current !== path) return;
    active.current = null;
    if (!r.ok) {
      if (r.status === 401) window.dispatchEvent(new Event("admin-session-expired"));
      setState(prev => ({ ...prev, busy: false, error: mensajeError(r.error, r.status) }));
      return;
    }
    setState(prev => {
      let data = r.data;
      if (cursor && isPage(prev.data) && isPage(data)) {
        const merged = [...prev.data.items, ...data.items];
        const seen = new Set<string>();
        const items = merged.filter(item => {
          if (!item || typeof item !== "object" || !("id" in item)) return true;
          const key = String(item.id);
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
        data = { ...data, items };
      }
      const announcement = isPage(data) ? `${cursor ? "Registros añadidos. " : ""}Mostrando ${data.items.length} de ${data.total} registros.` : "Datos actualizados.";
      return { path, data, error: "", busy: false, announcement };
    });
    requestAnimationFrame(() => { if (focused && !focused.isConnected) document.querySelector<HTMLElement>(".admin-tabla-contenedor, main h1")?.focus(); });
  }, [path]);

  useEffect(() => {
    void cargar();
    return () => { active.current?.controller.abort(); active.current = null; };
  }, [cargar]);

  const current = state.path === path;
  return { data: current ? state.data : null, error: current ? state.error : "", busy: !current || state.busy, announcement: current ? state.announcement : "", cargar };
}

export function QueryState({ busy, error, announcement = "", retry }: { busy: boolean; error: string; announcement?: string; retry: () => unknown }) {
  return <div className="admin-query-state">
    <p role="status" aria-atomic="true">{busy ? "Actualizando datos…" : announcement}</p>
    {error && <><p role="alert" className="admin-error">{error}</p><button className="button button-secondary" type="button" onClick={() => { void retry(); }}>Reintentar</button></>}
  </div>;
}

export function useDebounced(value: string, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return settled;
}
