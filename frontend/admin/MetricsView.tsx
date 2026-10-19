"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useAdminQuery, QueryState } from "./useAdminQuery";
import { fecha } from "./format";
import { Campo } from "./AdminForm";

/**
 * Contenedor de un tablero: rango de fechas común (ambas o ninguna → últimos 30 días), estados de
 * carga/error honestos («no disponible», nunca un cero inventado) y render de la tabla equivalente.
 */
export default function MetricsView<T extends { rango: { from: string; to: string } }>({ titulo, ruta, children }: {
  titulo: string; ruta: string; children: (datos: T) => ReactNode;
}) {
  const [rango, setRango] = useState<{ from: string; to: string } | null>(null);

  const [error, setError] = useState("");

  const { data: datos, busy, error: consultaError, announcement, cargar } = useAdminQuery<T>(`/metrics/${ruta}${rango ? `?from=${rango.from}&to=${rango.to}` : ""}`);
  function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const from = String(d.get("from") ?? ""); const to = String(d.get("to") ?? "");
    if ((!!from !== !!to) || (from && to && from > to)) { setError("Indique ambas fechas y un inicio anterior o igual al final."); document.getElementById("m-from")?.focus(); return; }
    setError(""); setRango(from || to ? { from, to } : null);
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>{titulo}</h1>
      <form className="admin-filtros" onSubmit={aplicar} aria-label="Rango de fechas">
        <Campo id="m-from" etiqueta="Desde" error={error || undefined}>{p => <input {...p} name="from" type="date" className="input" />}</Campo>
        <Campo id="m-to" etiqueta="Hasta">{p => <input {...p} name="to" type="date" className="input" />}</Campo>
        <button type="submit" className="button">Aplicar rango</button>
      </form>
      <QueryState busy={busy} error={consultaError} announcement={announcement} retry={cargar} />
      <p>Ingrese ambas fechas o deje las dos vacías. Por defecto se muestran los últimos 30 días, incluido hoy.</p>
      {datos && (
        <>
          <p role="status">Rango: {fecha(datos.rango.from, false)} a {fecha(datos.rango.to, false)}.</p>
          <div aria-busy={busy}>{children(datos)}</div>
        </>
      )}
    </main>
  );
}
