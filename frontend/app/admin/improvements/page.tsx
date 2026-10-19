"use client";

import { useState, type FormEvent } from "react";
import AdminDialog from "../../../admin/AdminDialog";
import { Campo } from "../../../admin/AdminForm";
import { useAdminQuery, QueryState } from "../../../admin/useAdminQuery";
import { fecha, numero } from "../../../admin/format";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";

const ESTADOS = ["Registrada", "En análisis", "En ajuste", "Ajustada", "Validada", "Cerrada"] as const;
type Caso = {
  id: string; fecha: string; categoria: string | null; origenes: string[]; tipoFallo: string | null; estado: string;
  antiguedadDias: number; revision: string; hallazgoRef: string | null;
};
type Detalle = Caso & {
  pregunta: string | null; motivoValoracion: string | null; disponibilidad: "disponible" | "depurada";
  historial: Array<{ de: string; a: string; usuarioId: string; fecha: string; nota: string | null; tipoFallo: string | null; evidencias: unknown[] }>;
};
type Lista = { items: Caso[]; total: number; abiertos: number; nextCursor: string | null };

export default function MejorasAdmin() {
  const [f, setF] = useState({ estado: "", tipoFallo: "", desde: "", hasta: "" });
  const [aviso, setAviso] = useState("");
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorCampo, setErrorCampo] = useState("");
  const [errorTransicion, setErrorTransicion] = useState("");

  const { data: datos, busy: cargando, error: error, announcement: anuncio, cargar } = useAdminQuery<Lista>(`/improvements?${new URLSearchParams({ limit: "25", ...Object.fromEntries(Object.entries(f).filter(([,v]) => v)) })}`);

  async function abrir(id: string) {
    setErrorTransicion("");
    const r = await llamar<Detalle>("GET", `/improvements/${id}`);
    if (r.ok) setDetalle(r.data); else setAviso(mensajeError(r.error, r.status));
  }

  const siguiente = (d: Detalle) => ESTADOS[ESTADOS.indexOf(d.estado as (typeof ESTADOS)[number]) + 1] as string | undefined;

  async function avanzar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detalle || guardando) return;
    const a = siguiente(detalle);
    if (!a) return;
    const d = new FormData(e.currentTarget);
    const cuerpo: Record<string, unknown> = { expectedRevision: detalle.revision, to: a };
    const tipo = String(d.get("failureType") ?? "");
    if (tipo) cuerpo.failureType = tipo;
    const nota = String(d.get("note") ?? "").trim();
    if (nota) cuerpo.note = nota;
    const runId = String(d.get("runId") ?? "").trim();
    if (runId) cuerpo.evidenceRefs = [{ runId, sha256: String(d.get("sha256") ?? "").trim(), releaseId: String(d.get("releaseId") ?? "").trim() }];
    setGuardando(true);
    const r = await llamar<Detalle>("POST", `/improvements/${detalle.id}/transitions`, cuerpo);
    setGuardando(false);
    if (r.ok) { setDetalle(r.data); setAviso(`Caso pasó a «${a}».`); setErrorTransicion(""); await cargar(); return; }
    setErrorTransicion(r.error.mensaje); setErrorCampo(r.error.campo ?? "");
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>Casos de mejora</h1>
      <QueryState busy={cargando} error={error} announcement={anuncio} retry={cargar} />
      <p role="status" className="admin-aviso">{aviso}</p>
      <form className="admin-filtros" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); setF({
        estado: String(d.get("estado") ?? ""), tipoFallo: String(d.get("tipoFallo") ?? ""), desde: String(d.get("desde") ?? ""), hasta: String(d.get("hasta") ?? "") }); }}
        aria-label="Filtros de casos">
        <Campo id="m-estado" etiqueta="Estado">{p => <select {...p} name="estado" className="input" defaultValue=""><option value="">Todos</option>{ESTADOS.map(s => <option key={s}>{s}</option>)}</select>}</Campo>
        <Campo id="m-fallo" etiqueta="Tipo de fallo">{p => <select {...p} name="tipoFallo" className="input" defaultValue=""><option value="">Todos</option><option>Datos</option><option>Recuperación</option><option>Modelo</option></select>}</Campo>
        <Campo id="m-desde" etiqueta="Desde">{p => <input {...p} name="desde" type="date" className="input" />}</Campo>
        <Campo id="m-hasta" etiqueta="Hasta">{p => <input {...p} name="hasta" type="date" className="input" />}</Campo>
        <button type="submit" className="button">Filtrar</button>
      </form>
      {datos && (
        <>
          <p>{datos.total} casos · {datos.abiertos} sin cerrar.</p>
          <AdminTable<Caso> ocupado={cargando} titulo="Casos de mejora" filas={datos.items} clave={c => c.id} vacio="No hay casos para ese filtro."
            columnas={[
              { clave: "fecha", titulo: "Fecha", fecha: true, render: c => fecha(c.fecha, false) },
              { clave: "cat", titulo: "Categoría", render: c => c.categoria ?? "Sin dato" },
              { clave: "origen", titulo: "Origen", render: c => c.origenes.join(" + ") },
              { clave: "fallo", titulo: "Tipo de fallo", render: c => c.tipoFallo ?? "Sin clasificar" },
              { clave: "estado", titulo: "Estado", render: c => c.estado },
              { clave: "dias", titulo: "Antigüedad (días)", numerica: true, ordenar: c => c.antiguedadDias, render: c => numero(c.antiguedadDias) },
              { clave: "acc", titulo: "Acción", render: c => <button type="button" className="button" onClick={() => { void abrir(c.id); }} aria-label={`Gestionar caso ${c.id}, ${fecha(c.fecha, false)}, ${c.estado}`}>Gestionar caso</button> },
            ]} />
          {datos.nextCursor && <button type="button" className="button button-secondary" disabled={cargando} onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más casos</button>}
        </>
      )}

      <AdminDialog abierto={!!detalle} titulo="Gestionar caso de mejora" onCancelar={() => { if (!guardando) setDetalle(null); }}>
        {detalle && (
          <div>
            <p><strong>Estado:</strong> {detalle.estado} · <strong>Origen:</strong> {detalle.origenes.join(" + ")} · <strong>Categoría:</strong> {detalle.categoria ?? "Sin dato"}</p>
            <p><strong>Pregunta:</strong> {detalle.pregunta ?? "Texto depurado por retención"}</p>
            {detalle.motivoValoracion && <p><strong>Motivo de la valoración:</strong> {detalle.motivoValoracion}</p>}
            <h3>Historial</h3>
            <ul className="admin-lista">
              {detalle.historial.length === 0 && <li>Sin cambios todavía.</li>}
              {detalle.historial.map((h, i) => <li key={i}>{h.de} → {h.a} · {fecha(h.fecha)} · usuario {h.usuarioId}{h.nota ? ` · ${h.nota}` : ""}</li>)}
            </ul>
            {siguiente(detalle) ? (
              <form className="admin-form" noValidate onSubmit={avanzar}>
                <p>Siguiente estado permitido: <strong>{siguiente(detalle)}</strong></p>
                {siguiente(detalle) === "En ajuste" && (
                  <Campo id="t-fallo" etiqueta="Tipo de fallo (obligatorio)" error={errorCampo === "failureType" ? errorTransicion : undefined}>
                    {p => <select {...p} name="failureType" className="input" defaultValue=""><option value="" disabled>Seleccione…</option><option>Datos</option><option>Recuperación</option><option>Modelo</option></select>}
                  </Campo>
                )}
                {(siguiente(detalle) === "Validada") && (
                  <>
                    <Campo id="t-run" etiqueta="Corrida de validación (identificador)">{p => <input {...p} name="runId" className="input" />}</Campo>
                    <Campo id="t-sha" etiqueta="Huella SHA-256 de la corrida">{p => <input {...p} name="sha256" className="input" />}</Campo>
                    <Campo id="t-rel" etiqueta="Versión (release) validada">{p => <input {...p} name="releaseId" className="input" />}</Campo>
                  </>
                )}
                <Campo id="t-nota" etiqueta={siguiente(detalle) === "Cerrada" ? "Nota de cierre (obligatoria)" : "Nota (opcional)"} ayuda="No copie datos personales de la persona." error={errorCampo === "note" ? errorTransicion : undefined}>
                  {p => <textarea {...p} name="note" className="input" rows={2} />}
                </Campo>
                {errorTransicion && !["failureType", "note"].includes(errorCampo) && <p role="alert" className="admin-error">{errorTransicion}</p>}
                <div className="admin-acciones">
                  <button type="submit" disabled={guardando} className="button">Pasar a «{siguiente(detalle)}»</button>
                  <button type="button" className="button button-secondary" disabled={guardando} onClick={() => setDetalle(null)}>Cerrar</button>
                </div>
              </form>
            ) : <button type="button" className="button button-secondary" disabled={guardando} onClick={() => setDetalle(null)}>Cerrar</button>}
          </div>
        )}
      </AdminDialog>
    </main>
  );
}
