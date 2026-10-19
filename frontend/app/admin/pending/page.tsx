"use client";

import { useState } from "react";
import { useAdminQuery, QueryState } from "../../../admin/useAdminQuery";
import { fecha, numero } from "../../../admin/format";
import AdminTable from "../../../admin/AdminTable";

type Pendiente = { tipo: "documento" | "propuesta"; id: string; nombre: string; origen: string; fecha: string; dias: number };
type Lista = { items: Pendiente[]; total: number; nextCursor: string | null };

export default function PendientesAdmin() {
  const { data: datos, busy: cargando, error: error, announcement: anuncio, cargar } = useAdminQuery<Lista>("/pending?limit=50");

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>Pendientes por validar</h1>
      <QueryState busy={cargando} error={error} announcement={anuncio} retry={cargar} />
      {datos && (
        <>
          <p>{datos.total} elementos pendientes, del más antiguo al más reciente.</p>
          <AdminTable<Pendiente> ocupado={cargando} buscar={p => `${p.nombre} ${p.origen} ${p.tipo}`} titulo="Documentos y propuestas pendientes" filas={datos.items} clave={p => `${p.tipo}-${p.id}`} vacio="No hay elementos pendientes."
            columnas={[
              { clave: "tipo", titulo: "Tipo", render: p => (p.tipo === "documento" ? "Documento" : "Propuesta de enlace") },
              { clave: "nombre", titulo: "Nombre o URL", fila: true, ordenar: p => p.nombre, render: p => p.nombre },
              { clave: "origen", titulo: "Origen", render: p => p.origen },
              { clave: "fecha", titulo: "Fecha", fecha: true, render: p => fecha(p.fecha) },
              { clave: "dias", titulo: "Días pendiente", numerica: true, ordenar: p => p.dias, render: p => numero(p.dias) },
              { clave: "ir", titulo: "Ir", render: p => <a href={`${p.tipo === "documento" ? "/admin/documents" : "/admin/proposals"}?id=${encodeURIComponent(p.id)}`} aria-label={`Abrir ${p.nombre}`}>Abrir registro</a> },
            ]} />
          {datos.nextCursor && <button type="button" className="button button-secondary" disabled={cargando} onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más</button>}
        </>
      )}
    </main>
  );
}
