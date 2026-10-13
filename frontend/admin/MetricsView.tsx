"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Campo } from "./AdminForm";
import { llamar, mensajeError } from "./adminClient";

/**
 * Contenedor de un tablero: rango de fechas común (ambas o ninguna → últimos 30 días), estados de
 * carga/error honestos («no disponible», nunca un cero inventado) y render de la tabla equivalente.
 */
export default function MetricsView<T extends { rango: { from: string; to: string } }>({ titulo, ruta, children }: {
  titulo: string; ruta: string; children: (datos: T) => ReactNode;
}) {
  const [rango, setRango] = useState<{ from: string; to: string } | null>(null);
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    const q = rango ? `?from=${rango.from}&to=${rango.to}` : "";
    const r = await llamar<T>("GET", `/metrics/${ruta}${q}`);
    if (r.ok) setDatos(r.data);
    else { setDatos(null); setError(r.error.campo ? r.error.mensaje : `Información no disponible. ${mensajeError(r.error, r.status)}`); }
  }, [rango, ruta]);
  useEffect(() => { void cargar(); }, [cargar]);

  function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const from = String(d.get("from") ?? ""); const to = String(d.get("to") ?? "");
    setRango(from || to ? { from, to } : null);
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1>{titulo}</h1>
      <form className="admin-filtros" onSubmit={aplicar} aria-label="Rango de fechas">
        <Campo id="m-from" etiqueta="Desde">{p => <input {...p} name="from" type="date" className="input" />}</Campo>
        <Campo id="m-to" etiqueta="Hasta">{p => <input {...p} name="to" type="date" className="input" />}</Campo>
        <button type="submit" className="button">Aplicar rango</button>
      </form>
      <p>Por defecto se muestran los últimos 30 días, incluido hoy.</p>
      {error && <p role="alert" className="admin-error">{error}</p>}
      {datos && (
        <>
          <p role="status">Rango: {datos.rango.from} a {datos.rango.to}.</p>
          {children(datos)}
        </>
      )}
    </main>
  );
}
