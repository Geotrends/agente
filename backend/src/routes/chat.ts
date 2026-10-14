/**
 * POST /api/chat (contracts/chat-api.md). Perímetro → sesión técnica → validación estricta →
 * admisión → caso de uso con plazo único. No existe selección de proveedor ni de modelo, y la
 * ruta `/providers` ya no existe: la inferencia es solo Bedrock con dos modelos.
 */
import { Router } from "express";
import { sendError } from "../chat/errors.js";
import { handleChat, type ChatDeps } from "../chat/handleChat.js";
import { boundedJson, clientKey, originGuard, perIpRateLimit } from "../chat/perimeter.js";
import { contextOf, deadlineOf } from "../chat/reception.js";
import { productionDeps } from "../chat/runtime.js";
import { validateChatRequest } from "../chat/validateRequest.js";
import { getRetrievalStatus, RetrievalBusyError } from "../services/retrievalClient.js";
import { chatAdmissionQueue, ChatQueueError, chatTraffic, type ChatTrafficController } from "../services/chatTraffic.js";
import { requireSession } from "./auth.js";
import { safeErrorCode } from "../services/safeLog.js";
import { reportUnavailable } from "../chat/unavailable.js";
import { isInternalCaller } from "./health.js";

const router = Router();

/** Perímetro: origen → 60/min/IP en ventana deslizante → cuerpo ≤128 KiB; antes de la sesión, del LLM y de cualquier registro. */
const perimeter = [originGuard(), perIpRateLimit(), boundedJson()];

let overrideDeps: ChatDeps | undefined;
/** Solo pruebas: sustituye las dependencias de producción. */
export function setChatDepsForTests(d: ChatDeps | undefined): void { overrideDeps = d; }
let trafficForTests: ChatTrafficController | undefined;
/** Solo pruebas: aplica este controlador de topes aun con dependencias inyectadas. */
export function setChatTrafficForTests(c: ChatTrafficController | undefined): void { trafficForTests = c; }

router.get("/retrieval/status", (req, res) => {
  const { state } = getRetrievalStatus();
  // SPEC008 (FR-019): un anónimo solo recibe si el índice sirve; el detalle queda para operación.
  if (isInternalCaller(req)) { res.json({ state, chatQueue: chatAdmissionQueue.status() }); return; }
  res.json({ ok: state === "ready" || state === "refreshing" });
});

router.post("/chat", ...perimeter, requireSession(), async (req, res) => {
  // El contexto nació al recibir los encabezados: fecha, plazo y duración parten de ahí, no de aquí.
  const ctx = contextOf(res);
  const deadline = deadlineOf(res);
  let release: (() => void) | undefined;
  try {
    const v = validateChatRequest(req.body);
    if (!v.ok) { await sendError(res, "VALIDACION", { campo: v.campo, mensaje: v.mensaje }); return; }

    // El índice debe estar listo; un fallo de búsqueda NUNCA se presenta como «sin información».
    const { state } = getRetrievalStatus();
    if (!overrideDeps && state !== "ready" && state !== "refreshing") { await sendError(res, "SERVICIO_NO_DISPONIBLE"); return; }

    // Topes de gasto (NV-01). El bloqueo por mensajes extensos se aplica antes de la cola; el tope
    // diario cuenta las consultas que obtuvieron plaza (una cola llena no consume cupo). Todo
    // rechazo ocurre antes del LLM y de cualquier registro. Con dependencias inyectadas en
    // pruebas no se aplican, salvo que la prueba fije su propio controlador.
    const traffic = trafficForTests ?? (overrideDeps ? undefined : chatTraffic);
    const ip = clientKey(req);
    if (traffic) {
      const largo = await traffic.checkAndRecordLongRequest(ip, v.value.pregunta.length);
      if (!largo.ok) { await sendError(res, "LIMITE_SOLICITUDES", { retryAfterSeconds: largo.retryAfterSeconds }); return; }
    }

    // Cancela la espera de plaza si el cliente se va o vence el plazo; la señal la propaga el contexto.
    release = await chatAdmissionQueue.acquire(ctx.signal, {
      maxWaitMs: Math.max(0, deadline.remainingMs() - 10_000),
    });

    if (traffic) {
      const cupo = await traffic.consumeDailyQuota(ip);
      if (!cupo.ok) { await sendError(res, "LIMITE_SOLICITUDES", { retryAfterSeconds: cupo.retryAfterSeconds }); return; }
    }

    const result = await handleChat(v.value, req.auth!.sub, overrideDeps ?? productionDeps(), deadline);
    if (result.status === 200) {
      if (!ctx.finish("respuesta")) return;
      res.json(result.body);
      return;
    }
    await sendError(res, result.error.codigo, { campo: result.error.campo, mensaje: result.error.mensaje });
  } catch (error) {
    if (error instanceof Error && error.message === "client_disconnected") return;
    if (ctx.terminalState === "desconectada") return;
    if (error instanceof ChatQueueError) { reportUnavailable("plazo"); await sendError(res, "SERVICIO_NO_DISPONIBLE", { retryAfterSeconds: error.retryAfterSeconds }); return; }
    if (error instanceof RetrievalBusyError) { reportUnavailable("busqueda"); await sendError(res, "SERVICIO_NO_DISPONIBLE", { retryAfterSeconds: error.retryAfterSeconds }); return; }
    if (ctx.expired || ctx.signal.aborted) { reportUnavailable("plazo"); await sendError(res, "SERVICIO_NO_DISPONIBLE"); return; }
    console.error("[chat]", safeErrorCode(error));
    await sendError(res, "ERROR_INTERNO");
  } finally {
    release?.();
  }
});

export default router;
