/**
 * Rutas de sesión del panel (`/api/admin/session`, `/api/admin/password`) y el
 * middleware que protege el resto de `/api/admin` (contracts/admin-api.md).
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { changePassword, login } from "../admin/auth.js";
import { COOKIE_NAME, csrfFor, csrfMatches, readCookie, revokeSession, touchSession, type Perfil, type SessionInfo } from "../admin/sessions.js";
import { ApiError } from "../admin/contracts.js";
import { ValidationError } from "../admin/validation.js";
import { parseOrigins } from "../services/diConfig.js";
import { setting } from "../services/settings.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: SessionInfo & { token: string };
    }
  }
}

export type AdminError = { error: { codigo: string; mensaje: string; campo?: string } };
const err = (codigo: string, mensaje: string, campo?: string): AdminError =>
  ({ error: { codigo, mensaje, ...(campo ? { campo } : {}) } });

const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Strict; Path=/api/admin";
const setCookie = (res: Response, token: string): void => { res.append("Set-Cookie", `${COOKIE_NAME}=${token}; ${COOKIE_ATTRS}`); };
const clearCookie = (res: Response): void => { res.append("Set-Cookie", `${COOKIE_NAME}=; ${COOKIE_ATTRS}; Max-Age=0`); };

function originAllowed(req: Request): boolean {
  const origin = req.header("origin");
  if (!origin) return false;
  const own = `${req.protocol}://${req.get("host")}`;
  return origin === own || parseOrigins(setting("chatAllowedOrigins")).includes(origin);
}

/** Mutaciones: Origin permitido, Content-Type JSON y CSRF ligado a la sesión. */
export function checkMutation(req: Request, res: Response, token: string, opts: { multipart?: boolean } = {}): boolean {
  if (!originAllowed(req)) { res.status(403).json(err("ORIGEN_NO_PERMITIDO", "Origen no permitido.")); return false; }
  const hasBody = Number(req.header("content-length") ?? 0) > 0 || req.header("transfer-encoding") !== undefined;
  const tipoOk = req.is("application/json") || (opts.multipart && req.is("multipart/form-data"));
  if (hasBody && !tipoOk) { res.status(415).json(err("VALIDACION", opts.multipart ? "El contenido debe ser multipart/form-data." : "El contenido debe ser application/json.")); return false; }
  if (!csrfMatches(token, req.header("x-csrf-token"))) { res.status(403).json(err("CSRF", "Token CSRF inválido.")); return false; }
  return true;
}

export type RequireAdminOptions = {
  /** Solo este perfil; el otro recibe 403 sin datos. */
  perfil?: Perfil;
  /** Permite la ruta mientras la contraseña temporal siga vigente (sesión, contraseña, logout). */
  allowMustChange?: boolean;
  /** Exige CSRF/Origin (mutaciones). */
  mutation?: boolean;
  /** La mutación recibe `multipart/form-data` (carga de documentos), con CSRF y Origin igualmente. */
  multipart?: boolean;
};

export function requireAdmin(opts: RequireAdminOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.set("Cache-Control", "no-store");
    const token = readCookie(req.header("cookie"));
    let info: SessionInfo | null = null;
    if (token) {
      try {
        info = await touchSession(token);
      } catch (error) {
        // Base caída: no hay forma de validar la sesión; nunca se concede acceso desde memoria.
        console.error("[admin] base no disponible:", (error as { code?: string }).code ?? "error");
        res.status(503).json(err("SERVICIO_NO_DISPONIBLE", "El servicio no está disponible en este momento.")); return;
      }
    }
    if (!token || !info) { res.status(401).json(err("NO_AUTENTICADO", "Sesión no válida o expirada.")); return; }
    if (info.mustChangePassword && !opts.allowMustChange) {
      res.status(403).json(err("CAMBIO_CONTRASENA_REQUERIDO", "Debe cambiar la contraseña temporal.")); return;
    }
    if (opts.perfil && info.perfil !== opts.perfil) { res.status(403).json(err("PERFIL_NO_PERMITIDO", "No tiene permiso para esta función.")); return; }
    if (opts.mutation && !checkMutation(req, res, token, { multipart: opts.multipart })) return;
    req.admin = { ...info, token };
    next();
  };
}

const sessionView = (s: { accountId: string; email?: string; displayName: string; perfil: string; mustChangePassword: boolean }) =>
  ({ cuenta: { id: s.accountId, nombre: s.displayName, perfil: s.perfil }, mustChangePassword: s.mustChangePassword });

/**
 * Express 4 no captura las promesas rechazadas de un manejador async: una caída de la base
 * dejaba la solicitud colgada para siempre. Todo error inesperado se traduce a 503 sin detalle.
 */
export function safe(handler: (req: Request, res: Response) => Promise<void> | void) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ValidationError) {
        if (!res.headersSent) res.status(422).json(err("VALIDACION", error.mensaje, error.campo));
        return;
      }
      if (error instanceof ApiError) {
        if (!res.headersSent) res.status(error.status).json(err(error.codigo, error.mensaje, error.campo));
        return;
      }
      console.error("[admin]", (error as { code?: string }).code ?? (error instanceof Error ? error.name : "error"));
      if (!res.headersSent) res.status(503).json(err("SERVICIO_NO_DISPONIBLE", "El servicio no está disponible en este momento."));
    }
  };
}

const router = Router();

router.post("/admin/session", safe(async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!originAllowed(req)) { res.status(403).json(err("ORIGEN_NO_PERMITIDO", "Origen no permitido.")); return; }
  const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const result = await login(body.email, body.password, req.ip ?? "desconocida");
  if (!result.ok) {
    if (result.status === 429) {
      res.set("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json(err("LIMITE_SOLICITUDES", "Demasiados intentos. Intente más tarde."));
    } else {
      res.status(401).json(err("CREDENCIALES", "Correo o contraseña incorrectos."));
    }
    return;
  }
  setCookie(res, result.token);
  res.json({ ...sessionView(result), csrfToken: result.csrf });
}));

router.get("/admin/session", requireAdmin({ allowMustChange: true }), (req, res) => {
  const a = req.admin!;
  res.json({ ...sessionView(a), csrfToken: csrfFor(a.token) });
});

router.delete("/admin/session", requireAdmin({ allowMustChange: true, mutation: true }), safe(async (req, res) => {
  await revokeSession(req.admin!.token);
  clearCookie(res);
  res.status(204).end();
}));

router.post("/admin/password", requireAdmin({ allowMustChange: true, mutation: true }), safe(async (req, res) => {
  const body = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
  const r = await changePassword(req.admin!.accountId, req.admin!.token, body.currentPassword, body.newPassword);
  if (!r.ok) { res.status(422).json(err("VALIDACION", r.mensaje, r.campo)); return; }
  res.status(204).end();
}));

export default router;
