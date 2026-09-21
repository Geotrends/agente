import { parseRetryAfter, retryConfig, withRetry } from "../shared/retry.js";
import { setting } from "../services/settings.js";
import { getProviderModel } from "../shared/providerModel.js";
import { getResponseTokenLimit } from "../services/contextBudget.js";
import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { embedHistoryInMessage } from "../shared/chatHistory.js";
import {
  classifyHttpStatus, getErrorMessage, providerFailure,
  type AskProviderInput, type ProviderResult,
} from "../shared/llmTypes.js";

function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

/**
 * Espera máxima de Ollama (hallazgo M-10). Era el único de los cinco sin
 * timeout: si el servicio local se colgaba, la petición HTTP del ciudadano se
 * quedaba esperando indefinidamente.
 *
 * El defecto es más generoso que los 60 s de los proveedores remotos a
 * propósito: Ollama genera en la CPU de la misma máquina y una respuesta larga
 * puede tardar de verdad. Acotarlo a 60 s habría convertido en error lo que
 * hoy son generaciones lentas pero correctas.
 */
function ollamaTimeoutMs(): number {
  return setting('ollamaTimeoutMs');
}

export async function askOllama({
  model: requestedModel,
  message,
  courseContext,
  history = []
}: AskProviderInput): Promise<ProviderResult> {
  const model = getProviderModel("ollama", requestedModel);
  const url = `${ollamaBaseUrl()}/api/chat`;

  const body = {
    model,
    stream: false,
    // El historial del cliente va incrustado como texto dentro del unico
    // mensaje de usuario, nunca como turnos de rol propios (hallazgo A-9).
    messages: [
      {
        role: "system",
        content: buildSystemPrompt({ documentContext: courseContext })
      },
      { role: "user", content: embedHistoryInMessage(history, message) }
    ],
    options: {
      temperature: 0.4,
      num_predict: getResponseTokenLimit()
    }
  };

  // M-10: un intento completo, para que `withRetry` pueda repetirlo. Solo se
  // repite lo que la clasificacion de A-4 marca como reintentable: un modelo
  // inexistente o un JSON corrupto se devuelven al primer intento, porque
  // repetirlos da exactamente el mismo error.
  const attempt = async (): Promise<{ result: ProviderResult; retryAfterSeconds?: number }> => {
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(ollamaTimeoutMs()),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const raw = await response.text();

    if (!response.ok) {
      const errMsg = tryParseOllamaError(raw);
      const { kind, retryable } = classifyHttpStatus(response.status);
      return {
        result: providerFailure(kind,
          `Ollama HTTP ${response.status}: ${errMsg || raw.slice(0, 400)}`, raw.slice(0, 400), retryable),
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      };
    }

    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return { result: providerFailure("unknown",
        `Ollama devolvio algo que no es JSON: ${raw.slice(0, 300)}`, raw.slice(0, 300), false) };
    }

    if (typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error?: string }).error;
      if (typeof e === "string") return { result: providerFailure("unknown", `Ollama: ${e}`, e, false) };
    }

    const content = (data as { message?: { content?: string } }).message?.content;
    const answer = typeof content === "string" ? content.trim() : "";
    return { result: { ok: true, answer: answer || "No encuentro esa informacion en el documento." } };
  } catch (error) {
    const msg = getErrorMessage(error);
    // Ollama es local: si no esta levantado, el mensaje debe decir que hacer.
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|network|abort|timeout/i.test(msg)) {
      return { result: providerFailure("network",
        `No hay conexion con Ollama en ${ollamaBaseUrl()}. Abre la app Ollama o ejecuta el servicio y comprueba OLLAMA_BASE_URL en .env.`,
        msg) };
    }
    return { result: providerFailure("network", `Ollama: ${msg}`, msg) };
  }
  };

  return withRetry(attempt, retryConfig(), (failed, delay) => {
    console.warn(`[ollama] intento fallido (${failed.ok ? "" : failed.kind}); se reintenta en ${delay} ms.`);
  });
}

function tryParseOllamaError(raw: string): string | null {
  try {
    const j = JSON.parse(raw) as { error?: string };
    return typeof j.error === "string" ? j.error : null;
  } catch {
    return null;
  }
}
