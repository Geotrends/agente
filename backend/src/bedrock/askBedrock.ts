/**
 * Adaptador Converse (contracts/bedrock-runtime.md). Una tentativa por llamada.
 *
 * Entra: ID de modelo de la lista permitida, system prompt común, pregunta e historial ya
 * saneados (datos no confiables, serializados como texto de usuario). Sale: texto, uso
 * oficial, motivo de parada y modelo efectivo. El razonamiento del modelo
 * (`reasoningContent`) se descarta: no llega a la salida, al registro ni al historial.
 */
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ModelAdapter, ModelCallResult, ModelRequest, StopReason } from "../chat/contracts.js";
import { ALLOWED_BEDROCK_MODELS } from "../services/diConfig.js";
import { setting } from "../services/settings.js";
import { pairsToTurns, serializeHistoryAsText } from "../shared/chatHistory.js";
import { bedrockClient, type ConverseSender } from "./client.js";

export type ModelErrorKind =
  | "config" | "network" | "throttle" | "timeout" | "auth" | "invalid_response" | "usage" | "stop_reason" | "empty" | "content_filtered";

/** Error seguro: el mensaje nunca lleva pregunta, respuesta ni cuerpo crudo del proveedor. */
export class ModelError extends Error {
  constructor(readonly kind: ModelErrorKind, readonly retryable: boolean, readonly diagnosticCode: string) {
    super(`model_error:${kind}:${diagnosticCode}`);
    this.name = "ModelError";
  }
}

const isAllowed = (id: string): boolean => (ALLOWED_BEDROCK_MODELS as readonly string[]).includes(id);

/** Texto de usuario: historial como datos delimitados y después la pregunta actual. */
export function buildUserText(req: ModelRequest): string {
  const hist = serializeHistoryAsText(pairsToTurns(req.historial));
  return hist ? `${hist}\n\nPregunta actual:\n${req.pregunta}` : req.pregunta;
}

type ConverseResponse = {
  output?: { message?: { content?: Array<{ text?: string; reasoningContent?: unknown }> } };
  usage?: { inputTokens?: unknown; outputTokens?: unknown };
  stopReason?: string;
};

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function classifyError(error: unknown): ModelError {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = e?.$metadata?.httpStatusCode;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return new ModelError("timeout", false, "abort");
  // Rol retirado o metadatos inalcanzables: ningún consumo ocurrió; el servicio reporta indisponibilidad.
  if (e?.name === "CredentialsProviderError" || e?.name === "CredentialsError" || e?.name === "ProviderError") return new ModelError("auth", false, "credenciales");
  if (e?.name === "ThrottlingException" || status === 429) return new ModelError("throttle", true, "429");
  if (e?.name === "AccessDeniedException" || e?.name === "UnrecognizedClientException" || status === 401 || status === 403) {
    return new ModelError("auth", false, String(status ?? "auth"));
  }
  if (e?.name === "ValidationException" || e?.name === "ResourceNotFoundException" || (status && status >= 400 && status < 500)) {
    return new ModelError("config", false, String(status ?? e?.name ?? "4xx"));
  }
  return new ModelError("network", true, String(status ?? e?.name ?? "red"));
}

export async function askBedrock(modelId: string, req: ModelRequest, sender: ConverseSender = bedrockClient()): Promise<ModelCallResult> {
  if (!isAllowed(modelId)) throw new ModelError("config", false, "modelo_no_permitido");
  const command = new ConverseCommand({
    modelId,
    system: [{ text: req.system }],
    messages: [{ role: "user", content: [{ text: buildUserText(req) }] }],
    inferenceConfig: { maxTokens: setting("bedrockMaxOutputTokens"), temperature: 0 },
  });
  let raw: ConverseResponse;
  try {
    raw = await sender.send(command, { abortSignal: req.signal }) as ConverseResponse;
  } catch (error) {
    throw classifyError(error);
  }

  const reason = raw.stopReason;
  if (reason === "content_filtered" || reason === "guardrail_intervened") throw new ModelError("content_filtered", false, reason);
  let stopReason: StopReason;
  if (reason === "end_turn") stopReason = "end_turn";
  else if (reason === "max_tokens") stopReason = "max_tokens";
  else throw new ModelError("stop_reason", false, String(reason ?? "ausente"));

  // Solo bloques de texto; reasoningContent se ignora por completo.
  const text = (raw.output?.message?.content ?? [])
    .map(block => (typeof block.text === "string" ? block.text : ""))
    .join("").trim();
  if (!text) throw new ModelError("empty", true, "sin_texto");

  const u = raw.usage;
  if (!u || !isCount(u.inputTokens) || !isCount(u.outputTokens)) throw new ModelError("usage", false, "usage_invalido");
  return { text, usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens }, stopReason, effectiveModel: modelId };
}

/** Adaptador con el cliente real (o uno inyectado en pruebas). */
export function bedrockAdapter(sender?: ConverseSender): ModelAdapter {
  return { call: (modelId, request) => askBedrock(modelId, request, sender) };
}
