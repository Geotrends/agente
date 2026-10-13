/**
 * Recepción de solicitudes del chat (RF-C3-IN-04/05, RNF-C3-IN-12).
 *
 * El contexto nace ANTES de leer el cuerpo, autenticar o esperar en cola: fija la fecha de
 * recepción y el plazo único, marca la respuesta `no-store` desde el primer instante (también
 * los rechazos tempranos) y propaga la cancelación si el cliente se desconecta.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Deadline } from "./deadline.js";
import { RequestContext } from "./requestContext.js";

/** Rutas del chat ciudadano: no pasan por el analizador JSON general de 64 KiB. */
export const CHAT_PATH = /^\/api\/(chat|conversations|ratings)(\/|$)/;
/** Rutas cuyas respuestas jamás deben almacenarse en intermediarios. */
export const NO_STORE_PATH = /^\/api\/(chat|conversations|ratings|session)(\/|$)/;

const KEY = "requestContext";
const DEADLINE_KEY = "deadline";

/** Crea el contexto de la solicitud si aún no existe y lo devuelve. */
export function contextOf(res: Response): RequestContext {
  const existing = res.locals[KEY] as RequestContext | undefined;
  if (existing) return existing;
  const ctx = new RequestContext();
  res.locals[KEY] = ctx;
  res.set("Cache-Control", "no-store");
  res.on("close", () => {
    if (!res.writableFinished) { ctx.finish("desconectada"); ctx.abort(new Error("client_disconnected")); }
    ctx.dispose();
  });
  res.on("finish", () => { ctx.finish("respuesta"); ctx.dispose(); });
  return ctx;
}

/** Plazo de la solicitud derivado del mismo contexto (mismo inicio para cuerpo, auth, cola y registro). */
export function deadlineOf(res: Response): Deadline {
  const existing = res.locals[DEADLINE_KEY] as Deadline | undefined;
  if (existing) return existing;
  const d = Deadline.forContext(contextOf(res));
  res.locals[DEADLINE_KEY] = d;
  return d;
}

/** Middleware global: contexto y no-store antes de cualquier guarda, CORS o lectura. */
export function receptionMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (NO_STORE_PATH.test(req.path)) { contextOf(res); deadlineOf(res); }
    next();
  };
}
