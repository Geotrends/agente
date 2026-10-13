"use client";

import { useCallback, useEffect, useState } from "react";
import { cargarSesion, llamar } from "../../../shared/adminSession";
import { useGatedInterval } from "../../../admin/useGatedInterval";

type Componente = {
  component: string; status: "normal" | "degradado" | "no comprobado";
  lastSuccessAt: string | null; lastFailureAt: string | null; thresholdApplied?: boolean; safeReason?: string;
};
const NOMBRES: Record<string, string> = {
  "gpt-oss-20b": "Modelo gpt-oss-20b", "gpt-oss-120b": "Modelo gpt-oss-120b", reranker: "Reranker",
  registro: "Registro de consultas", scraper: "Scraper (última corrida)",
};
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-CO") : "—");

type Reindexacion = { id: string; estado: "En curso" | "Terminada" | "Fallida"; inicio: string | null; fin: string | null } | null;

export default function EstadoAdmin() {
  const [datos, setDatos] = useState<Componente[] | null>(null);
  const [reindex, setReindex] = useState<Reindexacion>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const r = await llamar<{ componentes: Componente[]; reindexacion?: Reindexacion }>("GET", "/status");
    if (r.ok) { setDatos(r.data.componentes); setReindex(r.data.reindexacion ?? null); setError(""); return; }
    if (r.status === 401) { window.location.assign("/admin/login"); return; }
    setError(r.status === 403 ? "Su perfil no tiene acceso al estado del sistema." : r.error.mensaje);
  }, []);

  useEffect(() => {
    void cargarSesion().then(s => { if (!s) window.location.assign("/admin/login"); else void cargar(); });
  }, [cargar]);
  useGatedInterval(() => { void cargar(); }, 15_000);

  return (
    <main className="admin-main">
      <h1>Estado del sistema</h1>
      <p>Se actualiza cada 15 segundos mientras usted interactúa con la pantalla; si lleva más de un minuto sin actividad, deje de verlo actualizado hasta que vuelva a usarla. El estado es el último observado, no una suposición.</p>
      {error && <p role="alert" className="admin-error">{error}</p>}
      {reindex && (
        <p role="status" className="admin-aviso">
          Última reindexación: <strong>{reindex.estado}</strong> · Inicio: {reindex.inicio ? fecha(reindex.inicio) : "—"} · Fin: {reindex.fin ? fecha(reindex.fin) : "—"}
        </p>
      )}
      {datos && (
        <table className="md-table">
          <caption className="sr-only">Estado observado de cada componente</caption>
          <thead><tr><th scope="col">Componente</th><th scope="col">Estado</th><th scope="col">Último éxito</th><th scope="col">Último fallo</th><th scope="col">Detalle</th></tr></thead>
          <tbody>
            {datos.map(c => (
              <tr key={c.component}>
                <th scope="row">{NOMBRES[c.component] ?? c.component}</th>
                <td>{c.status}</td>
                <td>{fecha(c.lastSuccessAt)}</td>
                <td>{fecha(c.lastFailureAt)}</td>
                <td>
                  {c.component === "reranker" && c.thresholdApplied !== undefined ? `Umbral de relevancia ${c.thresholdApplied ? "aplicado" : "no aplicado"}. ` : ""}
                  {c.safeReason ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
