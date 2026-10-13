import type { ChatTurn } from "./chatHistory.js";

export type AskProviderInput = {
  model?: string;
  message: string;
  courseContext: string;
  history?: ChatTurn[];
  /**
   * Plazo de la petición HTTP completa. Al vencer corta el intento en curso y
   * los reintentos pendientes: sin esto el presupuesto de fallback solo se
   * comprobaba ANTES de empezar cada proveedor, y uno que empezaba a tiempo
   * podía seguir 2 × 60 s más y pasarse del timeout del proxy.
   */
  signal?: AbortSignal;
};

/**
 * Por qué falló un proveedor (hallazgo A-4). Lo que importa de esta división no
 * es la taxonomía en sí, sino `retryable`: reintentar un 401 es quemar tiempo y
 * cuota, y caer al siguiente proveedor tampoco lo arregla si la clave de ese
 * también está mal.
 *
 * `timeout` es el plazo de la petición, no el de un intento: un intento que
 * vence por su cuenta sigue siendo `network`, que sí vale la pena repetir.
 */
export type ProviderFailureKind =
  | "auth" | "quota" | "model" | "network" | "size" | "timeout" | "circuit_open" | "unknown";

/**
 * Resultado de un proveedor, con el éxito y el fallo distinguidos en el TIPO.
 *
 * Antes todos devolvían `Promise<string>` tanto al responder como al fallar, y
 * para saber cuál era cuál se aplicaba una expresión regular al texto en
 * español del mensaje. El acoplamiento era a la redacción: corregir una tilde
 * rompía el fallback en silencio. Y como el fallo llegaba a la ruta HTTP con un
 * 200, acababa archivado en el CSV de interacciones como si fuera una respuesta
 * al ciudadano, contaminando el conjunto de evaluación de A-12.
 *
 * `message` es el texto que se le puede mostrar a una persona: presentación,
 * no control de flujo.
 */
export type ProviderResult =
  | { ok: true; answer: string }
  | { ok: false; kind: ProviderFailureKind; retryable: boolean; detail: string; message: string };

export function providerFailure(
  kind: ProviderFailureKind, message: string, detail = message, retryable?: boolean,
): ProviderResult {
  // La red y la saturación pasan solas; una clave mala, un modelo inexistente o
  // una petición demasiado grande no mejoran repitiendo lo mismo.
  const byKind = kind === "network" || kind === "quota";
  return { ok: false, kind, retryable: retryable ?? byKind, detail, message };
}

/**
 * Clasifica un estado HTTP en tipo y reintentabilidad a la vez, porque las dos
 * cosas se deciden con el mismo dato y separarlas invita a que se contradigan.
 */
export function classifyHttpStatus(status: number): { kind: ProviderFailureKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (status === 404) return { kind: "model", retryable: false };
  if (status === 413) return { kind: "size", retryable: false };
  if (status === 429) return { kind: "quota", retryable: true };
  // Un 5xx es del otro lado y suele pasarse solo; un 4xx que no reconocemos es
  // nuestro, y repetir la misma petición dará el mismo error.
  return { kind: "unknown", retryable: status >= 500 };
}

/**
 * Lo que se le dice al ciudadano cuando falla el proveedor.
 *
 * `message` y `detail` están escritos para quien opera: nombran variables de
 * entorno ("Revisa OPENAI_API_KEY") y copian el cuerpo HTTP o el error del SDK
 * del proveedor. Devolverlos en la respuesta pública filtraba detalles internos
 * a cualquiera; se quedan en el log y aquí solo se distingue lo que cambia qué
 * puede hacer la persona: esperar un momento o esperar unos minutos.
 */
export function publicFailureMessage(kind: ProviderFailureKind): string {
  if (kind === "timeout") return "La respuesta tardó demasiado. Intenta de nuevo en un momento.";
  if (kind === "quota") return "El servicio está recibiendo muchas consultas. Intenta de nuevo en unos minutos.";
  return "No pude generar la respuesta en este momento. Intenta de nuevo más tarde.";
}

/** Fallo por plazo agotado, igual para todos los proveedores. */
export function deadlineFailure(label: string): ProviderResult {
  return providerFailure("timeout",
    `${label} no respondió a tiempo. Intenta de nuevo en un momento.`,
    "plazo de la petición agotado", false);
}

/**
 * Señal de un intento: su propio timeout más el plazo de la petición, si hay.
 * Cualquiera de los dos que venza primero corta la llamada.
 */
export function attemptSignal(timeoutMs: number, deadline?: AbortSignal): AbortSignal {
  const perAttempt = AbortSignal.timeout(timeoutMs);
  return deadline ? AbortSignal.any([perAttempt, deadline]) : perAttempt;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Resultado de una llamada a un modelo con los datos que exige el registro de
 * consumo (RF-C3-DI-16/18): uso oficial, motivo de parada y modelo efectivo.
 * Es interno; ninguno de estos campos llega al ciudadano.
 */
export type ModelUsage = { inputTokens: number; outputTokens: number };
export type ModelStopReason = "end_turn" | "max_tokens" | "other";
export type ModelCallOutput = {
  text: string;
  usage: ModelUsage;
  stopReason: ModelStopReason;
  effectiveModel: string;
};
