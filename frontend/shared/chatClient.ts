/**
 * Cliente del contrato ciudadano en español (citizen-api.md). Una sola vía a la API:
 *  - valida forma antes de usar cualquier cuerpo (un 200 incompleto no es éxito);
 *  - reloj de 45 s desde el envío hasta leer y validar el cuerpo, con AbortController (RF-C4-IN-03);
 *  - ninguna petición lleva proveedor, modelo ni identificador generado en el cliente;
 *  - sin límite artificial de caracteres: la pregunta nunca se trunca.
 */
import { AGENT_CHAT_URL } from "./agentConfig";
import { esCoherenteConSolicitud, parseConfigChat, parseErrorChat, parseRespuestaChat, type ConfigChat, type RespuestaChat } from "./chatContracts";
import { readJsonBody, retryAfterSeconds, SessionError } from "./chatErrors";
import { bindSessionToConversation, fetchWithSession } from "./session";

export const QUERY_DEADLINE_MS = 45_000;
export const CONFIG_DEADLINE_MS = 5_000;

const CONFIG_URL = AGENT_CHAT_URL.replace(/\/chat$/, "/chat/config");
const CONVERSATIONS_URL = AGENT_CHAT_URL.replace(/\/chat$/, "/conversations");

/** Resultado de una consulta; nunca contiene texto técnico del servidor. */
export type QueryOutcome =
  | { kind: "ok"; respuesta: RespuestaChat }
  | { kind: "fallo"; causa: "validacion" | "interno" | "no_interpretable" | "red" | "plazo" | "sesion" | "limite"; retryable: boolean; retryAfterSeconds?: number };

export type ConfigOutcome = { kind: "ok"; config: ConfigChat } | { kind: "fallo" };
export type ConversationOutcome =
  | { kind: "ok"; conversationId: string }
  | { kind: "fallo"; causa: "politica" | "sesion" | "servicio" | "red" };

/** Señal que se cancela por plazo o por cancelación externa (reinicio, desmontaje). */
function withDeadline(ms: number, external?: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, ms);
  const onExternal = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternal, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => { clearTimeout(timer); external?.removeEventListener("abort", onExternal); },
  };
}

/** GET /api/chat/config con tope de 5 s. Sin token: nunca antes del primer montaje del iframe. */
export async function fetchConfig(external?: AbortSignal): Promise<ConfigOutcome> {
  const d = withDeadline(CONFIG_DEADLINE_MS, external);
  try {
    const r = await fetch(CONFIG_URL, { signal: d.signal, cache: "no-store" });
    if (!r.ok) return { kind: "fallo" };
    const config = parseConfigChat(await readJsonBody<unknown>(r));
    return config ? { kind: "ok", config } : { kind: "fallo" };
  } catch {
    return { kind: "fallo" };
  } finally {
    d.dispose();
  }
}

/** POST /api/conversations: solo con «Autorizo»; el UUID lo emite el backend. */
export async function createConversation(policyVersion: string, external?: AbortSignal): Promise<ConversationOutcome> {
  const d = withDeadline(CONFIG_DEADLINE_MS * 2, external);
  try {
    const r = await fetchWithSession(AGENT_CHAT_URL, CONVERSATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autorizacion: true, policyVersion }),
      signal: d.signal,
    });
    const data = await readJsonBody<unknown>(r);
    if (r.status === 401) return { kind: "fallo", causa: "sesion" };
    if (r.status === 400) return { kind: "fallo", causa: "politica" };
    const id = typeof data === "object" && data !== null ? (data as { conversationId?: unknown }).conversationId : undefined;
    if (r.ok && typeof id === "string" && id !== "") {
      bindSessionToConversation();
      return { kind: "ok", conversationId: id };
    }
    return { kind: "fallo", causa: "servicio" };
  } catch (error) {
    return { kind: "fallo", causa: error instanceof SessionError ? "sesion" : "red" };
  } finally {
    d.dispose();
  }
}

/**
 * POST /api/chat. El plazo de 45 s cubre fetch + lectura + validación. Nunca reenvía ante 401
 * (la pertenencia de la conversación se perdió). La clasificación sigue RF-C4-IN-04.
 */
export async function sendQuery(payload: Record<string, unknown>, external?: AbortSignal, deadlineMs = QUERY_DEADLINE_MS): Promise<QueryOutcome> {
  const d = withDeadline(deadlineMs, external);
  try {
    const r = await fetchWithSession(AGENT_CHAT_URL, AGENT_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: d.signal,
    });
    const data = await readJsonBody<unknown>(r);
    if (r.ok) {
      const respuesta = parseRespuestaChat(data);
      return respuesta && esCoherenteConSolicitud(payload, respuesta)
        ? { kind: "ok", respuesta }
        : { kind: "fallo", causa: "no_interpretable", retryable: true };
    }
    if (r.status === 401) return { kind: "fallo", causa: "sesion", retryable: false };
    if (r.status === 429) return { kind: "fallo", causa: "limite", retryable: true, ...optionalRetryAfter(r) };
    const codigo = parseErrorChat(data)?.codigo;
    if (codigo === "VALIDACION") return { kind: "fallo", causa: "validacion", retryable: false };
    if (codigo === "SERVICIO_NO_DISPONIBLE" || codigo === "ERROR_INTERNO") return { kind: "fallo", causa: "interno", retryable: true, ...optionalRetryAfter(r) };
    // 502 con HTML, cuerpo ilegible, estado inesperado.
    return { kind: "fallo", causa: "no_interpretable", retryable: true };
  } catch (error) {
    if (d.timedOut()) return { kind: "fallo", causa: "plazo", retryable: true };
    if (external?.aborted) throw error; // cancelado por reinicio: el llamador lo descarta
    return error instanceof SessionError
      ? { kind: "fallo", causa: "sesion", retryable: false }
      : { kind: "fallo", causa: "red", retryable: true };
  } finally {
    d.dispose();
  }
}

function optionalRetryAfter(r: Response): { retryAfterSeconds?: number } {
  const s = retryAfterSeconds(r);
  return s ? { retryAfterSeconds: s } : {};
}
