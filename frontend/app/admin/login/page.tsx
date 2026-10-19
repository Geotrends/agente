"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { llamar, mensajeLimite, recordarSesion, type SesionAdmin } from "../../../shared/adminSession";
import { pantallaInicial } from "../../../admin/contracts";

export default function LoginAdmin() {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const correo = useRef<HTMLInputElement>(null);
  const [expirada, setExpirada] = useState(false);
  useEffect(() => { setExpirada(new URLSearchParams(window.location.search).get("expirada") === "1"); }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    setError("");
    setEnviando(true);
    const r = await llamar<SesionAdmin>("POST", "/session", { email: datos.get("email"), password: datos.get("password") });
    setEnviando(false);
    if (!r.ok) {
      setError(r.status === 429 ? mensajeLimite(r.retryAfter) : r.status === 401 ? "Correo o contraseña incorrectos." : r.error.mensaje);
      correo.current?.focus();
      return;
    }
    recordarSesion(r.data);
    window.location.assign(r.data.mustChangePassword ? "/admin/password" : pantallaInicial(r.data.cuenta.perfil));
  }

  return (
    <main className="admin-main admin-login">
      <div className="admin-login-tarjeta">
        <p className="admin-login-rotulo">Panel administrativo</p>
        <h1>Panel de Geobot</h1>
        <p className="admin-login-ayuda">
          Gestión del asistente del Observatorio Ambiental de Envigado: documentos, contactos, tarifas y métricas.
          Ingrese con su cuenta autorizada.
        </p>
      {expirada && <p role="status" className="admin-aviso">Su sesión se cerró por inactividad. Ingrese de nuevo.</p>}
      <form onSubmit={enviar} className="admin-form" noValidate>
        {error && <p role="alert" className="admin-error" id="login-error">{error}</p>}
        <label htmlFor="email">Correo electrónico</label>
        <input id="email" name="email" type="email" autoComplete="username" required ref={correo} className="input"
          aria-describedby={error ? "login-error" : undefined} />
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        <button className="button" type="submit" disabled={enviando}>{enviando ? "Ingresando…" : "Ingresar"}</button>
      </form>
      </div>
    </main>
  );
}
