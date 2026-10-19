"use client";

import { useState, type FormEvent } from "react";
import { Campo, ErrorSummary } from "./AdminForm";
import { subirArchivo } from "./adminClient";

export const TIPOS = ["Procedimiento", "Formato", "Norma", "Página", "Documento"] as const;
export const DIRECCIONES = ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental", "Secretaría (general)"] as const;

const ETIQUETA_CAMPO: Record<string, string> = {
  type: "tipo", title: "título", direction: "dirección", publicUrl: "enlace público",
  associatedProcedure: "procedimiento asociado", code: "código", version: "versión",
  updatedDate: "fecha de actualización", validUntil: "válido hasta", file: "archivo", metadata: "datos del documento",
};

/** Formulario de carga manual: metadata JSON primero y luego el archivo (contrato multipart). */
export default function DocumentUploadForm({ onCargado }: { onCargado: (mensaje: string) => void }) {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [general, setGeneral] = useState("");

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    const form = e.currentTarget;
    const d = new FormData(form);
    const archivo = d.get("file");
    const metadata: Record<string, string> = {};
    for (const k of ["type", "title", "direction", "publicUrl", "associatedProcedure", "code", "version", "updatedDate", "validUntil"]) {
      const v = String(d.get(k) ?? "").trim();
      if (v) metadata[k] = v;
    }
    setErrores({}); setGeneral("");
    if (!(archivo instanceof File) || archivo.size === 0) { setErrores({ file: "Seleccione un archivo PDF, DOCX o XLSX." }); return; }
    const envio = new FormData();
    envio.append("metadata", JSON.stringify(metadata));
    envio.append("file", archivo);
    setEnviando(true);
    const r = await subirArchivo<{ id: string; estado: string }>("/documents", envio);
    setEnviando(false);
    if (r.ok) {
      form.reset();
      onCargado(`Documento cargado como «${r.data.estado}». Aún no es recuperable por el chat.`);
      return;
    }
    if (r.error.campo) {
      setErrores({ [r.error.campo]: r.error.mensaje });
      document.getElementById(`carga-${r.error.campo}`)?.focus();
    } else setGeneral(r.error.mensaje);
  }

  return (
    <form className="admin-form" noValidate onSubmit={enviar} aria-label="Cargar un documento">
      <p>Los campos marcados con * son obligatorios.</p>
      <ErrorSummary errores={errores} prefijo="carga-" />
      {general && <p role="alert" className="admin-error">{general}</p>}
      <Campo id="carga-file" etiqueta="Archivo (PDF, DOCX o XLSX)" error={errores.file}>
        {p => <input {...p} name="file" type="file" accept=".pdf,.docx,.xlsx" required />}
      </Campo>
      <Campo id="carga-type" etiqueta="Tipo" error={errores.type}>
        {p => <select {...p} name="type" required className="input" defaultValue="Documento">{TIPOS.map(t => <option key={t}>{t}</option>)}</select>}
      </Campo>
      <Campo id="carga-title" etiqueta="Título" error={errores.title}>
        {p => <input {...p} name="title" className="input" required />}
      </Campo>
      <Campo id="carga-direction" etiqueta="Dirección" error={errores.direction}>
        {p => <select {...p} name="direction" required className="input" defaultValue="">
          <option value="" disabled>Seleccione…</option>{DIRECCIONES.map(t => <option key={t}>{t}</option>)}</select>}
      </Campo>
      <Campo id="carga-publicUrl" etiqueta="Enlace público (https)" error={errores.publicUrl}>
        {p => <input {...p} name="publicUrl" type="url" className="input" required />}
      </Campo>
      <Campo id="carga-associatedProcedure" etiqueta="Procedimiento asociado" ayuda="Código del procedimiento (por ejemplo GT-P-004) o «ninguno»." error={errores.associatedProcedure}>
        {p => <input {...p} name="associatedProcedure" className="input" defaultValue="ninguno" required />}
      </Campo>
      <Campo id="carga-code" etiqueta="Código del documento (opcional)" ayuda="Si lo deja vacío se mostrará N/A." error={errores.code}>
        {p => <input {...p} name="code" className="input" />}
      </Campo>
      <Campo id="carga-version" etiqueta="Versión (opcional)" error={errores.version}>
        {p => <input {...p} name="version" className="input" />}
      </Campo>
      <Campo id="carga-updatedDate" etiqueta="Fecha de actualización (opcional)" error={errores.updatedDate}>
        {p => <input {...p} name="updatedDate" type="date" className="input" />}
      </Campo>
      <Campo id="carga-validUntil" etiqueta="Válido hasta (opcional)" ayuda="Pasado ese día el documento deja de usarse en las respuestas." error={errores.validUntil}>
        {p => <input {...p} name="validUntil" type="date" className="input" />}
      </Campo>
      <button className="button" type="submit" disabled={enviando}>{enviando ? "Cargando…" : "Cargar documento"}</button>
      {Object.keys(errores).length > 0 && (
        <p className="sr-only" role="status">
          Revise: {Object.keys(errores).map(c => ETIQUETA_CAMPO[c] ?? c).join(", ")}.
        </p>
      )}
    </form>
  );
}
