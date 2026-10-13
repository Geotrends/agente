/** POST /api/conversations: emite el UUID de una conversación autorizada (contracts/chat-api.md). */
import { Router } from "express";
import { createConversation } from "../chat/conversations.js";
import { sendError } from "../chat/errors.js";
import { boundedJson, originGuard, prepRateLimit } from "../chat/perimeter.js";
import { validateConversationRequest } from "../chat/validateRequest.js";
import { setting } from "../services/settings.js";
import { contextOf } from "../chat/reception.js";
import { requireSession } from "./auth.js";
import { safeErrorCode } from "../services/safeLog.js";

const router = Router();

router.post("/conversations", originGuard(), prepRateLimit(), boundedJson(), requireSession(), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const policy = setting("consentPolicyVersion");
  if (!policy) { await sendError(res, "SERVICIO_NO_DISPONIBLE"); return; }
  const v = validateConversationRequest(req.body, policy);
  if (!v.ok) { await sendError(res, "VALIDACION", { campo: v.campo, mensaje: v.mensaje }); return; }
  // «No autorizo»: no se crea nada y el cliente opera en modo anónimo.
  if (!v.autorizacion) { res.status(200).json({ modo: "anónima" }); return; }
  try {
    const ctx = contextOf(res);
    const conversationId = await createConversation(req.auth!.sub, v.policyVersion!, undefined, new Date(), {
      remainingMs: () => ctx.remainingMs(), signal: ctx.signal,
    });
    if (!ctx.finish("respuesta")) return;
    res.status(201).json({ modo: "conversación", conversationId });
  } catch (error) {
    console.error("[conversations]", safeErrorCode(error));
    await sendError(res, "SERVICIO_NO_DISPONIBLE");
  }
});

export default router;
