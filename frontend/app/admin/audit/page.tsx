"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Campo } from "../../../admin/AdminForm";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";

type Fila = { id: string; actor: { id: string | null; nombre: string | null; rol: string | null }; accion: string; objeto: string; objetoId: string | null; resultado: string; fecha: string };
type Lista = { items: Fila[]; total: number; nextCursor: string | null };
type Cuenta = { id: string; nombre: string; email: string };

export default function AuditoriaAdmin() {
  const [datos, setDatos] = useState<Lista | null>(null);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [filtros, setFiltros] = useState({ usuario: "", accion: "", desde: "", hasta: "" });
  const [error, setError] = useState("");

  const cargar = useCallback(async (cursor?: string) => {
    const q = new URLSearchParams({ limit: "50" });
    for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
    if (cursor) q.set("cursor", cursor);
    const r = await llamar<Lista>("GET", `/audit?${q}`);
    if (r.ok) { setError(""); setDatos(prev => (cursor && prev ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data)); }
    else setError(r.error.campo ? `${r.error.mensaje}` : mensajeError(r.error, r.status));
  }, [filtros]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { void llamar<{ items: Cuenta[] }>("GET", "/accounts?limit=100").then(r => { if (r.ok) setCuentas(r.data.items); }); }, []);

  function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setFiltros({ usuario: String(d.get("usuario") ?? ""), accion: String(d.get("accion") ?? ""), desde: String(d.get("desde") ?? ""), hasta: String(d.get("hasta") ?? "") });
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1>Auditoría</h1>
      <p>Registro de solo lectura: no contiene contraseñas ni contenido de documentos.</p>
      <form className="admin-filtros" onSubmit={aplicar} aria-label="Filtros de auditoría">
        <Campo id="aud-usuario" etiqueta="Usuario">
          {p => <select {...p} name="usuario" className="input" defaultValue=""><option value="">Todos</option>
            {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.email})</option>)}
            <option value="contractor_recovery">Recuperación reservada (contractor_recovery)</option></select>}
        </Campo>
        <Campo id="aud-accion" etiqueta="Acción (por ejemplo cuenta.crear)">{p => <input {...p} name="accion" className="input" />}</Campo>
        <Campo id="aud-desde" etiqueta="Desde">{p => <input {...p} name="desde" type="date" className="input" />}</Campo>
        <Campo id="aud-hasta" etiqueta="Hasta">{p => <input {...p} name="hasta" type="date" className="input" />}</Campo>
        <button type="submit" className="button">Filtrar</button>
      </form>
      {error && <p role="alert" className="admin-error">{error}</p>}
      {datos && (
        <>
          <p>{datos.total} registros.</p>
          <AdminTable<Fila> titulo="Registro de auditoría" filas={datos.items} clave={f => f.id} vacio="No hay registros para ese filtro."
            columnas={[
              { clave: "fecha", titulo: "Fecha y hora", render: f => new Date(f.fecha).toLocaleString("es-CO") },
              { clave: "actor", titulo: "Usuario o rol", render: f => f.actor.nombre ?? f.actor.rol ?? f.actor.id ?? "—" },
              { clave: "accion", titulo: "Acción", render: f => f.accion },
              { clave: "objeto", titulo: "Objeto", render: f => `${f.objeto}${f.objetoId ? ` · ${f.objetoId}` : ""}` },
              { clave: "res", titulo: "Resultado", render: f => f.resultado },
            ]} />
          {datos.nextCursor && <button type="button" className="button" onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más registros</button>}
        </>
      )}
    </main>
  );
}
