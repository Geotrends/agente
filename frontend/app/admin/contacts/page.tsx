"use client";

import { useState, useRef, type FormEvent } from "react";
import { useAdminQuery, QueryState } from "../../../admin/useAdminQuery";
import { ErrorSummary } from "../../../admin/AdminForm";
import { cerrarSesion, llamar } from "../../../shared/adminSession";

type Canal = { id: string; name: string; description: string; type: "teléfono" | "correo" | "url"; value: string; position: number };
type Contactos = {
  revision: number;
  recepcion: { pqrsd: string; whatsapp: string; email: string } | null;
  general: { phone: string; email: string; url: string } | null;
  inmediatos: Canal[];
};
type Errores = Record<string, string>;

export default function ContactosAdmin() {
  const { data: datos, busy: cargando, error, announcement, cargar } = useAdminQuery<Contactos>("/contacts");
  const guardandoRef = useRef(false);
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState("");

  /** Guarda y maneja 422 (errores por campo) y 409 (revisión): nunca pierde lo que la persona escribió. */
  async function guardar(clave: string, metodo: string, ruta: string, cuerpo: object) {
    if (guardandoRef.current) return false;
    guardandoRef.current = true; setGuardando(true);
    setAviso(""); setErrores({});
    const r = await llamar<{ revision: number }>(metodo, ruta, { ...cuerpo, revision: datos?.revision ?? 0 });
    guardandoRef.current = false; setGuardando(false);
    if (r.ok) { setAviso("Cambios guardados."); await cargar(); return true; }
    if (r.status === 422 && r.error.campo) setErrores({ [`${clave}.${r.error.campo}`]: r.error.mensaje });
    else if (r.status === 409) setAviso("Otra persona modificó los contactos. Sus cambios siguen en el formulario; recargue los datos y vuelva a guardar.");
    else setAviso(r.error.mensaje);
    return false;
  }

  if (!datos) return <main className="admin-main"><h1>Contactos oficiales</h1><QueryState busy={cargando} error={error} retry={cargar} /></main>;

  const campo = (clave: string, id: string, etiqueta: string, valor: string, extra: { type?: string } = {}) => (
    <div key={id}>
      <label htmlFor={`${clave}-${id}`}>{etiqueta}</label>
      <input id={`${clave}-${id}`} name={id} defaultValue={valor} type={extra.type ?? "text"} required className="input"
        aria-invalid={errores[`${clave}.${id}`] ? true : undefined} aria-describedby={errores[`${clave}.${id}`] ? `${clave}-${id}-error` : undefined} />
      {errores[`${clave}.${id}`] && <p id={`${clave}-${id}-error`} className="admin-error" role="alert">{errores[`${clave}.${id}`]}</p>}
    </div>
  );
  const leer = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)); };

  return (
    <main className="admin-main">
      <h1>Contactos oficiales</h1>
      <QueryState busy={cargando} error={error} announcement={announcement} retry={cargar} />
      <p>Todos los campos de los formularios son obligatorios.</p>
      <ErrorSummary errores={errores} idCampo={key => key.replace(/\.([^.]*)$/, "-$1")} />
      <p>Revisión actual: {datos.revision}. Los cambios se ven en la siguiente respuesta del chat.</p>
      <p role="status" className="admin-aviso">{aviso}</p>

      <section aria-labelledby="h-recepcion">
        <h2 id="h-recepcion">Canales de recepción</h2>
        <form className="admin-form" noValidate onSubmit={e => { const c = leer(e); void guardar("recepcion", "PUT", "/contacts/reception", c); }}>
          {campo("recepcion", "pqrsd", "Enlace de PQRSD (https)", datos.recepcion?.pqrsd ?? "", { type: "url" })}
          {campo("recepcion", "whatsapp", "WhatsApp", datos.recepcion?.whatsapp ?? "")}
          {campo("recepcion", "email", "Correo", datos.recepcion?.email ?? "", { type: "email" })}
          <button className="button" disabled={guardando} type="submit">Guardar recepción</button>
        </form>
      </section>

      <section aria-labelledby="h-general">
        <h2 id="h-general">Contacto general</h2>
        <form className="admin-form" noValidate onSubmit={e => { const c = leer(e); void guardar("general", "PUT", "/contacts/general", { phone: c.phone, email: c.email, url: c.url }); }}>
          {campo("general", "phone", "Teléfono", datos.general?.phone ?? "")}
          {campo("general", "email", "Correo", datos.general?.email ?? "", { type: "email" })}
          {campo("general", "url", "Página de contacto (https)", datos.general?.url ?? "", { type: "url" })}
          <button className="button" disabled={guardando} type="submit">Guardar contacto general</button>
        </form>
      </section>

      <section aria-labelledby="h-inmediatos">
        <h2 id="h-inmediatos">Atención inmediata</h2>
        <ol className="admin-lista">
          {datos.inmediatos.map((c, i) => (
            <li key={c.id}>
              <form className="admin-form" noValidate onSubmit={e => { const f = leer(e); void guardar(`im-${c.id}`, "PUT", `/contacts/immediate/${c.id}`, f); }}>
                <h3>Canal {i + 1}</h3>
                {campo(`im-${c.id}`, "name", "Nombre", c.name)}
                {campo(`im-${c.id}`, "description", "Descripción (máximo 120 caracteres)", c.description)}
                <label htmlFor={`im-${c.id}-type`}>Tipo</label>
                <select id={`im-${c.id}-type`} name="type" defaultValue={c.type} className="input" aria-invalid={errores[`im-${c.id}.type`] ? true : undefined} aria-describedby={errores[`im-${c.id}.type`] ? `im-${c.id}-type-error` : undefined}>
                  <option>teléfono</option><option>correo</option><option>url</option>
                </select>
                {errores[`im-${c.id}.type`] && <p role="alert" id={`im-${c.id}-type-error`}>{errores[`im-${c.id}.type`]}</p>}
                {campo(`im-${c.id}`, "value", "Valor", c.value)}
                <div className="admin-acciones">
                  <button className="button" disabled={guardando} type="submit">Guardar canal {i + 1}</button>
                  <button className="button" type="button" disabled={guardando || i === 0}
                    onClick={() => { const ids = datos.inmediatos.map(x => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; void guardar("orden", "PUT", "/contacts/immediate/order", { ids }); }}>Subir canal {i + 1}</button>
                  <button className="button button-danger" type="button" disabled={guardando || datos.inmediatos.length <= 1}
                    onClick={() => { void guardar("elim", "DELETE", `/contacts/immediate/${c.id}`, {}); }}>Eliminar canal {i + 1}</button>
                </div>
              </form>
            </li>
          ))}
        </ol>
        <h3>Agregar canal</h3>
        <form className="admin-form" noValidate onSubmit={async e => { const f = leer(e); const form = e.currentTarget; if (await guardar("nuevo", "POST", "/contacts/immediate", f)) form.reset(); }}>
          {campo("nuevo", "name", "Nombre", "")}
          {campo("nuevo", "description", "Descripción (máximo 120 caracteres)", "")}
          <label htmlFor="nuevo-type">Tipo</label>
          <select id="nuevo-type" name="type" defaultValue="teléfono" className="input" aria-invalid={errores["nuevo.type"] ? true : undefined} aria-describedby={errores["nuevo.type"] ? "nuevo-type-error" : undefined}><option>teléfono</option><option>correo</option><option>url</option></select>
          {errores["nuevo.type"] && <p role="alert" id="nuevo-type-error">{errores["nuevo.type"]}</p>}
          {campo("nuevo", "value", "Valor", "")}
          <button className="button" disabled={guardando} type="submit">Agregar canal</button>
        </form>
      </section>

      <p><button className="button" type="button" onClick={() => { void cerrarSesion().then(() => window.location.assign("/admin/login")); }}>Cerrar sesión</button></p>
    </main>
  );
}
