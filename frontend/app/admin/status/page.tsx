"use client";

import { useState } from "react";
import AdminTable from "../../../admin/AdminTable";
import { fecha } from "../../../admin/format";
import { useAdminQuery, QueryState } from "../../../admin/useAdminQuery";
import { useGatedInterval } from "../../../admin/useGatedInterval";

type Componente = {
  component: string; status: "normal" | "degradado" | "no comprobado";
  lastSuccessAt: string | null; lastFailureAt: string | null; thresholdApplied?: boolean; safeReason?: string;
};
const NOMBRES: Record<string, string> = {
  "gpt-oss-20b": "Modelo gpt-oss-20b", "gpt-oss-120b": "Modelo gpt-oss-120b", reranker: "Reranker",
  registro: "Registro de consultas", scraper: "Scraper (última corrida)",
};


type Reindexacion = { id: string; estado: "En curso" | "Terminada" | "Fallida"; inicio: string | null; fin: string | null } | null;

export default function EstadoAdmin() {
  const [automatico, setAutomatico] = useState(true);
  const { data, busy: cargando, error, announcement, cargar } = useAdminQuery<{ componentes: Componente[]; reindexacion?: Reindexacion }>("/status");
  const datos = data?.componentes;
  const reindex = data?.reindexacion;
  useGatedInterval(() => { if (automatico) void cargar(); }, 15_000);

  return (
    <main className="admin-main">
      <h1 tabIndex={-1}>Estado del sistema</h1>
      <p>Se actualiza cada 15 segundos mientras usted interactúa con la pantalla; si lleva más de un minuto sin actividad, deje de verlo actualizado hasta que vuelva a usarla. El estado es el último observado, no una suposición.</p>
      <label><input type="checkbox" checked={automatico} onChange={e => setAutomatico(e.target.checked)} /> Actualizar automáticamente</label>
      <button className="button button-secondary" type="button" disabled={cargando} onClick={() => { void cargar(); }}>Actualizar ahora</button>
      <QueryState busy={cargando} error={error} announcement={announcement} retry={cargar} />
      {reindex && (
        <p role="status" className="admin-aviso">
          Última reindexación: <strong>{reindex.estado}</strong> · Inicio: {reindex.inicio ? fecha(reindex.inicio) : "—"} · Fin: {reindex.fin ? fecha(reindex.fin) : "—"}
        </p>
      )}
      {datos && (
        <AdminTable titulo="Estado observado de cada componente" filas={datos} clave={c => c.component} ocupado={cargando} columnas={[
          { clave: "componente", titulo: "Componente", fila: true, render: c => NOMBRES[c.component] ?? c.component },
          { clave: "estado", titulo: "Estado", render: c => c.status },
          { clave: "exito", titulo: "Último éxito", fecha: true, render: c => fecha(c.lastSuccessAt) },
          { clave: "fallo", titulo: "Último fallo", fecha: true, render: c => fecha(c.lastFailureAt) },
          { clave: "detalle", titulo: "Detalle", render: c => `${c.component === "reranker" && c.thresholdApplied !== undefined ? `Umbral de relevancia ${c.thresholdApplied ? "aplicado" : "no aplicado"}. ` : ""}${c.safeReason ?? "Sin observaciones"}` },
        ]} />
      )}
    </main>
  );
}
