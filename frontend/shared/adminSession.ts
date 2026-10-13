/**
 * Cliente del panel de administración. La sesión vive en una cookie HttpOnly que el
 * navegador envía solo; aquí únicamente se guarda en memoria el token CSRF que devuelve
 * el servidor. Las rutas de la interfaz no protegen nada: lo hace siempre la API.
 */
const BASE = "/api/admin";

export type PerfilAdmin = "administrador técnico" | "Gestor documental";
export type SesionAdmin = {
  cuenta: { id: string; nombre: string; perfil: PerfilAdmin };
  mustChangePassword: boolean;
  csrfToken: string;
};
export type ErrorApi = { codigo: string; mensaje: string; campo?: string };

let csrf = "";
export function recordarSesion(s: SesionAdmin): void { csrf = s.csrfToken; }

export type Resultado<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ErrorApi; retryAfter?: number };

export async function llamar<T>(method: string, path: string, body?: unknown): Promise<Resultado<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(csrf && method !== "GET" ? { "X-CSRF-Token": csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const retry = Number(res.headers.get("Retry-After"));
    const text = await res.text();
    const json = text && /json/i.test(res.headers.get("content-type") ?? "") ? JSON.parse(text) : undefined;
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    return {
      ok: false, status: res.status,
      error: json?.error ?? { codigo: "ERROR", mensaje: "No se pudo completar la operación." },
      ...(Number.isFinite(retry) && retry > 0 ? { retryAfter: retry } : {}),
    };
  } catch {
    return { ok: false, status: 0, error: { codigo: "RED", mensaje: "No hay conexión con el servidor. Intente de nuevo." } };
  }
}

export function tokenCsrf(): string { return csrf; }

export type ConsultaSesion =
  | { estado: "ok"; sesion: SesionAdmin }
  | { estado: "sin_sesion" }
  | { estado: "indisponible" };

/** Consulta la sesión distinguiendo «no autenticada» de «servicio no disponible» (503 o red). */
export async function consultarSesion(): Promise<ConsultaSesion> {
  const r = await llamar<SesionAdmin>("GET", "/session");
  if (r.ok) { recordarSesion(r.data); return { estado: "ok", sesion: r.data }; }
  if (r.status === 401) return { estado: "sin_sesion" };
  return { estado: "indisponible" };
}

/** Carga la sesión actual o `null` si no hay una vigente. */
export async function cargarSesion(): Promise<SesionAdmin | null> {
  const c = await consultarSesion();
  return c.estado === "ok" ? c.sesion : null;
}

export async function cerrarSesion(): Promise<void> {
  await llamar("DELETE", "/session");
  csrf = "";
}

export function mensajeLimite(retryAfter?: number): string {
  if (!retryAfter) return "Demasiados intentos. Intente más tarde.";
  return `Demasiados intentos. Intente de nuevo en ${Math.ceil(retryAfter / 60)} minutos.`;
}
