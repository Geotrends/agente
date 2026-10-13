/**
 * Perímetro del chat ciudadano (RF-C3-IN-10, RNF-C3-IN-04/05/06).
 *
 * Orden de las defensas: origen → ventana deslizante por IP → tamaño de cuerpo →
 * sesión técnica. Todo rechazo ocurre ANTES de cualquier LLM o registro. La IP es la
 * que resuelve el proxy confiable (`trust proxy`), nunca una cabecera arbitraria.
 */
import type { NextFunction, Request, Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { parseOrigins } from "../services/diConfig.js";
import { setting } from "../services/settings.js";
import { sendError } from "./errors.js";
import { CHAT_PATH, contextOf } from "./reception.js";
import { reportUnavailable } from "./unavailable.js";

export { CHAT_PATH };

/** Origen exacto de la lista de la política (comparación literal, sin comodines ni subdominios). */
export const isAllowedOrigin = (origin: string | undefined): boolean =>
  !!origin && parseOrigins(setting("chatAllowedOrigins")).includes(origin);

/**
 * Origen del ChatBot obligatorio para toda solicitud con efecto (POST/PUT/…): la ausencia de
 * `Origin` y los orígenes ajenos se rechazan antes de la sesión, el modelo o el registro. Un GET
 * de configuración del mismo origen puede omitirlo; si lo trae, debe ser el permitido.
 */
export function originGuard() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const origin = req.header("origin");
    const safeRead = req.method === "GET" || req.method === "HEAD";
    if (origin ? !isAllowedOrigin(origin) : !safeRead) {
      await sendError(res, "ORIGEN_NO_PERMITIDO");
      return;
    }
    next();
  };
}

/** Método permitido por ruta en un preflight (la ruta real solo acepta uno). */
const PREFLIGHT_METHOD: Array<[RegExp, string]> = [
  [/^\/api\/chat\/config\/?$/, "GET"],
  [/^\/api\/(chat|conversations|ratings)\/?$/, "POST"],
];
const PREFLIGHT_HEADERS = new Set(["content-type", "authorization"]);

/**
 * Preflight de las rutas del chat: se valida origen, método y cabeceras ANTES de que CORS responda.
 * Un preflight permitido sigue hacia CORS (204 con el origen exacto) y no consume la cuota de
 * consultas; uno ajeno recibe 403 sin ninguna cabecera `Access-Control-*`.
 */
export function preflightGuard() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== "OPTIONS" || !CHAT_PATH.test(req.path)) { next(); return; }
    contextOf(res);
    const origin = req.header("origin");
    const method = (req.header("access-control-request-method") ?? "").toUpperCase();
    const expected = PREFLIGHT_METHOD.find(([re]) => re.test(req.path))?.[1];
    const requested = (req.header("access-control-request-headers") ?? "")
      .split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
    const valid = isAllowedOrigin(origin) && !!expected && method === expected && requested.every(h => PREFLIGHT_HEADERS.has(h));
    if (!valid) { await sendError(res, "ORIGEN_NO_PERMITIDO"); return; }
    next();
  };
}

export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}

  /** Registra la solicitud si cabe; si no, devuelve segundos hasta que se libere una plaza. */
  take(key: string, limit: number, windowMs: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter(h => t - h < windowMs);
    if (list.length >= limit) {
      this.hits.set(key, list);
      return { ok: false, retryAfterSeconds: Math.ceil((list[0] + windowMs - t) / 1000) };
    }
    list.push(t);
    this.hits.set(key, list);
    return { ok: true };
  }

  /** Descarta claves vacías para que el mapa no crezca sin límite. */
  sweep(windowMs: number): void {
    const t = this.now();
    for (const [k, v] of this.hits) if (!v.some(h => t - h < windowMs)) this.hits.delete(k);
  }
  reset(): void { this.hits.clear(); }
}

/** Ventana de CONSULTAS: solo `POST /api/chat` la consume (60/min/IP). */
export const chatWindow = new SlidingWindow();
/** Ventana independiente de preparación, configuración y valoración: no resta turnos de consulta. */
export const prepWindow = new SlidingWindow();

const sweeper = setInterval(() => { chatWindow.sweep(60_000); prepWindow.sweep(60_000); }, 60_000);
sweeper.unref();

