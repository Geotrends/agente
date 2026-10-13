"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AdminDialog from "../../../admin/AdminDialog";
import { Campo } from "../../../admin/AdminForm";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";

type Perfil = "administrador técnico" | "Gestor documental";
type Cuenta = { id: string; nombre: string; email: string; perfil: Perfil; activa: boolean; cambioObligatorio: boolean; revision: string };
type Lista = { items: Cuenta[]; total: number; nextCursor: string | null };
type Accion =
  | { tipo: "estado"; cuenta: Cuenta }
  | { tipo: "perfil"; cuenta: Cuenta; nuevo: Perfil }
  | { tipo: "temporal"; cuenta: Cuenta };

const PERFILES: Perfil[] = ["administrador técnico", "Gestor documental"];

export default function CuentasAdmin() {
  const [lista, setLista] = useState<Lista | null>(null);
  const [aviso, setAviso] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [accion, setAccion] = useState<Accion | null>(null);
  const [errorAccion, setErrorAccion] = useState("");

  const cargar = useCallback(async (cursor?: string) => {
    const r = await llamar<Lista>("GET", `/accounts?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (r.ok) { setLista(prev => (cursor && prev ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data)); return; }
    setAviso(mensajeError(r.error, r.status));
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function crear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setErrores({}); setAviso("");
    const r = await llamar<Cuenta>("POST", "/accounts", {
      nombre: d.get("nombre"), email: d.get("email"), perfil: d.get("perfil"), password: d.get("password"),
    });
    if (r.ok) { form.reset(); setAviso(`Cuenta creada para ${r.data.email}. Deberá cambiar la contraseña al ingresar.`); await cargar(); return; }
    if (r.error.campo) { setErrores({ [r.error.campo]: r.error.mensaje }); document.getElementById(`cuenta-${r.error.campo}`)?.focus(); }
    else setAviso(mensajeError(r.error, r.status));
  }

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accion) return;
    const c = accion.cuenta;
    setErrorAccion("");
    const d = new FormData(e.currentTarget);
    let r;
    if (accion.tipo === "estado") r = await llamar("PATCH", `/accounts/${c.id}`, { expectedRevision: c.revision, active: !c.activa });
    else if (accion.tipo === "perfil") r = await llamar("PATCH", `/accounts/${c.id}`, { expectedRevision: c.revision, perfil: accion.nuevo });
    else r = await llamar("POST", `/accounts/${c.id}/temporary-password`, { expectedRevision: c.revision, password: d.get("password") });
    if (r.ok) {
      setAccion(null);
      setAviso(accion.tipo === "temporal" ? `Contraseña temporal asignada a ${c.email}.` : "Cambio aplicado.");
      await cargar();
      return;
    }
    setErrorAccion(r.error.mensaje || mensajeError(r.error, r.status));
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1>Cuentas</h1>
      <p role="status" className="admin-aviso">{aviso}</p>

      <section aria-labelledby="h-nueva">
        <h2 id="h-nueva">Crear cuenta</h2>
        <form className="admin-form" noValidate onSubmit={crear}>
          <Campo id="cuenta-nombre" etiqueta="Nombre" error={errores.nombre}>
            {p => <input {...p} name="nombre" className="input" autoComplete="off" required />}
          </Campo>
          <Campo id="cuenta-email" etiqueta="Correo electrónico" error={errores.email}>
            {p => <input {...p} name="email" type="email" className="input" autoComplete="off" required />}
          </Campo>
          <Campo id="cuenta-perfil" etiqueta="Perfil" error={errores.perfil}>
            {p => <select {...p} name="perfil" className="input" defaultValue="Gestor documental">{PERFILES.map(x => <option key={x}>{x}</option>)}</select>}
          </Campo>
          <Campo id="cuenta-password" etiqueta="Contraseña inicial" ayuda="Mínimo 12 caracteres. La persona deberá cambiarla al ingresar." error={errores.password}>
            {p => <input {...p} name="password" type="password" className="input" autoComplete="new-password" required />}
          </Campo>
          <button className="button" type="submit">Crear cuenta</button>
        </form>
      </section>

      <section aria-labelledby="h-lista">
        <h2 id="h-lista">Cuentas existentes{lista ? ` (${lista.total})` : ""}</h2>
        {lista && (
          <AdminTable<Cuenta> titulo="Cuentas del panel" filas={lista.items} clave={c => c.id}
            columnas={[
              { clave: "nombre", titulo: "Nombre", render: c => c.nombre },
              { clave: "email", titulo: "Correo", render: c => c.email },
              { clave: "perfil", titulo: "Perfil", render: c => c.perfil },
              { clave: "estado", titulo: "Estado", render: c => (c.activa ? "Activa" : "Desactivada") + (c.cambioObligatorio ? " · cambio de contraseña pendiente" : "") },
              { clave: "acciones", titulo: "Acciones", render: c => (
                <div className="admin-acciones">
                  <button type="button" className="button" onClick={() => { setErrorAccion(""); setAccion({ tipo: "estado", cuenta: c }); }}>
                    {c.activa ? "Desactivar" : "Reactivar"} {c.email}
                  </button>
                  <button type="button" className="button"
                    onClick={() => { setErrorAccion(""); setAccion({ tipo: "perfil", cuenta: c, nuevo: c.perfil === "administrador técnico" ? "Gestor documental" : "administrador técnico" }); }}>
                    Cambiar perfil de {c.email}
                  </button>
                  <button type="button" className="button" onClick={() => { setErrorAccion(""); setAccion({ tipo: "temporal", cuenta: c }); }}>
                    Asignar contraseña temporal a {c.email}
                  </button>
                </div>
              ) },
            ]} />
        )}
        {lista?.nextCursor && <button type="button" className="button" onClick={() => { void cargar(lista.nextCursor!); }}>Cargar más cuentas</button>}
      </section>

      <AdminDialog abierto={!!accion} titulo={
        !accion ? "" : accion.tipo === "estado" ? (accion.cuenta.activa ? "Desactivar cuenta" : "Reactivar cuenta")
          : accion.tipo === "perfil" ? "Cambiar perfil" : "Asignar contraseña temporal"}
        onCancelar={() => setAccion(null)}>
        {accion && (
          <form onSubmit={confirmar} className="admin-form" noValidate>
            <p>
              {accion.tipo === "estado" && (accion.cuenta.activa
                ? `Se cerrarán las sesiones de ${accion.cuenta.email} y no podrá iniciar sesión. La cuenta y su historial se conservan.`
                : `${accion.cuenta.email} recuperará su perfil, pero deberá iniciar sesión de nuevo.`)}
              {accion.tipo === "perfil" && `${accion.cuenta.email} pasará de «${accion.cuenta.perfil}» a «${accion.nuevo}» y se cerrarán sus sesiones.`}
              {accion.tipo === "temporal" && `La persona deberá cambiarla en su próximo ingreso y se cerrarán sus sesiones.`}
            </p>
            {accion.tipo === "temporal" && (
              <Campo id="temporal-password" etiqueta="Contraseña temporal" ayuda="Mínimo 12 caracteres." error={errorAccion || undefined}>
                {p => <input {...p} name="password" type="password" className="input" autoComplete="new-password" required />}
              </Campo>
            )}
            {accion.tipo !== "temporal" && errorAccion && <p role="alert" className="admin-error">{errorAccion}</p>}
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
