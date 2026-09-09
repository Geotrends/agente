import { scoreQuestionComplexity } from "./contextBudget.js";

export type RoutedProvider = "gemini" | "groq" | "deepseek" | "ollama";

export type RouteDecision = {
  provider: RoutedProvider;
  reason: string;
};

type RouteInput = {
  message: string;
  historyLength: number;
  documentCharLength: number;
};

function isDeepSeekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

/**
 * Ollama corre local y no usa API key — se considera "configurado" si hay
 * un modelo definido (ej. OLLAMA_MODEL=llama3.2). Esto NO verifica que el
 * servidor este arriba y respondiendo; un chequeo real de salud seria
 * async (fetch a OLLAMA_BASE_URL + "/api/tags") y obligaria a que
 * pickProvider devuelva una Promise en vez de ser sincrono.
 */
function isOllamaConfigured(): boolean {
  return Boolean(process.env.OLLAMA_MODEL?.trim());
}

const CONFIG_CHECKS: Record<RoutedProvider, () => boolean> = {
  groq: () => Boolean(process.env.GROQ_API_KEY?.trim()),
  deepseek: isDeepSeekConfigured,
  gemini: () => Boolean(process.env.GEMINI_API_KEY?.trim()),
  ollama: isOllamaConfigured,
};

/**
 * Reparte entre Ollama/Groq (rapido, sin costo o barato), DeepSeek
 * (analitico) y Gemini (documentos enormes). El score de complejidad de
 * contextBudget.ts es ahora la unica fuente de verdad — ya no hay una
 * segunda lista de keywords (SIMPLE_QUESTION) compitiendo con esa
 * clasificacion.
 */
function preferredProvider(input: RouteInput): RouteDecision {
  const { message, historyLength, documentCharLength } = input;
  const q = message.trim();
  const { level } = scoreQuestionComplexity(message, historyLength);
  const enormousDoc = documentCharLength > 130_000;
  const deepseekOk = isDeepSeekConfigured();
  const ollamaOk = isOllamaConfigured();

  // Las preguntas simples usan solo el inicio del documento (ver
  // budgetDocumentContext), asi que el tamano total del doc no importa aca.
  if (level === "simple") {
    if (ollamaOk) {
      return { provider: "ollama", reason: "Pregunta simple → Ollama (local, sin costo)." };
    }
    return { provider: "groq", reason: "Pregunta simple; Ollama no configurado → Groq." };
  }

  // Para medium/complex si importa: un documento enorme truncado a la
  // ventana de DeepSeek perderia contexto relevante.
  if (enormousDoc) {
    return { provider: "gemini", reason: "Documento muy extenso → Gemini." };
  }

  if (level === "complex") {
    if (deepseekOk) {
      return { provider: "deepseek", reason: "Pregunta analitica o de seguimiento → DeepSeek." };
    }
    return { provider: "gemini", reason: "Pregunta analitica; DeepSeek no configurado → Gemini." };
  }

  // level === "medium"
  if (q.length < 130 && historyLength <= 8) {
    return { provider: "groq", reason: "Pregunta de complejidad media y breve → Groq." };
  }

  if (deepseekOk) {
    return { provider: "deepseek", reason: "Pregunta de complejidad media y detallada → DeepSeek." };
  }

  return { provider: "gemini", reason: "Consulta general → Gemini." };
}

export function providerLabel(provider: RoutedProvider): string {
  switch (provider) {
    case "groq":
      return "Groq";
    case "deepseek":
      return "DeepSeek";
    case "ollama":
      return "Ollama";
    default:
      return "Gemini";
  }
}

export function pickProvider(input: RouteInput): RouteDecision {
  const preferred = preferredProvider(input);
  const configured = (Object.keys(CONFIG_CHECKS) as RoutedProvider[]).filter(p => CONFIG_CHECKS[p]());
  if (configured.includes(preferred.provider)) return preferred;
  return {
    provider: configured[0] ?? "gemini",
    reason: configured.length
      ? "Proveedor disponible con API key configurada."
      : "No hay proveedores configurados.",
  };
}