export const clientKey = (req: Request): string => ipKeyGenerator(req.ip ?? "desconocida", 64) ?? "desconocida";

/** 60 consultas por IP en ventana deslizante de un minuto. */
export function perIpRateLimit(window: SlidingWindow = chatWindow) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const r = window.take(clientKey(req), setting("chatRateLimitPerMinute"), 60_000);
    if (!r.ok) { await sendError(res, "LIMITE_SOLICITUDES", { retryAfterSeconds: r.retryAfterSeconds }); return; }
    next();
  };
}

/** Límite propio (más holgado) de configuración, conversaciones y valoraciones, sin tocar la cuota de consultas. */
export function prepRateLimit(window: SlidingWindow = prepWindow) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const r = window.take(clientKey(req), setting("chatPrepRateLimitPerMinute"), 60_000);
    if (!r.ok) { await sendError(res, "LIMITE_SOLICITUDES", { retryAfterSeconds: r.retryAfterSeconds }); return; }
    next();
  };
}

/** Bytes que aún se descartan tras rechazar un cuerpo, y gracia para que el cliente lea el 413. */
const DRAIN_AFTER_REJECT = 1024 * 1024;
const LINGER_MS = 300;

/**
 * Rechaza por tamaño sin acumular: el cuerpo restante se DESCARTA (nunca se guarda) y la conexión
 * se corta tras una breve gracia o al pasar un tope de descarte. Cerrar de inmediato con datos sin
 * leer provoca un reinicio de conexión que puede borrar el 413 antes de que el cliente lo lea.
 */
function rejectOversize(req: Request, res: Response): void {
  let discarded = 0;
  let timer: NodeJS.Timeout | undefined;
  const cut = () => { if (timer) clearTimeout(timer); req.destroy(); };
  req.on("data", (c: Buffer) => { discarded += c.length; if (discarded > DRAIN_AFTER_REJECT) cut(); });
  req.resume();
  res.once("finish", () => { timer = setTimeout(cut, LINGER_MS); timer.unref(); });
  void sendError(res, "CUERPO_EXCESIVO");
}

/**
 * Lee el cuerpo JSON con tope en bytes también cuando llega por streaming: se
 * corta al pasar el límite aunque Content-Length falte o mienta. Sin límite de
 * caracteres adicional: una pregunta de 20.000 caracteres entra mientras quepa.
 *
 * La lectura cuenta contra el plazo de la solicitud: un cuerpo que no termina antes de que venza
 * produce el error de disponibilidad dentro del plazo (RF-C3-IN-04), no un silencio.
 */
export function boundedJson() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ctx = contextOf(res);
    const max = setting("chatMaxBodyBytes");
    const declared = Number(req.header("content-length"));
    if (Number.isFinite(declared) && declared > max) { rejectOversize(req, res); return; }
    if (req.method === "GET" || req.method === "HEAD") { next(); return; }
    if (!req.is("application/json")) { await sendError(res, "VALIDACION", { campo: "Content-Type", mensaje: "El contenido debe ser application/json." }); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    // Observabilidad sin contenido: cuántos bytes se leyeron y cuántos siguen retenidos.
    const stats = { read: 0, retained: 0 };
    res.locals.bodyStats = stats;
    const stop = () => { done = true; chunks.length = 0; stats.retained = 0; ctx.signal.removeEventListener("abort", onAbort); };
    const onAbort = () => {
      if (done) return;
      stop();
      // Desconexión: no hay a quién responder. Plazo vencido: error de disponibilidad.
      if (ctx.terminalState === "desconectada" || res.writableEnded) return;
      reportUnavailable("plazo");
      void sendError(res, "SERVICIO_NO_DISPONIBLE").then(() => req.destroy());
    };
    if (ctx.signal.aborted) { onAbort(); return; }
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      stats.read = size;
      if (size > max) { stop(); rejectOversize(req, res); return; }
      chunks.push(c);
      stats.retained = size;
    });
    req.on("end", () => {
      if (done) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      stop();
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch {
        void sendError(res, "VALIDACION", { mensaje: "El cuerpo no es JSON válido." });
        return;
      }
      next();
    });
    req.on("error", () => { if (!done) { stop(); void sendError(res, "VALIDACION"); } });
  };
}
