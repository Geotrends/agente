"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Campo } from "../../../admin/AdminForm";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";
import { tokenCsrf } from "../../../shared/adminSession";

type Interaccion = {
  fechaHora: string; categoria: string | null; pregunta: string | null; respuesta: string | null; tipo: string;
  documentosCitados: Array<{ nombre: string; enlace: string; fecha: string }>; modelo: string;
  valoracion: string; motivo: string | null; disponibilidad: "disponible" | "depurada";
};
type Lista = { items: Interaccion[]; total: number; nextCursor: string | null };
type Filtros = { desde: string; hasta: string; categoria: string; tipo: string; valoracion: string };
const VACIO: Filtros = { desde: "", hasta: "", categoria: "", tipo: "", valoracion: "" };

const consulta = (f: Filtros) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  return q;
};

export default function InteraccionesAdmin() {
  const [filtros, setFiltros] = useState<Filtros>(VACIO);
  const [datos, setDatos] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async (cursor?: string) => {
    const q = consulta(filtros);
    q.set("limit", "25");
    if (cursor) q.set("cursor", cursor);
    const r = await llamar<Lista>("GET", `/interactions?${q}`);
    if (r.ok) { setError(""); setDatos(prev => (cursor && prev ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data)); }
    else setError(mensajeError(r.error, r.status));
  }, [filtros]);
  useEffect(() => { void cargar(); }, [cargar]);

  function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setFiltros({ desde: String(d.get("desde") ?? ""), hasta: String(d.get("hasta") ?? ""), categoria: String(d.get("categoria") ?? ""),
      tipo: String(d.get("tipo") ?? ""), valoracion: String(d.get("valoracion") ?? "") });
  }

  async function exportar() {
    setAviso("Preparando la exportación…");
    try {
      const res = await fetch(`/api/admin/interactions/export?${consulta(filtros)}`, { credentials: "same-origin", headers: tokenCsrf() ? { "X-CSRF-Token": tokenCsrf() } : {} });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setAviso(j?.error?.mensaje ?? "No se pudo generar la exportación.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "interacciones.xlsx";
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setAviso(`Exportación lista: ${res.headers.get("X-Filas") ?? "?"} filas, con los mismos filtros.`);
    } catch { setAviso("No hay conexión con el servidor."); }
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1>Interacciones</h1>
      <p>Solo consultas autorizadas, con los datos personales enmascarados como están en el registro. No se editan ni se borran desde aquí.</p>
      <form className="admin-filtros" onSubmit={aplicar} aria-label="Filtros de interacciones">
        <Campo id="f-desde" etiqueta="Desde">{p => <input {...p} name="desde" type="date" className="input" />}</Campo>
        <Campo id="f-hasta" etiqueta="Hasta">{p => <input {...p} name="hasta" type="date" className="input" />}</Campo>
        <Campo id="f-categoria" etiqueta="Categoría">
          {p => <select {...p} name="categoria" className="input" defaultValue=""><option value="">Todas</option>
            <option>Ecosistemas</option><option>Bienestar Animal</option><option>Gestión Ambiental</option></select>}
        </Campo>
        <Campo id="f-tipo" etiqueta="Tipo de resultado">
          {p => <select {...p} name="tipo" className="input" defaultValue=""><option value="">Todos</option>
            <option>respondida</option><option>sin información</option><option>fuera de alcance</option><option>aclaración</option></select>}
        </Campo>
        <Campo id="f-valoracion" etiqueta="Valoración">
          {p => <select {...p} name="valoracion" className="input" defaultValue=""><option value="">Todas</option>
            <option>Útil</option><option>No útil</option><option>Sin valorar</option></select>}
        </Campo>
        <button type="submit" className="button">Filtrar</button>
        <button type="button" className="button" onClick={() => { void exportar(); }}>Exportar a Excel (.xlsx)</button>
      </form>
      <p role="status" className="admin-aviso">{aviso}</p>
      {error && <p role="alert" className="admin-error">{error}</p>}
      {datos && (
        <>
          <p>{datos.total} interacciones.</p>
          <AdminTable<Interaccion> titulo="Interacciones autorizadas" filas={datos.items} clave={i => `${i.fechaHora}-${i.tipo}-${i.categoria}-${i.pregunta}-${i.modelo}`} vacio="No hay interacciones para ese filtro."
            columnas={[
              { clave: "fecha", titulo: "Fecha y hora", render: i => new Date(i.fechaHora).toLocaleString("es-CO") },
              { clave: "cat", titulo: "Categoría", render: i => i.categoria ?? "—" },
              { clave: "preg", titulo: "Pregunta", render: i => i.pregunta ?? "Texto depurado por retención" },
              { clave: "resp", titulo: "Respuesta", render: i => i.respuesta ?? "Texto depurado por retención" },
              { clave: "tipo", titulo: "Tipo de resultado", render: i => i.tipo },
              { clave: "docs", titulo: "Documentos citados", render: i => (i.documentosCitados.length ? i.documentosCitados.map(d => d.nombre).join("; ") : "—") },
              { clave: "mod", titulo: "Modelo", render: i => i.modelo },
              { clave: "val", titulo: "Valoración", render: i => i.valoracion },
              { clave: "mot", titulo: "Motivo", render: i => i.motivo ?? "—" },
            ]} />
          {datos.nextCursor && <button type="button" className="button" onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más interacciones</button>}
        </>
      )}
    </main>
  );
}
