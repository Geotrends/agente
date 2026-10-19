"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cerrarSesion, consultarSesion, type SesionAdmin } from "../shared/adminSession";
import { llamar, mensajeError, navegacion } from "./adminClient";
import { NAVEGACION, RUTAS_SIN_SESION, type Contadores } from "./contracts";
import AdminDialog from "./AdminDialog";
import { acquireTracker, releaseTracker, currentTracker, SESSION_IDLE_MS } from "./sessionActivity";

const POLL_MS = 30_000;
const RUTA_CAMBIO = "/admin/password";
const GRUPOS: Record<string, string> = { "/admin/documents": "Conocimiento", "/admin/contacts": "Atención", "/admin/notifications": "Supervisión", "/admin/metrics/usage": "Métricas", "/admin/tariffs": "Configuración" };

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
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [advertencia, setAdvertencia] = useState(false);
  const [expirada, setExpirada] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  const [avisoSesion, setAvisoSesion] = useState("");
  const [errorRecuperacion, setErrorRecuperacion] = useState("");
  const [contadores, setContadores] = useState<Contadores | null>(null);

  useEffect(() => {
    const expired = () => setExpirada(true);
    window.addEventListener("admin-session-expired", expired);
    return () => window.removeEventListener("admin-session-expired", expired);
  }, []);

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

  useEffect(() => {
    setMenuAbierto(false);
  }, [ruta, publica]);

  const listo = estado.tipo === "listo";
  const cambioPendiente = listo && estado.sesion.mustChangePassword;

  const leerContadores = useCallback(async () => {
    const r = await llamar<Contadores>("GET", "/counters");
    if (r.ok) { setContadores(r.data); setAvisoSesion(""); }
    else if (r.status !== 401) setAvisoSesion("No se pudieron actualizar los contadores. Sus formularios se conservan; vuelva a intentar.");
    else if (r.status === 401) setExpirada(true);
  }, []);

  useEffect(() => {
    if (!listo || cambioPendiente || expirada) return;
    const refrescar = () => { void leerContadores(); };
    window.addEventListener("admin-contadores", refrescar);
    return () => window.removeEventListener("admin-contadores", refrescar);
  }, [listo, cambioPendiente, expirada, leerContadores]);

  useEffect(() => {
    if (!listo || cambioPendiente || expirada) return;
    const act = acquireTracker();
    void leerContadores();
    let vencida = false;
    const comprobar = setInterval(() => {
      if (vencida) return;
      if (act.expired()) {
        vencida = true; setAdvertencia(false); setExpirada(true);
        void cerrarSesion();
      } else setAdvertencia(act.idleMs() >= SESSION_IDLE_MS - 120_000);
    }, 5_000);
    const t = setInterval(() => { if (!vencida && act.pollingAllowed()) void leerContadores(); }, POLL_MS);
    return () => { clearInterval(t); clearInterval(comprobar); releaseTracker(); };
  }, [listo, cambioPendiente, leerContadores, ruta, expirada]);

  if (publica) return <><a className="admin-saltar" href="#contenido-admin" onClick={() => document.getElementById("contenido-admin")?.focus()}>Saltar al contenido</a><div id="contenido-admin" tabIndex={-1}>{children}</div></>;

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
    <div className="admin-app">
      <a className="admin-saltar" href="#contenido-admin" onClick={() => document.getElementById("contenido-admin")?.focus()}>Saltar al contenido</a>
      <button type="button" className="button admin-menu" aria-expanded={menuAbierto} aria-controls="admin-navegacion" onClick={() => setMenuAbierto(!menuAbierto)}>
        Menú · {NAVEGACION.find(i => i.href === ruta)?.etiqueta ?? "Administración"}
      </button>
      <nav id="admin-navegacion" aria-label="Panel de administración" className={`admin-nav${menuAbierto ? " admin-nav-abierta" : ""}`} inert={expirada}>
        {visibles.map(item => {
          const n = item.contador && contadores ? contadores[item.contador] : undefined;
          return (
            <Fragment key={item.href}>
            {GRUPOS[item.href] && <span className="admin-nav-grupo">{GRUPOS[item.href]}</span>}
            <a href={item.href} aria-current={ruta.startsWith(item.href) ? "page" : undefined}>
              {item.etiqueta}
              {typeof n === "number" && <span className="admin-badge" aria-label={`${n} pendientes`}> ({n})</span>}
            </a>
            </Fragment>
          );
        })}
        <button type="button" className="button admin-salir" onClick={() => { void cerrarSesion().finally(() => navegacion.ir("/admin/login")); }}>
          Cerrar sesión
        </button>
      </nav>
      <div id="contenido-admin" tabIndex={-1} inert={expirada}>
        {avisoSesion && <p role="status" className="admin-sesion-aviso">{avisoSesion} <button className="button button-secondary" onClick={() => { void leerContadores(); }}>Actualizar contadores</button></p>}
        {advertencia && <section className="admin-sesion-aviso" aria-label="Sesión por vencer">
          <p role="alert">Su sesión está por vencer por inactividad. Puede continuar para conservar su trabajo.</p>
          <button className="button" type="button" onClick={() => { void consultarSesion().then(c => {
            if (c.estado === "ok") { currentTracker()?.touch(); setAdvertencia(false); }
            else { setExpirada(true); setAdvertencia(false); }
          }); }}>Continuar sesión</button>
        </section>}
        {children}
      </div>
      <AdminDialog abierto={expirada} titulo="Su sesión venció" onCancelar={() => {}}>
        <p>Sus formularios se conservan en esta pestaña. Ingrese en otra pestaña y vuelva para recuperar su trabajo.</p>
        <a className="button" href="/admin/login" target="_blank" rel="noopener noreferrer">Ingresar en otra pestaña</a>
        <button className="button button-secondary" type="button" disabled={recuperando} onClick={() => {
          setRecuperando(true); setErrorRecuperacion("");
          void consultarSesion().then(c => {
            if (c.estado === "ok" && !c.sesion.mustChangePassword && c.sesion.cuenta.id === sesion.cuenta.id && c.sesion.cuenta.perfil === sesion.cuenta.perfil) { setEstado({ tipo: "listo", sesion: c.sesion }); currentTracker()?.touch(); setExpirada(false); }
            else setErrorRecuperacion("Ingrese con la misma cuenta y complete el cambio de contraseña, si se solicita.");
          }).finally(() => setRecuperando(false));
        }}>Ya ingresé, recuperar formulario</button>
        {errorRecuperacion && <p role="alert">{errorRecuperacion}</p>}
      </AdminDialog>
    </div>
  );
}
