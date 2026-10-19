"use client";

import { useState, type FormEvent } from "react";
import AdminDialog from "../../../admin/AdminDialog";
import { Campo } from "../../../admin/AdminForm";
import { useAdminQuery, QueryState } from "../../../admin/useAdminQuery";
import { fecha, EnlaceExterno } from "../../../admin/format";
import AdminTable from "../../../admin/AdminTable";
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
  const [detalle, setDetalle] = useState<Interaccion | null>(null);
  const [exportando, setExportando] = useState(false);
  const [filtros, setFiltros] = useState<Filtros>(VACIO);
  const [aviso, setAviso] = useState("");

  const { data: datos, busy: cargando, error: error, announcement: anuncio, cargar } = useAdminQuery<Lista>(`/interactions?${consulta(filtros)}&limit=25`);

  function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setFiltros({ desde: String(d.get("desde") ?? ""), hasta: String(d.get("hasta") ?? ""), categoria: String(d.get("categoria") ?? ""),
      tipo: String(d.get("tipo") ?? ""), valoracion: String(d.get("valoracion") ?? "") });
  }

  async function exportar() {
    if (exportando) return;
    setExportando(true); setAviso("Preparando la exportación…");
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
    } catch { setAviso("No hay conexión con el servidor."); } finally { setExportando(false); }
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>Interacciones</h1>
      <QueryState busy={cargando} error={error} announcement={anuncio} retry={cargar} />
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
        <button type="button" className="button button-secondary" disabled={exportando || cargando} onClick={() => { void exportar(); }}>Exportar a Excel (.xlsx)</button>
      </form>
      <p role="status" className="admin-aviso">{aviso}</p>
      {datos && (
        <>
          <p>{datos.total} interacciones.</p>
          <AdminTable<Interaccion> ocupado={cargando} titulo="Interacciones autorizadas" filas={datos.items} clave={i => `${i.fechaHora}-${i.tipo}-${i.categoria}-${i.pregunta}-${i.modelo}`} vacio="No hay interacciones para ese filtro."
            columnas={[
              { clave: "fecha", titulo: "Fecha y hora", fila: true, fecha: true, render: i => fecha(i.fechaHora) },
              { clave: "cat", titulo: "Categoría", render: i => i.categoria ?? "Sin dato" },
              { clave: "preg", titulo: "Pregunta", render: i => i.pregunta ? `${i.pregunta.slice(0, 120)}${i.pregunta.length > 120 ? "…" : ""}` : "Texto depurado por retención" },
              { clave: "resp", titulo: "Respuesta", movil: true, render: i => <><p>{i.respuesta ? `${i.respuesta.slice(0, 160)}${i.respuesta.length > 160 ? "…" : ""}` : "Texto depurado por retención"}</p><button className="button button-secondary" type="button" aria-label={`Ver interacción completa: ${fecha(i.fechaHora)}, ${i.pregunta?.slice(0, 60) ?? "texto depurado"}`} onClick={() => setDetalle(i)}>Ver interacción completa</button></> },
              { clave: "tipo", titulo: "Tipo de resultado", render: i => i.tipo },
              { clave: "docs", titulo: "Documentos citados", render: i => (i.documentosCitados.length ? i.documentosCitados.map((d, index) => <p key={`${d.enlace}-${index}`}><EnlaceExterno href={d.enlace}>{d.nombre}</EnlaceExterno></p>) : "No aplica") },
              { clave: "mod", titulo: "Modelo", render: i => i.modelo },
              { clave: "val", titulo: "Valoración", render: i => i.valoracion },
              { clave: "mot", titulo: "Motivo", render: i => i.motivo ?? "Sin dato" },
            ]} />
          {datos.nextCursor && <button type="button" className="button button-secondary" disabled={cargando} onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más interacciones</button>}
        </>
      )}
      <AdminDialog abierto={!!detalle} titulo="Interacción completa" onCancelar={() => setDetalle(null)}>
        {detalle && <div>
          <p>{fecha(detalle.fechaHora)} · {detalle.categoria ?? "Sin categoría"} · {detalle.modelo}</p>
          <h3>Pregunta</h3><p className="admin-detalle">{detalle.pregunta ?? "Texto depurado por retención"}</p>
          <h3>Respuesta</h3><p className="admin-detalle">{detalle.respuesta ?? "Texto depurado por retención"}</p>
          <p>Valoración: {detalle.valoracion}. Motivo: {detalle.motivo ?? "Sin motivo registrado"}.</p>
          <h3>Documentos citados</h3>
          {detalle.documentosCitados.length ? <ul>{detalle.documentosCitados.map((d, i) => <li key={i}><EnlaceExterno href={d.enlace}>{d.nombre}</EnlaceExterno> · {fecha(d.fecha, false)}</li>)}</ul> : <p>Sin documentos citados.</p>}
          <button type="button" className="button button-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
        </div>}
      </AdminDialog>
    </main>
  );
}
