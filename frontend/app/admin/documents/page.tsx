"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AdminDialog from "../../../admin/AdminDialog";
import { Campo } from "../../../admin/AdminForm";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";
import DocumentUploadForm, { DIRECCIONES, TIPOS } from "../../../admin/DocumentEditor";
import DocumentOperationStatus from "../../../admin/DocumentOperation";
import { consultarSesion } from "../../../shared/adminSession";

type Persona = { id: string; nombre: string } | null;
type Documento = {
  id: string; revision: string; codigo: string; nombre: string; tipo: string; direccion: string; enlace: string; estado: string;
  version: string; fechaActualizacion: string; formatoOriginal: string; usoOcr: string; fechaCarga: string;
  procedimientoOrigen: string; origen: "manual" | "scraper"; autor: Persona; validoHasta: string;
  sinActualizacionAutomatica: boolean;
  candidata: { versionId: string; estadoTecnico: string; subidaEn: string | null; autor: Persona } | null;
};
type Lista = { items: Documento[]; total: number; nextCursor: string | null };
type Accion =
  | { tipo: "rechazar" | "retirar"; doc: Documento }
  | { tipo: "editar"; doc: Documento };

const ESTADOS = ["Pendiente de aprobación", "Publicado", "Vencido", "Derogado"];
const TECNICO = "administrador técnico";

