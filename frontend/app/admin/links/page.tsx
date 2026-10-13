"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AdminDialog from "../../../admin/AdminDialog";
import { Campo } from "../../../admin/AdminForm";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";
import { DIRECCIONES } from "../../../admin/DocumentEditor";

type Enlace = { id: string; url: string; fuente: string; direccion: string; justificacion: string; revision: string; cambiadoPor: string | null; cambiadoEn: string };
const fecha = (iso: string) => new Date(iso).toLocaleString("es-CO");

export default function EnlacesAdmin() {
  const [items, setItems] = useState<Enlace[] | null>(null);
  const [listRevision, setListRevision] = useState("1");
  const [aviso, setAviso] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [quitar, setQuitar] = useState<Enlace | null>(null);
  const [errorQuita, setErrorQuita] = useState("");

  const cargar = useCallback(async () => {
    const r = await llamar<{ items: Enlace[]; listRevision: string }>("GET", "/scraper-links");
    if (r.ok) { setItems(r.data.items); setListRevision(r.data.listRevision); } else setAviso(mensajeError(r.error, r.status));
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function agregar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setErrores({}); setAviso("");
    const r = await llamar("POST", "/scraper-links", {
      url: d.get("url"), direction: d.get("direction") || undefined, justification: d.get("justification"), expectedListRevision: listRevision,
    });
    if (r.ok) { form.reset(); setAviso("Enlace agregado; se aplica desde la siguiente ejecución del scraper."); await cargar(); return; }
    if (r.error.campo) { setErrores({ [r.error.campo]: r.error.mensaje }); document.getElementById(`enl-${r.error.campo}`)?.focus(); }
    else setAviso(mensajeError(r.error, r.status));
  }

  async function confirmarQuita(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!quitar) return;
    const justification = String(new FormData(e.currentTarget).get("justification") ?? "").trim();
    if (!justification) { setErrorQuita("La justificación es obligatoria."); return; }
    const r = await llamar<{ documentosAfectados: number }>("DELETE", `/scraper-links/${quitar.id}`, {
      direction: quitar.direccion, justification, expectedRevision: quitar.revision, expectedListRevision: listRevision,
    });
    if (r.ok) {
      setQuitar(null);
      setAviso(r.data.documentosAfectados
        ? `Enlace quitado. ${r.data.documentosAfectados} documentos siguen publicados «Sin actualización automática»; se generó un aviso.`
        : "Enlace quitado. No había documentos publicados de ese enlace.");
      await cargar();
      return;
    }
    setErrorQuita(r.error.mensaje);
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1>Enlaces del scraper</h1>
      <p>La lista de hosts permitidos se define en la configuración desplegada y no se edita aquí.</p>
      <p role="status" className="admin-aviso">{aviso}</p>
      <section aria-labelledby="h-add-enlace">
        <h2 id="h-add-enlace">Agregar enlace</h2>
        <form className="admin-form" noValidate onSubmit={agregar}>
          <Campo id="enl-url" etiqueta="URL completa (https)" error={errores.url}>{p => <input {...p} name="url" type="url" className="input" required />}</Campo>
          <Campo id="enl-direction" etiqueta="Dirección responsable" error={errores.direction}>
            {p => <select {...p} name="direction" className="input" defaultValue=""><option value="" disabled>Seleccione…</option>{DIRECCIONES.map(x => <option key={x}>{x}</option>)}</select>}
          </Campo>
          <Campo id="enl-justification" etiqueta="Justificación" error={errores.justification}>{p => <textarea {...p} name="justification" className="input" rows={2} required />}</Campo>
          <button className="button" type="submit">Agregar enlace</button>
        </form>
      </section>
      <section aria-labelledby="h-enlaces">
        <h2 id="h-enlaces">Enlaces vigentes{items ? ` (${items.length})` : ""}</h2>
        {items && <AdminTable<Enlace> titulo="Enlaces vigentes del scraper" filas={items} clave={e => e.id}
          columnas={[
            { clave: "url", titulo: "URL", render: e => e.url },
            { clave: "fuente", titulo: "Fuente", render: e => e.fuente },
            { clave: "dir", titulo: "Dirección", render: e => e.direccion },
            { clave: "just", titulo: "Justificación", render: e => e.justificacion },
            { clave: "cambio", titulo: "Último cambio", render: e => `${e.cambiadoPor ?? "Semilla inicial"} · ${fecha(e.cambiadoEn)}` },
            { clave: "acc", titulo: "Acciones", render: e => <button type="button" className="button" onClick={() => { setErrorQuita(""); setQuitar(e); }}>Quitar {e.url}</button> },
          ]} />}
      </section>
      <AdminDialog abierto={!!quitar} titulo="Quitar enlace" onCancelar={() => setQuitar(null)}>
        {quitar && (
          <form className="admin-form" noValidate onSubmit={confirmarQuita}>
            <p>Se dejará de verificar {quitar.url}. Los documentos ya publicados se conservan y quedan «Sin actualización automática».</p>
            <Campo id="quita-just" etiqueta="Justificación (obligatoria)" error={errorQuita || undefined}>{p => <textarea {...p} name="justification" className="input" rows={2} required />}</Campo>
            <div className="admin-acciones">
              <button type="submit" className="button">Confirmar</button>
              <button type="button" className="button" onClick={() => setQuitar(null)}>Cancelar</button>
            </div>
          </form>
        )}
      </AdminDialog>
    </main>
  );
}
