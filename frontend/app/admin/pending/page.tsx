"use client";

import { useCallback, useEffect, useState } from "react";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";

type Pendiente = { tipo: "documento" | "propuesta"; id: string; nombre: string; origen: string; fecha: string; dias: number };
type Lista = { items: Pendiente[]; total: number; nextCursor: string | null };

export default function PendientesAdmin() {
  const [datos, setDatos] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const cargar = useCallback(async (cursor?: string) => {
    const r = await llamar<Lista>("GET", `/pending?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (r.ok) setDatos(prev => (cursor && prev ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data));
    else setError(mensajeError(r.error, r.status));
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <main className="admin-main admin-main-wide">
      <h1>Pendientes por validar</h1>
      {error && <p role="alert" className="admin-error">{error}</p>}
      {datos && (
        <>
          <p>{datos.total} elementos pendientes, del más antiguo al más reciente.</p>
          <AdminTable<Pendiente> titulo="Documentos y propuestas pendientes" filas={datos.items} clave={p => `${p.tipo}-${p.id}`} vacio="No hay elementos pendientes."
            columnas={[
              { clave: "tipo", titulo: "Tipo", render: p => (p.tipo === "documento" ? "Documento" : "Propuesta de enlace") },
              { clave: "nombre", titulo: "Nombre o URL", render: p => p.nombre },
              { clave: "origen", titulo: "Origen", render: p => p.origen },
              { clave: "fecha", titulo: "Fecha", render: p => new Date(p.fecha).toLocaleString("es-CO") },
              { clave: "dias", titulo: "Días pendiente", render: p => p.dias },
              { clave: "ir", titulo: "Ir", render: p => <a href={p.tipo === "documento" ? "/admin/documents" : "/admin/proposals"}>Abrir {p.tipo === "documento" ? "documentos" : "propuestas"}</a> },
            ]} />
          {datos.nextCursor && <button type="button" className="button" onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más</button>}
        </>
      )}
    </main>
  );
}
