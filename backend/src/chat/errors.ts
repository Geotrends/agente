/**
 * Errores públicos del chat (contracts/chat-api.md): código de catálogo, mensaje en
 * español y canales vigentes. Jamás SQL, modelo, proveedor, rutas ni trazas.
 */
import type { Response } from "express";
import type { Budget } from "./boundedDb.js";
import type { CanalInmediato, ErrorCodigo, ErrorPublico } from "./contracts.js";
import { contextOf } from "./reception.js";

const MENSAJES: Record<ErrorCodigo, string> = {
  VALIDACION: "La solicitud no es válida.",
  SERVICIO_NO_DISPONIBLE: "No pude atender la consulta en este momento. Puede intentarlo de nuevo en unos minutos o usar los canales oficiales.",
  ERROR_INTERNO: "Ocurrió un error inesperado. Puede intentarlo de nuevo o usar los canales oficiales.",
  LIMITE_SOLICITUDES: "Hay demasiadas solicitudes seguidas. Intente de nuevo en un momento.",
  CUERPO_EXCESIVO: "La solicitud es demasiado grande.",
  ORIGEN_NO_PERMITIDO: "Origen no permitido.",
  NO_AUTORIZADO: "Falta una sesión técnica válida.",
};

const ESTADO: Record<ErrorCodigo, number> = {
  VALIDACION: 400, SERVICIO_NO_DISPONIBLE: 503, ERROR_INTERNO: 500,
  LIMITE_SOLICITUDES: 429, CUERPO_EXCESIVO: 413, ORIGEN_NO_PERMITIDO: 403, NO_AUTORIZADO: 401,
};

export function buildError(codigo: ErrorCodigo, canales: CanalInmediato[] = [], opts: { campo?: string; mensaje?: string } = {}): ErrorPublico {
  const error: ErrorPublico["error"] = { codigo, mensaje: opts.mensaje ?? MENSAJES[codigo] };
  if (opts.campo) error.campo = opts.campo;
  return { error, canales };
}

/** Lee los canales vigentes sin pasar del presupuesto dado; el proveedor debe respetarlo. */
export type CanalesProvider = (budget: Budget) => Promise<CanalInmediato[]>;
let canalesProvider: CanalesProvider = async () => [];

/** Registra de dónde salen los canales vigentes para los errores (snapshot de contactos). */
export function setCanalesProvider(p: CanalesProvider): void { canalesProvider = p; }

/** Tope de lectura de canales: un error nunca espera por contactos más de esto. */
export const CHANNELS_BUDGET_MS = 1_500;
/** Margen que el error conserva para escribirse antes del plazo de la solicitud. */
const ERROR_WRITE_MARGIN_MS = 500;

/** Rechazos previos a la autenticación: no consultan la base (evita amplificar abuso). */
const SIN_CANALES: ReadonlySet<ErrorCodigo> = new Set<ErrorCodigo>(["ORIGEN_NO_PERMITIDO", "LIMITE_SOLICITUDES", "CUERPO_EXCESIVO"]);

export async function sendError(
  res: Response, codigo: ErrorCodigo,
  opts: { campo?: string; mensaje?: string; retryAfterSeconds?: number; /** Los contactos ya fallaron: no se leen de nuevo. */ sinCanales?: boolean } = {},
): Promise<void> {
  const ctx = contextOf(res);
  if (!ctx.finish("error")) return; // ya hubo una salida: un solo terminal por solicitud
  let canales: CanalInmediato[] = [];
  if (!SIN_CANALES.has(codigo) && !opts.sinCanales) {
    const ms = Math.min(CHANNELS_BUDGET_MS, ctx.remainingMs() - ERROR_WRITE_MARGIN_MS);
    if (ms > 0) {
      const end = Date.now() + ms;
      const budget: Budget = { remainingMs: () => Math.max(0, end - Date.now()), signal: AbortSignal.timeout(ms) };
      // Sin canales antes que exponer el fallo o retrasar el error: la lista vacía es la salida válida.
      try { canales = await canalesProvider(budget); } catch { canales = []; }
    }
  }
  if (res.headersSent) return;
  if (opts.retryAfterSeconds !== undefined) res.set("Retry-After", String(Math.max(1, Math.ceil(opts.retryAfterSeconds))));
  res.set("Cache-Control", "no-store");
  res.status(ESTADO[codigo]).json(buildError(codigo, canales, opts));
}
