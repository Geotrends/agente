import { Router } from "express";
import { getRetrievalStatus, RetrievalBusyError } from "../services/retrievalClient.js";
import { answerQuestion } from "../services/answerQuestion.js";
import { rateLimitByIdentity, requireSession } from "./auth.js";
import type { LlmProvider } from "../services/llm.js";
import { isProviderConfigured, type RoutedProvider } from "../services/providerRouter.js";
import { getProviderModel, getProviderModelCatalog } from "../shared/providerModel.js";

type ChatBody = {
  message: string;
  provider?: LlmProvider;
  model?: string;
  autoRoute?: boolean;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

const router = Router();

/**
 * Cuota del chat. Cada consulta puede disparar hasta cuatro llamadas
 * facturables en modo automático, así que el límite protege la factura tanto
 * como el servicio.
 */
const chatLimiter = rateLimitByIdentity({ windowMs: 60_000, limit: 20 });

router.get("/retrieval/status", (_req, res) => res.json(getRetrievalStatus()));
router.get("/providers", (_req, res) => res.json({
  providers: (["ollama", "gemini", "groq", "deepseek", "openai"] as const).map(id => ({
    id,
    configured: isProviderConfigured(id),
    ...getProviderModelCatalog(id),
  }))
}));

router.post("/chat", requireSession(), chatLimiter, async (req, res) => {
  try {
    const { message, provider, model, autoRoute, history } =
      req.body as Partial<ChatBody>;
    if (typeof message !== "string" || !message.trim() || message.length > 12000) {
      res.status(400).json({ error: "Envía una pregunta de entre 1 y 12000 caracteres." });
      return;
    }
    if (provider && !["auto", "gemini", "groq", "deepseek", "ollama", "openai"].includes(provider)) {
      res.status(400).json({ error: "Proveedor no válido." }); return;
    }
    if (model !== undefined && (typeof model !== "string" || !model.trim() || model.length > 200)) {
      res.status(400).json({ error: "Modelo no válido." }); return;
    }
    const useAutoRoute = autoRoute === true || !provider || provider === "auto";
    if (useAutoRoute && model) {
      res.status(400).json({ error: "No envíes model cuando el enrutamiento es automático." });
      return;
    }
    let selectedModel: string | undefined;
    if (!useAutoRoute) {
      try {
        selectedModel = getProviderModel(provider as RoutedProvider, model);
      } catch {
        res.status(400).json({ error: "El modelo no está habilitado para ese proveedor." });
        return;
      }
    }
    const retrievalStatus = getRetrievalStatus();
    if (retrievalStatus.state === "error") {
      res.status(503).json({ error: retrievalStatus.error || "El índice de documentos no está disponible." });
      return;
    }
    // "refreshing" significa que hay una reconstruccion en curso pero el indice
    // anterior sigue sirviendo: la consulta se atiende con normalidad y solo se
    // rechaza cuando de verdad no hay nada que consultar.
    if (retrievalStatus.state !== "ready" && retrievalStatus.state !== "refreshing") {
      // El primer build puede tardar largo rato. Evita dejar la peticion HTTP
      // colgada esperando a que termine: se responde de una y el cliente puede
      // reintentar consultando /api/retrieval/status.
      res.status(503).json({
        error: `El índice de documentos se está preparando (${retrievalStatus.completed}/${retrievalStatus.total || "?"}). Intenta de nuevo en unos minutos.`,
        meta: { retrieval: { state: retrievalStatus.state, completed: retrievalStatus.completed, total: retrievalStatus.total } }
      });
      return;
    }
    const outcome = await answerQuestion({
      message,
      history,
      // Ausente = enrutamiento automático; el servicio decide el proveedor.
      ...(useAutoRoute ? {} : { provider: provider as RoutedProvider, model: selectedModel }),
    });

    // Lo único que queda aquí es traducir el desenlace a HTTP, que es la
    // responsabilidad propia de una ruta (M-1).
    if (outcome.kind === "provider_failed") {
      res.status(503).json({
        error: outcome.failure.message,
        meta: { ...outcome.meta, failure: { kind: outcome.failure.kind, retryable: outcome.failure.retryable } },
      });
      return;
    }
    res.json({ answer: outcome.answer, meta: outcome.meta });
  } catch (error) {
    // Saturación no es avería: no se registra como error —bajo carga llenaría el
    // log— y se contesta con la cabecera que el cliente necesita para reintentar.
    if (error instanceof RetrievalBusyError) {
      res.set("Retry-After", String(error.retryAfterSeconds));
      res.status(503).json({
        error: `Hay muchas consultas en curso. Vuelve a intentarlo en unos ${error.retryAfterSeconds} s.`,
        meta: { retrieval: { queued: error.queued, retryAfterSeconds: error.retryAfterSeconds } }
      });
      return;
    }
    console.error("[chat]", error);
    res.status(503).json({ error: "No se pudo completar la consulta. Revisa el estado del índice y la conexión del backend." });
  }
});

export default router;
