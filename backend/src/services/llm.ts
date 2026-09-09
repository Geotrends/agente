import { askGemini } from "../gemini/askGemini.js";
import { askGroq } from "../groq/askGroq.js";
import { askOllama } from "../ollama/askOllama.js";
import { askDeepSeek } from "../deepseek/askDeepSeek.js";
import type { ChatTurn } from "../shared/chatHistory.js";
import { budgetDocumentContext } from "./contextBudget.js";
import { pickProvider, type RoutedProvider } from "./providerRouter.js";

export type LlmProvider =
  | "gemini"
  | "groq"
  | "ollama"
  | "deepseek"
  | "auto";

type AskTutorInput = {
  message: string;
  courseContext: string;
  documentsInventory?: string[];
  activeDocumentPath?: string;
  additionalSnippets?: Array<{ path: string; snippet: string }>;
  history?: ChatTurn[];
  provider?: LlmProvider;
};

export async function askTutor({
  message,
  courseContext,
  documentsInventory,
  activeDocumentPath,
  additionalSnippets,
  history,
  provider = "gemini"
}: AskTutorInput): Promise<string> {
  const hasContext = courseContext.trim().length > 0;
  const hasSnippets = (additionalSnippets?.length ?? 0) > 0;

  if (!hasContext && !hasSnippets) {
    return "No hay fragmentos disponibles para esta consulta. Verifica que GEOTRENDS_DOCUMENTS_ROOT contenga documentos con texto extraíble.";
  }

  const payload = {
    message,
    courseContext,
    documentsInventory,
    activeDocumentPath,
    additionalSnippets,
    history
  };

  switch (provider) {
    case "groq":
      return askGroq(payload);
    case "ollama":
      return askOllama(payload);
    case "deepseek":
      return askDeepSeek(payload);
    default:
      return askGemini(payload);
  }
}

function isProviderFailure(answer: string): boolean {
  return /^(Falta configurar |(?:Gemini|Groq|DeepSeek) (?:rechazo|indico|devolvio)|El modelo '.*' no esta disponible)/i.test(answer);
}

/** Selecciona un proveedor con clave y prueba los otros configurados si falla. */
export async function askSmartTutor(
  input: Omit<AskTutorInput, "provider">
): Promise<{ answer: string; provider: RoutedProvider; routingReason: string }> {
  const history = input.history ?? [];
  const decision = pickProvider({ message: input.message, historyLength: history.length,
    documentCharLength: input.courseContext.length });
  const configured = (["groq", "deepseek", "gemini"] as const)
    .filter(p => Boolean(process.env[`${p.toUpperCase()}_API_KEY`]?.trim()));
  const candidates = [decision.provider, ...configured.filter(p => p !== decision.provider)];
  let answer = "";
  let provider = decision.provider;
  let routingReason = decision.reason;
  for (const candidate of candidates) {
    provider = candidate;
    if (candidate !== decision.provider) routingReason = `${decision.reason} Se usó ${candidate} tras fallar otro proveedor.`;
    const courseContext = budgetDocumentContext(input.courseContext, candidate, input.message, history);
    answer = await askTutor({ ...input, courseContext, history, provider: candidate });
    if (!isProviderFailure(answer)) break;
  }
  console.log(`[smart] provider=${provider} reason=${routingReason}`);
  return { answer, provider, routingReason };
}
