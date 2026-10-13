/**
 * Sesión técnica contra el backend (hallazgo C-1, RNF-C4-IN-01).
 *
 * El token vive SOLO en la memoria del iframe: no se escribe en sessionStorage, localStorage,
 * cookies ni URL. Recargar el iframe pide uno nuevo y destruye la conversación con él. El token
 * técnico no equivale al consentimiento ni al identificador de conversación.
 */
import { readJsonBody, retryAfterSeconds, SessionError } from "./chatErrors";

const SESSION_URL = (chatUrl: string) => chatUrl.replace(/\/chat$/, "/session");

type CachedSession = { token: string; expiresAt: number };

let cached: CachedSession | undefined;
let inFlight: Promise<string> | undefined;
/**
 * Con una conversación autorizada creada, el token es su única prueba de pertenencia: si expira o
 * se pierde NO se pide otro en silencio (no se reasocia el contexto previo ni se repite la
 * generación). La conversación se da por perdida y el ciudadano reinicia (RF-C4-IN-01/02).
 */
let boundToConversation = false;

async function requestToken(chatUrl: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(SESSION_URL(chatUrl), { method: "POST", signal });
  const data = await readJsonBody<{ token?: string; expiresIn?: number; error?: string }>(response);
  if (!response.ok) throw new SessionError(response.status, data?.error ?? "", retryAfterSeconds(response));
  if (!data?.token) throw new SessionError(response.status, "El servidor no devolvió un token de sesión.");
  // Se renueva un minuto antes de que expire.
  const ttl = Math.max(60, data.expiresIn ?? 3600);
  cached = { token: data.token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return data.token;
}

/** Token vigente, pidiendo uno nuevo solo si hace falta. Peticiones simultáneas comparten una. */
export async function getSessionToken(chatUrl: string, signal?: AbortSignal): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (boundToConversation) {
    cached = undefined;
    boundToConversation = false;
    throw new SessionError(401, "sesion_expirada");
  }
  inFlight ??= requestToken(chatUrl, signal).finally(() => { inFlight = undefined; });
  return inFlight;
}

/** Marca el token vigente como el dueño de la conversación autorizada recién creada. */
export function bindSessionToConversation(): void {
  boundToConversation = true;
}

/** Olvida el token (tras un 401 o al reiniciar la conversación). */
export function clearSessionToken(): void {
  cached = undefined;
  boundToConversation = false;
}

/** ¿Hay un portador vigente en memoria? (pruebas y guardas de flujo) */
export function hasSessionToken(): boolean {
  return cached !== undefined && Date.now() < cached.expiresAt;
}

/**
 * `fetch` con el portador puesto. NUNCA reintenta tras un 401: si el portador dejó de valer, la
 * pertenencia de la conversación se perdió y el flujo debe reiniciarse con una autorización nueva;
 * reenviar generaría una consulta con un conversationId que ya no pertenece al portador.
 */
export async function fetchWithSession(chatUrl: string, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken(chatUrl, init.signal ?? undefined);
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) clearSessionToken();
  return response;
}
