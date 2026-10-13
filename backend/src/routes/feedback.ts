/**
 * POST /api/ratings (contracts/feedback-api.md). Perímetro (origen → 60/min/IP → cuerpo ≤128 KiB) →
 * sesión técnica → validación → registro atómico. No llama al LLM. 201 solo tras el commit.
 * La cuota de consultas (60/min) no se consume aquí: la valoración usa su propio límite.
 */
import { Router } from "express";
import { sendError } from "../chat/errors.js";
import { registerRating, validateRatingRequest } from "../chat/feedback.js";
import { boundedJson, originGuard, prepRateLimit } from "../chat/perimeter.js";
import { contextOf } from "../chat/reception.js";
import { requireSession } from "./auth.js";
import { safeErrorCode } from "../services/safeLog.js";

const router = Router();

let override: typeof registerRating | undefined;
/** Solo pruebas: sustituye el registro para simular fallos de base. */
export function setRatingRegistrarForTests(fn: typeof registerRating | undefined): void { override = fn; }

const UNIFORME = "No se pudo registrar la valoración.";

router.post("/ratings", originGuard(), prepRateLimit(), boundedJson(), requireSession(), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const v = validateRatingRequest(req.body);
  // Mensaje uniforme: no distingue ID inexistente, ajeno, depurado, duplicado ni motivo indebido.
  if (!v.ok) { await sendError(res, "VALIDACION", { mensaje: UNIFORME }); return; }
  try {
    const ctx = contextOf(res);
    const written = override
      ? await override(req.auth!.sub, v.value)
      : await registerRating(req.auth!.sub, v.value, undefined, { remainingMs: () => ctx.remainingMs(), signal: ctx.signal });
    if (!written) { await sendError(res, "VALIDACION", { mensaje: UNIFORME }); return; }
    if (!ctx.finish("respuesta")) return;
    res.status(201).json({ responseId: v.value.responseId, registrada: true });
  } catch (error) {
    console.error("[ratings]", safeErrorCode(error));
    await sendError(res, "SERVICIO_NO_DISPONIBLE");
  }
});

export default router;
