/**
 * Un solo adaptador para las tres APIs compatibles con OpenAI (hallazgo M-9).
 *
 * Groq, DeepSeek y OpenAI hablan el mismo protocolo y repetían el mismo
 * esqueleto tres veces: POST con `Authorization: Bearer`, la misma escalera
 * `401/403 → auth, 429 → cuota, resto → HTTP n`, y la misma extracción de
 * `choices[0].message.content`. Tres copias significaban que cualquier arreglo
 * del manejo de errores —A-4, por ejemplo— había que hacerlo tres veces y
 * acordarse de la tercera.
 *
 * Lo que queda en cada adaptador es lo único que de verdad los distingue: a
 * dónde apuntan, de qué variable sale la clave, y qué campos admite su cuerpo
 * (`max_tokens` contra `max_completion_tokens`, si mandan `temperature`).
 */
import { getResponseTokenLimit } from "../services/contextBudget.js";
import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { buildOpenAiMessages } from "../shared/chatHistory.js";
import { getProviderModel } from "./providerModel.js";
import {
  classifyHttpStatus, getErrorMessage, providerFailure,
  type AskProviderInput, type ProviderResult,
} from "./llmTypes.js";
import type { RoutedProvider } from "../services/providerRouter.js";
import { parseRetryAfter, retryConfig, withRetry } from "./retry.js";

export type OpenAiMessage = { role: string; content: string };

export type OpenAiCompatibleConfig = {
  /** Nombre visible del proveedor, tal como aparece en los mensajes al usuario. */
  label: string;
  provider: RoutedProvider;
  /** Variable de entorno con la clave; se lee en cada llamada, no al importar. */
  apiKeyEnv: string;
  /** Qué decirle a quien administra cuando falta la clave. */
  missingKeyMessage: string;
  /** Puede depender del entorno (DeepSeek permite sobrescribir la URL). */
  url: () => string;
  /** Campos propios del proveedor, sobre el cuerpo común. */
  body: (base: { model: string; messages: OpenAiMessage[] }) => Record<string, unknown>;
  /** Estados con un mensaje específico de este proveedor, antes del genérico. */
  statusMessage?: (status: number) => string | undefined;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig) {
  return async function ask({
    model: requestedModel,
    message,
    courseContext,
    history = []
  }: AskProviderInput): Promise<ProviderResult> {
    const apiKey = process.env[config.apiKeyEnv]?.trim();
    // Sin clave no se gasta una llamada: es un fallo de configuración, y no
    // mejora reintentando ni cambiando de proveedor con la misma clave ausente.
    if (!apiKey) return providerFailure("auth", config.missingKeyMessage);

    const model = getProviderModel(config.provider, requestedModel);
    const systemContent = buildSystemPrompt({ documentContext: courseContext });
    const body = config.body({
      model,
      messages: buildOpenAiMessages(systemContent, history, message),
    });

    // Un intento completo, para que `withRetry` pueda repetirlo (M-10).
    const attempt = async () => {
    try {
      const response = await fetch(config.url(), {
        method: "POST",
        signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const { kind, retryable } = classifyHttpStatus(response.status);
        const message = messageFor(config, response.status, kind, errorText);
        return {
          result: providerFailure(kind, message, `HTTP ${response.status}: ${errorText}`, retryable),
          // Si el proveedor dice cuánto esperar, se le hace caso (acotado).
          retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      };
      const choice = data.choices?.[0];
      const answer = choice?.message?.content?.trim() || "";
      // Cortado por límite de tokens sin haber escrito nada: un modelo de
      // razonamiento que gastó todo el presupuesto pensando. Eso NO es "no
      // tengo la información": tratarlo como respuesta le mostraba al usuario
      // un "No encuentro…" falso con las fuentes correctas al lado. Como
      // fallo, el enrutador prueba el proveedor de reemplazo.
      if (!answer && choice?.finish_reason === "length") {
        return {
          result: providerFailure("unknown",
            `${config.label} agotó el límite de tokens sin producir respuesta.`,
            "finish_reason=length con contenido vacío", true),
        };
      }
      // Un 200 con cuerpo vacío no es un fallo del proveedor: respondió, y lo
      // que respondió es que no tiene nada. Se trata como respuesta.
      return { result: { ok: true, answer: answer || "No encuentro esa informacion en el documento." } as ProviderResult };
    } catch (error) {
      // Incluye el aborto por timeout: desde aquí es indistinguible de la red
      // caída, y en ambos casos vale la pena reintentar.
      const detail = getErrorMessage(error);
      return { result: providerFailure("network", `${config.label} devolvio un error: ${detail}`, detail) };
    }
    };

    return withRetry(attempt, retryConfig(), (failed, delay) => {
      console.warn(`[${config.label}] ${failed.ok ? "" : failed.kind}: reintentando en ${delay} ms`);
    });
  };
}

/** El texto que se le puede enseñar a una persona. No decide nada. */
function messageFor(
  config: OpenAiCompatibleConfig, status: number, kind: string, errorText: string,
): string {
  const specific = config.statusMessage?.(status);
  if (specific) return specific;
  if (kind === "auth") return `${config.label} rechazo la autenticacion. Revisa ${config.apiKeyEnv}.`;
  if (kind === "quota") return `${config.label} indico limite de uso por ahora (quota/rate limit). Intenta mas tarde.`;
  return `${config.label} devolvio error HTTP ${status}: ${errorText}`;
}

export { getResponseTokenLimit };
