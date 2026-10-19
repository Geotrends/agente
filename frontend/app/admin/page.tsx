"use client";

import { useEffect } from "react";
import { cargarSesion } from "../../shared/adminSession";
import { pantallaInicial } from "../../admin/contracts";

/**
 * Entrada `/admin`. El cascarón solo pinta este contenido con sesión válida (sin sesión ya envía a
 * `/admin/login`), así que aquí se lleva a la persona a su pantalla inicial.
 */
export default function AdminInicio() {
  useEffect(() => {
    void cargarSesion().then(s => { window.location.replace(s ? pantallaInicial(s.cuenta.perfil) : "/admin/login"); });
  }, []);
  return <main className="admin-main"><p role="status">Redirigiendo…</p></main>;
}
