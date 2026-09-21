import type { ChatTurn } from "./chatHistory.js";

export type AskProviderInput = {
  model?: string;
  message: string;
  courseContext: string;
  history?: ChatTurn[];
};

/**
 * Por qué falló un proveedor (hallazgo A-4). Lo que importa de esta división no
 * es la taxonomía en sí, sino `retryable`: reintentar un 401 es quemar tiempo y
 * cuota, y caer al siguiente proveedor tampoco lo arregla si la clave de ese
 * también está mal.
 */
export type ProviderFailureKind = "auth" | "quota" | "model" | "network" | "size" | "unknown";

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

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
