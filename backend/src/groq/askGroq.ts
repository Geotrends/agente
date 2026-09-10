import { getProviderModel } from "../shared/providerModel.js";
import { getResponseTokenLimit } from "../services/contextBudget.js";
import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { buildOpenAiMessages } from "../shared/chatHistory.js";
import { AskProviderInput, getErrorMessage } from "../shared/llmTypes.js";

/**
 * Groq devuelve HTTP 413 cuando el JSON del POST supera el limite del proveedor
 * (no solo el PDF: cuenta prompt del sistema + inventario + extractos + mensaje).
 */
const DEFAULT_GROQ_MAX_DOCUMENT_CHARS = 18_000;

type GroqShrinkLimits = {
  maxDocChars: number;
  maxInventoryItems: number;
  maxSnippets: number;
  maxSnippetChars: number;
};

const INITIAL_LIMITS: GroqShrinkLimits = {
  maxDocChars: DEFAULT_GROQ_MAX_DOCUMENT_CHARS,
  maxInventoryItems: 35,
  maxSnippets: 1,
  maxSnippetChars: 450
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function shrinkPayloadForGroq(input: AskProviderInput, limits: GroqShrinkLimits): AskProviderInput {
  const maxDoc = Math.max(4_000, limits.maxDocChars);

  let courseContext = input.courseContext;
  if (courseContext.length > maxDoc) {
    courseContext =
      courseContext.slice(0, maxDoc) +
      `\n\n[Texto truncado a ${maxDoc} caracteres para Groq.]`;
  }

  let documentsInventory = input.documentsInventory;
  const invCap = Math.max(5, limits.maxInventoryItems);
  if (documentsInventory && documentsInventory.length > invCap) {
    const rest = documentsInventory.length - invCap;
    documentsInventory = [
      ...documentsInventory.slice(0, invCap),
      `(...${rest} rutas omitidas; acota carpeta en el panel.)`
    ];
  }

  let additionalSnippets = input.additionalSnippets;
  const snipCap = Math.max(0, limits.maxSnippets);
  if (additionalSnippets?.length && snipCap === 0) {
    additionalSnippets = [];
  } else if (additionalSnippets?.length) {
    const maxLen = Math.max(120, limits.maxSnippetChars);
    additionalSnippets = additionalSnippets.slice(0, snipCap).map((s) => ({
      path: s.path,
      snippet: s.snippet.length > maxLen ? `${s.snippet.slice(0, maxLen)}...` : s.snippet
    }));
  }

  return { ...input, courseContext, documentsInventory, additionalSnippets };
}

function buildGroqBody(
  shrunk: AskProviderInput,
  model: string
): { model: string; messages: Array<{ role: string; content: string }>; temperature: number; max_tokens: number } {
  const systemContent = buildSystemPrompt({
    documentContext: shrunk.courseContext,
    documentsInventory: shrunk.documentsInventory,
    activeDocumentPath: shrunk.activeDocumentPath,
    additionalSnippets: shrunk.additionalSnippets
  });

  return {
    model,
    messages: buildOpenAiMessages(systemContent, shrunk.history ?? [], shrunk.message),
    temperature: 0.25,
    max_tokens: getResponseTokenLimit(shrunk.message, shrunk.history?.length ?? 0)
  };
}

/** Tras un 413, reduce tamano para el siguiente intento. */
function tightenLimits(prev: GroqShrinkLimits, attempt: number): GroqShrinkLimits {
  return {
    maxDocChars: Math.max(4_000, Math.floor(prev.maxDocChars * (attempt === 0 ? 0.5 : 0.55))),
    maxInventoryItems: Math.max(8, Math.floor(prev.maxInventoryItems * 0.45)),
    maxSnippets: attempt >= 1 ? 0 : prev.maxSnippets,
    maxSnippetChars: Math.max(200, Math.floor(prev.maxSnippetChars * 0.6))
  };
}

export async function askGroq(input: AskProviderInput): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return "Falta configurar GROQ_API_KEY en el backend.";
  }

  const envCap = parsePositiveInt(
    process.env.GROQ_MAX_DOCUMENT_CHARS,
    DEFAULT_GROQ_MAX_DOCUMENT_CHARS
  );
  let limits: GroqShrinkLimits = {
    ...INITIAL_LIMITS,
    maxDocChars: Math.max(4_000, envCap)
  };

  const model = getProviderModel("groq");
  const maxAttempts = 6;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const shrunk = shrinkPayloadForGroq(input, limits);
      const body = buildGroqBody(shrunk, model);

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(60000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`
        },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const answer = data.choices?.[0]?.message?.content?.trim() || "";
        return answer || "No encuentro esa informacion en el documento.";
      }

      const errorText = await response.text();

      if (response.status === 401 || response.status === 403) {
        return "Groq rechazo la autenticacion. Revisa GROQ_API_KEY.";
      }
      if (response.status === 429) {
        return "Groq indico limite de uso por ahora (quota/rate limit). Intenta mas tarde.";
      }

      if (response.status === 413 && attempt < maxAttempts - 1) {
        limits = tightenLimits(limits, attempt);
        continue;
      }

      if (response.status === 413) {
        return (
          "Groq rechazo la solicitud por tamaño (HTTP 413) incluso recortando el contexto varias veces. " +
          "Prueba: GROQ_MAX_DOCUMENT_CHARS=12000 en backend/.env, elegir una subcarpeta en el panel, un PDF mas corto, o usar Gemini."
        );
      }

      return `Groq devolvio error HTTP ${response.status}: ${errorText}`;
    }

    return "Groq: demasiados reintentos por tamaño de solicitud.";
  } catch (error) {
    return `Groq devolvio un error: ${getErrorMessage(error)}`;
  }
}
