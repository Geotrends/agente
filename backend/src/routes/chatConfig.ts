/** GET /api/chat/config: apertura, política de datos y contactos oficiales; sin LLM y en ≤2 s. */
import { Router } from "express";
import { readContactSnapshot } from "../admin/contacts.js";
import { chatPool } from "../chat/db.js";
import { sendError } from "../chat/errors.js";
import { boundedJson, originGuard, prepRateLimit } from "../chat/perimeter.js";
import { contextOf } from "../chat/reception.js";
import { APERTURA_GEOBOT, OPCIONES_AUTORIZACION } from "../prompts/institutionalTexts.js";
import { setting } from "../services/settings.js";
import { safeErrorCode } from "../services/safeLog.js";

const router = Router();
const CONFIG_BUDGET_MS = 2_000;

router.get("/chat/config", originGuard(), prepRateLimit(), boundedJson(), async (_req, res) => {
  const ctx = contextOf(res);
  const version = setting("consentPolicyVersion");
  const url = setting("consentPolicyUrl");
  if (!version || !url) { await sendError(res, "SERVICIO_NO_DISPONIBLE"); return; }
  try {
    // La lectura respeta su propio tope de 2 s y la cancelación de la solicitud; no deja trabajo vivo.
    const end = Date.now() + Math.min(CONFIG_BUDGET_MS, ctx.remainingMs());
    const snapshot = await readContactSnapshot(chatPool(), {
      remainingMs: () => Math.max(0, end - Date.now()), signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(Math.max(1, end - Date.now()))]),
    });
    // Valor oficial faltante = servicio no preparado; nunca se inventa un contacto.
    if (!snapshot) { await sendError(res, "SERVICIO_NO_DISPONIBLE", { sinCanales: true }); return; }
    if (!ctx.finish("respuesta")) return;
    res.set("Cache-Control", "no-store");
    res.json({ apertura: APERTURA_GEOBOT, politica: { version, url }, opciones: OPCIONES_AUTORIZACION, contactos: snapshot });
  } catch (error) {
    console.error("[chat-config]", safeErrorCode(error));
    // Los contactos son justo lo que falló: el error sale sin volver a leerlos ni esperar de más.
    await sendError(res, "SERVICIO_NO_DISPONIBLE", { sinCanales: true });
  }
});

export default router;
