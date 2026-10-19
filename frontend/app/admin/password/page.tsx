"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ErrorSummary } from "../../../admin/AdminForm";
import { cargarSesion, llamar, type ErrorApi } from "../../../shared/adminSession";
import { pantallaInicial } from "../../../admin/contracts";

const MIN = 12;

export default function CambiarContrasena() {
  const [listo, setListo] = useState(false);
  const [obligatorio, setObligatorio] = useState(false);
  const [destino, setDestino] = useState("/admin/accounts");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");

  useEffect(() => {
    void cargarSesion().then(s => {
      if (!s) { window.location.assign("/admin/login"); return; }
      setObligatorio(s.mustChangePassword);
      setDestino(pantallaInicial(s.cuenta.perfil));
      setListo(true);
    });
  }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const nueva = String(d.get("newPassword") ?? "");
    const errs: Record<string, string> = {};
    if ([...nueva].length < MIN) errs.newPassword = `Use al menos ${MIN} caracteres.`;
    if (nueva !== d.get("confirm")) errs.confirm = "La confirmación no coincide.";
    setErrores(errs);
    setGeneral("");
    if (Object.keys(errs).length) { document.getElementById(Object.keys(errs)[0] === "confirm" ? "confirm" : "newPassword")?.focus(); return; }
    const r = await llamar<void>("POST", "/password", { currentPassword: d.get("currentPassword"), newPassword: nueva });
    if (!r.ok) {
      const err: ErrorApi = r.error;
      if (err.campo) { setErrores({ [err.campo === "currentPassword" ? "currentPassword" : "newPassword"]: err.mensaje }); }
      else setGeneral(err.mensaje);
      return;
    }
    window.location.assign(destino);
  }

  if (!listo) return <main className="admin-main"><p role="status">Cargando…</p></main>;
  return (
    <main className="admin-main">
      <h1 tabIndex={-1}>Cambiar contraseña</h1>
      <p>Todos los campos son obligatorios.</p>
      <ErrorSummary errores={errores} />
      {obligatorio && <p>Su contraseña es temporal. Debe cambiarla para continuar.</p>}
      <form onSubmit={enviar} className="admin-form" noValidate>
        {general && <p role="alert" className="admin-error">{general}</p>}
        {([
          ["currentPassword", "Contraseña actual", "current-password"],
          ["newPassword", `Nueva contraseña (mínimo ${MIN} caracteres)`, "new-password"],
          ["confirm", "Confirmar nueva contraseña", "new-password"],
        ] as const).map(([id, etiqueta, auto]) => (
          <div key={id}>
            <label htmlFor={id}>{etiqueta}</label>
            <input id={id} name={id} type="password" autoComplete={auto} required className="input"
              aria-invalid={errores[id] ? true : undefined} aria-describedby={errores[id] ? `${id}-error` : undefined} />
            {errores[id] && <p id={`${id}-error`} className="admin-error" role="alert">{errores[id]}</p>}
          </div>
        ))}
        <button className="button" type="submit">Guardar contraseña</button>
      </form>
    </main>
  );
}
