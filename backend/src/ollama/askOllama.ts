import { getProviderModel } from "../shared/providerModel.js";
import { getResponseTokenLimit } from "../services/contextBudget.js";
import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { AskProviderInput, getErrorMessage } from "../shared/llmTypes.js";

function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

export async function askOllama({
  message,
  courseContext,
  documentsInventory,
  activeDocumentPath,
  additionalSnippets,
  history = []
}: AskProviderInput): Promise<string> {
  const model = getProviderModel("ollama");
  const url = `${ollamaBaseUrl()}/api/chat`;

  const body = {
    model,
    stream: false,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt({ documentContext: courseContext, documentsInventory, activeDocumentPath, additionalSnippets })
      },
      { role: "user", content: message }
    ],
    options: {
      temperature: 0.4,
      num_predict: getResponseTokenLimit(message, history.length)
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const raw = await response.text();

    if (!response.ok) {
      const errMsg = tryParseOllamaError(raw);
      return `Ollama HTTP ${response.status}: ${errMsg || raw.slice(0, 400)}`;
    }

    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return `Ollama devolvio algo que no es JSON: ${raw.slice(0, 300)}`;
    }

    if (typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error?: string }).error;
      if (typeof e === "string") {
        return `Ollama: ${e}`;
      }
    }

    const content = (data as { message?: { content?: string } }).message?.content;
    const answer = typeof content === "string" ? content.trim() : "";
    return answer || "No encuentro esa informacion en el documento.";
  } catch (error) {
    const msg = getErrorMessage(error);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(msg)) {
      return `No hay conexion con Ollama en ${ollamaBaseUrl()}. Abre la app Ollama o ejecuta el servicio y comprueba OLLAMA_BASE_URL en .env.`;
    }
    return `Ollama: ${msg}`;
  }
}

function tryParseOllamaError(raw: string): string | null {
  try {
    const j = JSON.parse(raw) as { error?: string };
    return typeof j.error === "string" ? j.error : null;
  } catch {
    return null;
  }
}
