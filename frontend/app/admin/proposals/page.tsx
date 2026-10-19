"use client";

import { useEffect, useState, type FormEvent } from "react";
import AdminDialog from "../../../admin/AdminDialog";
import { Campo, ErrorSummary } from "../../../admin/AdminForm";
import { useAdminQuery, QueryState } from "../../../admin/useAdminQuery";
import { fecha, EnlaceExterno } from "../../../admin/format";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";
import { DIRECCIONES } from "../../../admin/DocumentEditor";
import { consultarSesion } from "../../../shared/adminSession";

type Propuesta = {
  id: string; tipo: "add" | "remove"; url: string; direccion: string; justificacion: string; estado: string;
  creadaEn: string; propietario: { id: string; nombre: string | null } | null;
  decididaPor: string | null; decididaEn: string | null; motivoRechazo: string | null; revision: string;
};
type Lista = { items: Propuesta[]; total: number; nextCursor: string | null };
const ESTADOS = ["Pendiente de validación", "Aprobada", "Rechazada", "Retirada"];

export default function PropuestasAdmin() {
  const [seleccionada, setSeleccionada] = useState("");
  useEffect(() => { setSeleccionada(new URLSearchParams(window.location.search).get("id") ?? ""); }, []);
  const [tecnico, setTecnico] = useState(false);
  const [estado, setEstado] = useState("");
  const [aviso, setAviso] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [rechazar, setRechazar] = useState<Propuesta | null>(null);
  const [errorRechazo, setErrorRechazo] = useState("");

  const { data: lista, busy: cargando, error: errorConsulta, announcement: anuncio, cargar } = useAdminQuery<Lista>(`/link-proposals?${new URLSearchParams({ limit: "25", ...(estado ? { state: estado } : {}), ...(seleccionada ? { id: seleccionada } : {}) })}`);

  useEffect(() => { void consultarSesion().then(c => { if (c.estado === "ok") setTecnico(c.sesion.cuenta.perfil === "administrador técnico"); }); }, []);

  useEffect(() => { if (seleccionada && lista) document.getElementById(`propuesta-${seleccionada}`)?.focus(); }, [seleccionada, lista]);

  async function crear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setErrores({}); setAviso("");
    const r = await llamar<Propuesta>("POST", "/link-proposals", {
      type: d.get("type") || undefined, url: d.get("url"), direction: d.get("direction") || undefined, justification: d.get("justification"),
    });
    if (r.ok) { form.reset(); setAviso("Propuesta registrada como «Pendiente de validación»."); await cargar(); return; }
    if (r.error.campo) { setErrores({ [r.error.campo]: r.error.mensaje }); document.getElementById(`prop-${r.error.campo}`)?.focus(); }
    else setAviso(mensajeError(r.error, r.status));
  }

  async function decidir(p: Propuesta, tipo: "approve" | "withdraw") {
    const r = await llamar("POST", `/link-proposals/${p.id}/${tipo}`, { expectedRevision: p.revision });
    setAviso(r.ok ? (tipo === "approve" ? "Propuesta aprobada; se aplica desde la siguiente ejecución del scraper." : "Propuesta retirada.") : mensajeError(r.error, r.status));
    await cargar();
  }

  async function confirmarRechazo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rechazar) return;
    const motivo = String(new FormData(e.currentTarget).get("motivo") ?? "").trim();
    if (!motivo) { setErrorRechazo("El motivo es obligatorio para rechazar."); return; }
    const r = await llamar("POST", `/link-proposals/${rechazar.id}/reject`, { expectedRevision: rechazar.revision, motivo });
    if (r.ok) { setRechazar(null); setAviso("Propuesta rechazada."); await cargar(); return; }
    setErrorRechazo(r.error.mensaje);
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>Propuestas de enlaces</h1>
      <QueryState busy={cargando} error={errorConsulta} announcement={anuncio} retry={cargar} />
      <p role="status" className="admin-aviso">{aviso}</p>
      {seleccionada && <p>Mostrando la propuesta seleccionada. <button className="button button-secondary" onClick={() => setSeleccionada("")}>Ver todas las propuestas</button></p>}
      <section aria-labelledby="h-nueva-prop">
        <h2 id="h-nueva-prop">Registrar una propuesta</h2>
        <p>Los campos marcados con * son obligatorios.</p>
        <ErrorSummary errores={errores} prefijo="prop-" />
        <form className="admin-form" noValidate onSubmit={crear}>
          <Campo id="prop-type" etiqueta="Tipo de solicitud" error={errores.type}>
            {p => <select {...p} name="type" required className="input" defaultValue="">
              <option value="" disabled>Seleccione…</option><option value="add">Agregar enlace</option><option value="remove">Quitar enlace</option></select>}
          </Campo>
          <Campo id="prop-url" etiqueta="URL completa (https)" error={errores.url}>{p => <input {...p} name="url" type="url" className="input" required />}</Campo>
          <Campo id="prop-direction" etiqueta="Dirección responsable" error={errores.direction}>
            {p => <select {...p} name="direction" required className="input" defaultValue=""><option value="" disabled>Seleccione…</option>{DIRECCIONES.map(x => <option key={x}>{x}</option>)}</select>}
          </Campo>
          <Campo id="prop-justification" etiqueta="Justificación" error={errores.justification}>{p => <textarea {...p} name="justification" className="input" rows={3} required />}</Campo>
          <button className="button" type="submit">Registrar propuesta</button>
        </form>
      </section>

      <section aria-labelledby="h-lista-prop">
        <h2 id="h-lista-prop">{tecnico ? "Propuestas" : "Mis propuestas"}{lista ? ` (${lista.total})` : ""}</h2>
        <Campo id="prop-filtro" etiqueta="Estado">
          {p => <select {...p} className="input" value={estado} onChange={e => setEstado(e.target.value)}><option value="">Todos</option>{ESTADOS.map(s => <option key={s}>{s}</option>)}</select>}
        </Campo>
        {lista && (
          <AdminTable<Propuesta> ocupado={cargando} titulo="Propuestas de enlaces" filaId={p => `propuesta-${p.id}`} filas={lista.items} clave={p => p.id}
            columnas={[
              { clave: "tipo", titulo: "Solicitud", render: p => (p.tipo === "add" ? "Agregar" : "Quitar") },
              { clave: "url", titulo: "URL", fila: true, render: p => <EnlaceExterno href={p.url}>{p.url}</EnlaceExterno> },
              { clave: "dir", titulo: "Dirección", render: p => p.direccion },
              { clave: "just", titulo: "Justificación", render: p => p.justificacion },
              { clave: "fecha", titulo: "Fecha y hora", fecha: true, render: p => fecha(p.creadaEn) },
              { clave: "estado", titulo: "Estado", render: p => (
                <>{p.estado}{p.motivoRechazo ? ` — Motivo: ${p.motivoRechazo}` : ""}{p.decididaPor ? ` · ${p.decididaPor}, ${fecha(p.decididaEn)}` : ""}</>) },
              ...(tecnico ? [{ clave: "prop", titulo: "Propietario", render: (p: Propuesta) => p.propietario?.nombre ?? "Sin dato" }] : []),
              { clave: "acciones", titulo: "Acciones", render: p => (p.estado !== "Pendiente de validación" ? "—" : (
                <div className="admin-acciones">
                  {tecnico && <button type="button" className="button" aria-label={`Aprobar ${p.url}`} onClick={() => { void decidir(p, "approve"); }}>Aprobar</button>}
                  {tecnico && <button type="button" className="button button-danger" aria-label={`Rechazar ${p.url}`} onClick={() => { setErrorRechazo(""); setRechazar(p); }}>Rechazar</button>}
                  {!tecnico && <button type="button" className="button button-danger" aria-label={`Retirar propuesta ${p.url}`} onClick={() => { void decidir(p, "withdraw"); }}>Retirar propuesta</button>}
                </div>)) },
            ]} />
        )}
        {lista?.nextCursor && <button type="button" className="button button-secondary" disabled={cargando} onClick={() => { void cargar(lista.nextCursor!); }}>Cargar más propuestas</button>}
      </section>

      <AdminDialog abierto={!!rechazar} titulo="Rechazar propuesta" onCancelar={() => setRechazar(null)}>
        {rechazar && (
          <form className="admin-form" noValidate onSubmit={confirmarRechazo}>
            <p>La lista de enlaces no cambia. La persona verá el motivo.</p>
            <Campo id="rechazo-motivo" etiqueta="Motivo (obligatorio)" error={errorRechazo || undefined}>
              {p => <textarea {...p} name="motivo" className="input" rows={3} required />}
            </Campo>
            <div className="admin-acciones">
              <button type="submit" className="button">Confirmar rechazo</button>
              <button type="button" className="button button-secondary" onClick={() => setRechazar(null)}>Cancelar</button>
            </div>
          </form>
        )}
      </AdminDialog>
    </main>
  );
}
