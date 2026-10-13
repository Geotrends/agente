"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AdminDialog from "../../../admin/AdminDialog";
import { Campo } from "../../../admin/AdminForm";
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
  const [datos, setDatos] = useState<Lista | null>(null);
  const [f, setF] = useState({ estado: "", tipoFallo: "", desde: "", hasta: "" });
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [errorTransicion, setErrorTransicion] = useState("");

  const cargar = useCallback(async (cursor?: string) => {
    const q = new URLSearchParams({ limit: "25" });
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    if (cursor) q.set("cursor", cursor);
    const r = await llamar<Lista>("GET", `/improvements?${q}`);
    if (r.ok) { setError(""); setDatos(prev => (cursor && prev ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data)); }
    else setError(mensajeError(r.error, r.status));
  }, [f]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function abrir(id: string) {
    setErrorTransicion("");
    const r = await llamar<Detalle>("GET", `/improvements/${id}`);
    if (r.ok) setDetalle(r.data); else setAviso(mensajeError(r.error, r.status));
  }

  const siguiente = (d: Detalle) => ESTADOS[ESTADOS.indexOf(d.estado as (typeof ESTADOS)[number]) + 1] as string | undefined;

  async function avanzar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detalle) return;
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
    const r = await llamar<Detalle>("POST", `/improvements/${detalle.id}/transitions`, cuerpo);
    if (r.ok) { setDetalle(r.data); setAviso(`Caso pasó a «${a}».`); setErrorTransicion(""); await cargar(); return; }
    setErrorTransicion(r.error.mensaje);
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1>Casos de mejora</h1>
      <p role="status" className="admin-aviso">{aviso}</p>
      {error && <p role="alert" className="admin-error">{error}</p>}
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
          <AdminTable<Caso> titulo="Casos de mejora" filas={datos.items} clave={c => c.id} vacio="No hay casos para ese filtro."
            columnas={[
              { clave: "fecha", titulo: "Fecha", render: c => new Date(c.fecha).toLocaleDateString("es-CO") },
              { clave: "cat", titulo: "Categoría", render: c => c.categoria ?? "—" },
              { clave: "origen", titulo: "Origen", render: c => c.origenes.join(" + ") },
              { clave: "fallo", titulo: "Tipo de fallo", render: c => c.tipoFallo ?? "Sin clasificar" },
              { clave: "estado", titulo: "Estado", render: c => c.estado },
              { clave: "dias", titulo: "Antigüedad (días)", render: c => c.antiguedadDias },
              { clave: "acc", titulo: "Acción", render: c => <button type="button" className="button" onClick={() => { void abrir(c.id); }}>Gestionar caso del {new Date(c.fecha).toLocaleDateString("es-CO")} ({c.estado})</button> },
            ]} />
          {datos.nextCursor && <button type="button" className="button" onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más casos</button>}
        </>
      )}

      <AdminDialog abierto={!!detalle} titulo="Gestionar caso de mejora" onCancelar={() => setDetalle(null)}>
        {detalle && (
          <div>
            <p><strong>Estado:</strong> {detalle.estado} · <strong>Origen:</strong> {detalle.origenes.join(" + ")} · <strong>Categoría:</strong> {detalle.categoria ?? "—"}</p>
            <p><strong>Pregunta:</strong> {detalle.pregunta ?? "Texto depurado por retención"}</p>
            {detalle.motivoValoracion && <p><strong>Motivo de la valoración:</strong> {detalle.motivoValoracion}</p>}
            <h3>Historial</h3>
            <ul className="admin-lista">
              {detalle.historial.length === 0 && <li>Sin cambios todavía.</li>}
              {detalle.historial.map((h, i) => <li key={i}>{h.de} → {h.a} · {new Date(h.fecha).toLocaleString("es-CO")} · usuario {h.usuarioId}{h.nota ? ` · ${h.nota}` : ""}</li>)}
            </ul>
            {siguiente(detalle) ? (
              <form className="admin-form" noValidate onSubmit={avanzar}>
                <p>Siguiente estado permitido: <strong>{siguiente(detalle)}</strong></p>
                {siguiente(detalle) === "En ajuste" && (
                  <Campo id="t-fallo" etiqueta="Tipo de fallo (obligatorio)">
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
                <Campo id="t-nota" etiqueta={siguiente(detalle) === "Cerrada" ? "Nota de cierre (obligatoria)" : "Nota (opcional)"} ayuda="No copie datos personales de la persona.">
                  {p => <textarea {...p} name="note" className="input" rows={2} />}
                </Campo>
                {errorTransicion && <p role="alert" className="admin-error">{errorTransicion}</p>}
                <div className="admin-acciones">
                  <button type="submit" className="button">Pasar a «{siguiente(detalle)}»</button>
                  <button type="button" className="button" onClick={() => setDetalle(null)}>Cerrar</button>
                </div>
              </form>
            ) : <button type="button" className="button" onClick={() => setDetalle(null)}>Cerrar</button>}
          </div>
        )}
      </AdminDialog>
    </main>
  );
}
