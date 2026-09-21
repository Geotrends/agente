import { askGemini } from "../gemini/askGemini.js";
import { setting } from "./settings.js";
import { askGroq } from "../groq/askGroq.js";
import { askOllama } from "../ollama/askOllama.js";
import { askDeepSeek } from "../deepseek/askDeepSeek.js";
import { askOpenAI } from "../openai/askOpenAI.js";
import type { ChatTurn } from "../shared/chatHistory.js";
import { providerFailure, type ProviderResult } from "../shared/llmTypes.js";
import {
  isProviderConfigured,
  pickProvider,
  providerLabel,
  type AutoRouteTarget,
  type RoutedProvider,
} from "./providerRouter.js";

export type LlmProvider =
  | "gemini"
  | "groq"
  | "ollama"
  | "deepseek"
  | "openai"
  | "auto";

type AskTutorInput = {
  message: string;
  courseContext: string;
  history?: ChatTurn[];
  provider?: LlmProvider;
  model?: string;
};

export async function askTutor({
  message,
  courseContext,
  history,
  provider = "gemini",
  model,
}: AskTutorInput): Promise<ProviderResult> {
  if (!courseContext.trim()) {
    return providerFailure("unknown",
      "No hay fragmentos disponibles para esta consulta. Verifica que GEOTRENDS_DOCUMENTS_ROOT contenga documentos con texto extraíble.",
      "sin contexto recuperado", false);
  }

  const payload = { message, courseContext, history, model };

  switch (provider) {
    case "groq":
      return askGroq(payload);
    case "ollama":
      return askOllama(payload);
    case "deepseek":
      return askDeepSeek(payload);
    case "openai":
      return askOpenAI(payload);
    default:
      return askGemini(payload);
  }
}

/** Selecciona un proveedor con clave y prueba los otros configurados si falla. */
/**
 * Cuánto puede durar como máximo la cadena completa de fallback.
 */
function fallbackBudgetMs(): number {
  return setting("fallbackBudgetMs");
}

export async function askSmartTutor(
  input: Omit<AskTutorInput, "provider" | "model">
): Promise<{ result: ProviderResult; provider: RoutedProvider; model: string; routingReason: string }> {
  const history = input.history ?? [];
  const decision = pickProvider({ message: input.message, historyLength: history.length });
  const replacement = decision.fallback;
  const candidates: AutoRouteTarget[] = [
    { provider: decision.provider, model: decision.model },
    ...(isProviderConfigured(replacement.provider) &&
    (replacement.provider !== decision.provider || replacement.model !== decision.model)
      ? [replacement]
      : []),
  ];
  let result: ProviderResult = providerFailure("unknown", "No se intento ningun proveedor.", "sin candidatos", false);
  let provider = decision.provider;
  let model = decision.model;
  let routingReason = decision.reason;
  // Presupuesto TOTAL de la cadena de fallback (hallazgo C-1).
  //
  // Antes solo había un timeout por proveedor, así que una petición podía
  // colgarse hasta 240 s sumando los cuatro — y ese era el ataque de
  // denegación de servicio más barato posible: un bucle trivial ocupando
  // conexiones durante minutos. Al agotarse el presupuesto se devuelve lo que
  // haya fallado hasta el momento, en vez de empezar un intento que no va a
  // llegar a tiempo.
  const deadline = Date.now() + fallbackBudgetMs();
  for (const candidate of candidates) {
    if (Date.now() > deadline) {
      console.warn(`[smart] Se agotó el presupuesto de ${fallbackBudgetMs()} ms; no se prueban más proveedores.`);
      break;
    }
    provider = candidate.provider;
    model = candidate.model;
    if (candidate.provider !== decision.provider || candidate.model !== decision.model) {
      routingReason = `${decision.reason} Se uso ${providerLabel(candidate.provider)} · ${candidate.model} como reemplazo.`;
    }
    result = await askTutor({ ...input, history, provider: candidate.provider, model: candidate.model });
    if (result.ok) break;
    // El fallback ya no lee el texto del mensaje (hallazgo A-4), lee el tipo.
    // Un fallo no reintentable —clave mala, modelo inexistente, petición
    // demasiado grande— no mejora probando otro proveedor con el mismo
    // problema, así que se corta en vez de gastar otra llamada.
    if (!result.retryable) break;
    console.warn(`[smart] ${providerLabel(candidate.provider)} fallo (${result.kind}): ${result.detail}`);
  }
  console.log(`[smart] provider=${provider} reason=${routingReason} ok=${result.ok}`);
  return { result, provider, model, routingReason };
}
