"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cerrarSesion, consultarSesion, type SesionAdmin } from "../shared/adminSession";
import { llamar, mensajeError, navegacion } from "./adminClient";
import { NAVEGACION, RUTAS_SIN_SESION, type Contadores } from "./contracts";
import { acquireTracker, releaseTracker } from "./sessionActivity";

const POLL_MS = 30_000;
const RUTA_CAMBIO = "/admin/password";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "listo"; sesion: SesionAdmin }
  | { tipo: "indisponible" };

/**
 * Cascarón del panel: guarda de sesión sin destello (no pinta contenido protegido hasta conocer
 * la sesión), navegación por perfil, contadores autorizados en todas las pantallas y cierre por
 * inactividad humana. La API sigue siendo la autoridad; esto solo evita mostrar lo que no aplica.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const ruta = (usePathname() ?? "").replace(/\/$/, "");
  const publica = RUTAS_SIN_SESION.some(r => ruta.startsWith(r));
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [contadores, setContadores] = useState<Contadores | null>(null);

  useEffect(() => {
    if (publica) return;
    let vivo = true;
    void consultarSesion().then(c => {
      if (!vivo) return;
      if (c.estado === "indisponible") { setEstado({ tipo: "indisponible" }); return; }
      if (c.estado === "sin_sesion") { navegacion.ir("/admin/login"); return; }
      if (c.sesion.mustChangePassword && ruta !== RUTA_CAMBIO) { navegacion.ir(RUTA_CAMBIO); return; }
      setEstado({ tipo: "listo", sesion: c.sesion });
    }).catch(() => { if (vivo) setEstado({ tipo: "indisponible" }); });
    return () => { vivo = false; };
  }, [publica, ruta]);

  const listo = estado.tipo === "listo";
  const cambioPendiente = listo && estado.sesion.mustChangePassword;

  const leerContadores = useCallback(async () => {
    const r = await llamar<Contadores>("GET", "/counters");
    if (r.ok) setContadores(r.data);
    else if (r.status === 503) setEstado({ tipo: "indisponible" });
    else if (r.status === 401) navegacion.ir("/admin/login");
  }, []);

  useEffect(() => {
    if (!listo || cambioPendiente) return;
    const act = acquireTracker();
    void leerContadores();
    const t = setInterval(() => {
      if (act.expired()) {
        void cerrarSesion().finally(() => navegacion.ir("/admin/login?expirada=1"));
        return;
      }
      if (act.pollingAllowed()) void leerContadores();
    }, POLL_MS);
    return () => { clearInterval(t); releaseTracker(); };
  }, [listo, cambioPendiente, leerContadores, ruta]);

  if (publica) return <><a className="sr-only" href="#contenido-admin">Saltar al contenido</a><div id="contenido-admin">{children}</div></>;

  if (estado.tipo === "cargando") {
    return <main className="admin-main"><p role="status">Cargando…</p></main>;
  }
  if (estado.tipo === "indisponible") {
    return (
      <main className="admin-main">
        <h1>Panel de Geobot</h1>
        <p role="alert" className="admin-error">{mensajeError({ codigo: "SERVICIO_NO_DISPONIBLE", mensaje: "" }, 503)}</p>
      </main>
    );
  }

  const { sesion } = estado;
  const visibles = cambioPendiente ? NAVEGACION.filter(i => i.href === RUTA_CAMBIO) : NAVEGACION.filter(i => i.perfiles.includes(sesion.cuenta.perfil));
  return (
    <>
      <a className="sr-only" href="#contenido-admin">Saltar al contenido</a>
      <nav aria-label="Panel de administración" className="admin-nav">
        {visibles.map(item => {
          const n = item.contador && contadores ? contadores[item.contador] : undefined;
          return (
            <a key={item.href} href={item.href} aria-current={ruta.startsWith(item.href) ? "page" : undefined}>
              {item.etiqueta}
              {typeof n === "number" && <span className="admin-badge" aria-label={`${n} pendientes`}> ({n})</span>}
            </a>
          );
        })}
        <button type="button" className="button admin-salir" onClick={() => { void cerrarSesion().finally(() => navegacion.ir("/admin/login")); }}>
          Cerrar sesión
        </button>
      </nav>
      <div id="contenido-admin">{children}</div>
    </>
  );
}