export default function DocumentosAdmin() {
  const [esTecnico, setEsTecnico] = useState(false);
  const [lista, setLista] = useState<Lista | null>(null);
  const [soloMias, setSoloMias] = useState(false);
  const [estado, setEstado] = useState("");
  const [aviso, setAviso] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [errorAccion, setErrorAccion] = useState("");
  const [operaciones, setOperaciones] = useState<string[]>([]);

  const cargar = useCallback(async (cursor?: string) => {
    const q = new URLSearchParams({ limit: "25" });
    if (soloMias) q.set("mine", "true");
    if (estado) q.set("state", estado);
    if (cursor) q.set("cursor", cursor);
    const r = await llamar<Lista>("GET", `/documents?${q}`);
    if (r.ok) { setLista(prev => (cursor && prev ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data)); return; }
    setAviso(mensajeError(r.error, r.status));
  }, [soloMias, estado]);

  useEffect(() => { void consultarSesion().then(c => { if (c.estado === "ok") setEsTecnico(c.sesion.cuenta.perfil === TECNICO); }); }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function encolar(ruta: string, cuerpo: object, mensaje: string): Promise<boolean> {
    const r = await llamar<{ operationId: string }>("POST", ruta, cuerpo);
    if (r.ok) { setOperaciones(o => [r.data.operationId, ...o]); setAviso(mensaje); return true; }
    setAviso(mensajeError(r.error, r.status));
    return false;
  }

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accion) return;
    setErrorAccion("");
    const d = new FormData(e.currentTarget);
    const doc = accion.doc;
    if (accion.tipo === "editar") {
      const cambios: Record<string, string> = {};
      for (const k of ["title", "type", "direction", "publicUrl", "associatedProcedure", "version", "updatedDate", "validUntil"]) {
        const v = String(d.get(k) ?? "").trim();
        if (v) cambios[k] = v;
      }
      const r = await llamar<{ revision: string }>("PATCH", `/documents/${doc.id}/metadata`, { expectedRevision: doc.revision, changes: cambios });
      if (r.ok) { setAccion(null); setAviso("Metadata actualizada; la siguiente consulta ya la usa."); await cargar(); return; }
      setErrorAccion(r.error.mensaje);
      return;
    }
    const motivo = String(d.get("motivo") ?? "").trim();
    if (!motivo) { setErrorAccion("El motivo es obligatorio."); return; }
    const cuerpo = accion.tipo === "retirar"
      ? { expectedRevision: doc.revision, motivo, confirmedDocumentId: doc.id }
      : { expectedRevision: doc.revision, motivo };
    const r = await llamar<{ operationId: string }>("POST", `/documents/${doc.id}/${accion.tipo === "retirar" ? "withdraw" : "reject"}`, cuerpo);
    if (r.ok) { setOperaciones(o => [r.data.operationId, ...o]); setAccion(null); setAviso("Operación aceptada; el documento se elimina por completo al terminar."); await cargar(); return; }
    setErrorAccion(r.error.mensaje);
  }

  const columnas = [
    { clave: "codigo", titulo: "Código", render: (d: Documento) => d.codigo },
    { clave: "nombre", titulo: "Nombre", render: (d: Documento) => d.nombre },
    { clave: "tipo", titulo: "Tipo", render: (d: Documento) => d.tipo },
    { clave: "direccion", titulo: "Dirección", render: (d: Documento) => d.direccion },
    { clave: "enlace", titulo: "Enlace", render: (d: Documento) => <a href={d.enlace} rel="noreferrer noopener" target="_blank">{d.enlace}</a> },
    { clave: "estado", titulo: "Estado", render: (d: Documento) => (
      <>{d.estado}{d.candidata && d.estado !== "Pendiente de aprobación" ? " · con versión pendiente" : ""}
        {d.candidata && d.candidata.estadoTecnico !== "procesado" ? ` (${d.candidata.estadoTecnico === "en_cola" || d.candidata.estadoTecnico === "procesando" ? "procesando" : "no publicable"})` : ""}
        {d.sinActualizacionAutomatica ? " · Sin actualización automática" : ""}</>) },
    { clave: "version", titulo: "Versión", render: (d: Documento) => d.version },
    { clave: "fechaActualizacion", titulo: "Actualización", render: (d: Documento) => d.fechaActualizacion },
    { clave: "formato", titulo: "Formato", render: (d: Documento) => d.formatoOriginal },
    { clave: "ocr", titulo: "OCR", render: (d: Documento) => d.usoOcr },
    { clave: "carga", titulo: "Carga", render: (d: Documento) => d.fechaCarga },
    { clave: "procedimiento", titulo: "Procedimiento", render: (d: Documento) => d.procedimientoOrigen },
    { clave: "origen", titulo: "Origen", render: (d: Documento) => (d.origen === "manual" ? `Manual · ${d.autor?.nombre ?? "—"}` : "Scraper") },
    { clave: "validez", titulo: "Válido hasta", render: (d: Documento) => d.validoHasta },
    ...(esTecnico ? [{ clave: "acciones", titulo: "Acciones", render: (d: Documento) => (
      <div className="admin-acciones">
        {d.candidata?.estadoTecnico === "procesado" && (
          <button type="button" className="button" onClick={() => { void encolar(`/documents/${d.id}/publish`, { expectedRevision: d.revision }, `Publicación de «${d.nombre}» aceptada: está En curso.`).then(() => cargar()); }}>
            Publicar {d.nombre}
          </button>)}
        {d.candidata && <button type="button" className="button" onClick={() => { setErrorAccion(""); setAccion({ tipo: "rechazar", doc: d }); }}>Rechazar {d.nombre}</button>}
        {d.estado !== "Pendiente de aprobación" && d.estado !== "Derogado" && (
          <button type="button" className="button" onClick={() => { setErrorAccion(""); setAccion({ tipo: "retirar", doc: d }); }}>Retirar {d.nombre}</button>)}
        <button type="button" className="button" onClick={() => { setErrorAccion(""); setAccion({ tipo: "editar", doc: d }); }}>Editar {d.nombre}</button>
      </div>) }] : []),
  ];

  return (
    <main className="admin-main admin-main-wide">
      <h1>Documentos</h1>
      <p role="status" className="admin-aviso">{aviso}</p>
      {operaciones.map(id => <DocumentOperationStatus key={id} operationId={id} onTerminada={() => { void cargar(); }} />)}

      {esTecnico && (
        <section aria-labelledby="h-reindex">
          <h2 id="h-reindex">Reindexación</h2>
          <button type="button" className="button" onClick={() => { void encolar("/reindexations", {}, "Reindexación aceptada: está En curso."); }}>Reindexar toda la base</button>
        </section>
      )}

      <section aria-labelledby="h-carga">
        <h2 id="h-carga">Cargar un documento</h2>
        <DocumentUploadForm onCargado={m => { setAviso(m); void cargar(); }} />
      </section>

      <section aria-labelledby="h-matriz">
        <h2 id="h-matriz">Matriz documental{lista ? ` (${lista.total})` : ""}</h2>
        <div className="admin-filtros">
          <label><input type="checkbox" checked={soloMias} onChange={e => setSoloMias(e.target.checked)} /> Solo mis cargas</label>
          <Campo id="filtro-estado" etiqueta="Estado">
            {p => <select {...p} className="input" value={estado} onChange={e => setEstado(e.target.value)}>
              <option value="">Todos</option>{ESTADOS.map(s => <option key={s}>{s}</option>)}</select>}
          </Campo>
        </div>
        {lista && <AdminTable<Documento> titulo="Matriz documental" filas={lista.items} clave={d => d.id} columnas={columnas} />}
        {lista?.nextCursor && <button type="button" className="button" onClick={() => { void cargar(lista.nextCursor!); }}>Cargar más documentos</button>}
      </section>

      <AdminDialog abierto={!!accion} onCancelar={() => setAccion(null)}
        titulo={!accion ? "" : accion.tipo === "retirar" ? "Retirar documento" : accion.tipo === "rechazar" ? "Rechazar documento" : "Editar metadata"}>
        {accion && (
          <form className="admin-form" noValidate onSubmit={confirmar}>
            {accion.tipo !== "editar" ? (
              <>
                <p>
                  {accion.tipo === "retirar"
                    ? `Se eliminará «${accion.doc.nombre}» de la matriz y de la base. Solo quedará un registro con el motivo.`
                    : `Se descartará la versión pendiente de «${accion.doc.nombre}». Si había una publicada, sigue respondiendo.`}
                </p>
                <Campo id="motivo" etiqueta="Motivo (obligatorio)" error={errorAccion || undefined}>
                  {p => <textarea {...p} name="motivo" className="input" rows={3} required />}
                </Campo>
              </>
            ) : (
              <>
                <p>Deje vacío lo que no desea cambiar. El código y el contenido no se editan.</p>
                <Campo id="ed-title" etiqueta="Título">{p => <input {...p} name="title" className="input" />}</Campo>
                <Campo id="ed-type" etiqueta="Tipo">{p => <select {...p} name="type" className="input" defaultValue=""><option value="">Sin cambio</option>{TIPOS.map(t => <option key={t}>{t}</option>)}</select>}</Campo>
                <Campo id="ed-direction" etiqueta="Dirección">{p => <select {...p} name="direction" className="input" defaultValue=""><option value="">Sin cambio</option>{DIRECCIONES.map(t => <option key={t}>{t}</option>)}</select>}</Campo>
                <Campo id="ed-publicUrl" etiqueta="Enlace público (https)">{p => <input {...p} name="publicUrl" type="url" className="input" />}</Campo>
                <Campo id="ed-associatedProcedure" etiqueta="Procedimiento asociado">{p => <input {...p} name="associatedProcedure" className="input" />}</Campo>
                <Campo id="ed-version" etiqueta="Versión">{p => <input {...p} name="version" className="input" />}</Campo>
                <Campo id="ed-updatedDate" etiqueta="Fecha de actualización">{p => <input {...p} name="updatedDate" type="date" className="input" />}</Campo>
                <Campo id="ed-validUntil" etiqueta="Válido hasta" error={errorAccion || undefined}>{p => <input {...p} name="validUntil" type="date" className="input" />}</Campo>
              </>
            )}
            <div className="admin-acciones">
              <button type="submit" className="button">Confirmar</button>
              <button type="button" className="button" onClick={() => setAccion(null)}>Cancelar</button>
            </div>
          </form>
        )}
      </AdminDialog>
    </main>
  );
}
