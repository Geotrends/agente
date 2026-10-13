/**
 * Middleware de autenticación y rutas de sesión (hallazgo C-1).
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { sendError } from "../chat/errors.js";
import { bearerFrom, issueToken, verifyToken, type SessionClaims } from "../services/auth.js";
import { setting } from "../services/settings.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: SessionClaims;
    }
  }
}

/**
 * Exige un token de sesión válido.
 *
 * Antes esto era `requireScope(scope)` y respondía además 403 cuando el token
 * era legítimo pero de otro alcance. Al quedar un solo alcance, esa rama era
 * inalcanzable por construcción —`verifyToken` ya rechaza cualquier token que
 * no sea de chat, así que la comparación nunca podía fallar— y un 403 que no
 * puede ocurrir es peor que no tenerlo: sugiere una defensa que no existe.
 *
 * Si vuelven a hacer falta alcances (una zona de operador, por ejemplo), lo que
 * se recupera es esa comparación más el claim en `SessionClaims`; el resto de
 * la verificación ya está aquí.
 */
export function requireSession() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = bearerFrom(req.header("authorization"));
    if (!token) { await sendError(res, "NO_AUTORIZADO"); return; }
    const claims = await verifyToken(token);
    if (!claims) { await sendError(res, "NO_AUTORIZADO"); return; }
    req.auth = claims;
    next();
  };
}

/**
 * Límite por identidad, con la IP como reserva.
 *
 * Por identidad y no solo por IP porque tras un NAT municipal o una red
 * institucional comparten IP cientos de personas legítimas: limitar solo por
 * IP castiga a todas por el abuso de una. El token de sesión existe
 * precisamente para poder distinguirlas.
 */
export function rateLimitByIdentity(options: { windowMs: number; limit: number }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // `ipKeyGenerator` normaliza la IPv6 a su bloque /64. Sin él, un usuario
    // con IPv6 tiene billones de direcciones propias y salta el límite
    // cambiando de una a otra: la librería lo rechaza de entrada, y hace bien.
    keyGenerator: (req: Request, res) => req.auth?.sub ?? ipKeyGenerator(req.ip ?? "", 64) ?? String(res.statusCode),
    handler: (_req, res) => { void sendError(res, "LIMITE_SOLICITUDES", { retryAfterSeconds: Number(res.getHeader("retry-after")) || 60 }); },
  });
}

const router = Router();

/**
 * Sesión anónima. No pide credenciales a propósito: el canal es público.
 *
 * El límite por IP es lo que impide que alguien pida un token nuevo por cada
 * petición y esquive así la cuota por identidad. Antes eran 30 por hora fijos:
 * detrás de un CGNAT móvil o de la red de una oficina, esa cifra la agotaban
 * personas distintas. Ahora es configurable y se lee en cada petición, como el
 * resto de la configuración; el abuso lo siguen acotando la cuota diaria por IP
 * y la global.
 */
router.post(
  "/session",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: () => setting("authSessionHourlyPerIpLimit"),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => { void sendError(res, "LIMITE_SOLICITUDES", { retryAfterSeconds: Number(res.getHeader("retry-after")) || 60 }); },
  }),
  async (_req, res) => {
    const { token, expiresIn } = await issueToken();
    res.json({ token, expiresIn, scope: "chat" });
  },
);

export default router;
