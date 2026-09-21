/**
 * Sesión anónima contra el backend (hallazgo C-1).
 *
 * El API dejó de ser abierto: toda llamada a /api/chat necesita un JWT que el
 * propio backend emite. Para el ciudadano esto es invisible —no hay registro
 * ni login— pero permite al backend poner cuota por cliente y cortar el abuso.
 *
 * El token se guarda solo en memoria, a propósito. En `localStorage`
 * sobreviviría a la pestaña sin ganar nada: renovarlo cuesta una petición, y
 * no guardarlo evita dejar credenciales en el disco de un equipo compartido,
 * que en un canal de atención municipal es un escenario real.
 */
const SESSION_URL = (chatUrl: string) => chatUrl.replace(/\/chat$/, "/session");

let cached: { token: string; expiresAt: number } | undefined;
let inFlight: Promise<string> | undefined;

async function requestToken(chatUrl: string): Promise<string> {
  const response = await fetch(SESSION_URL(chatUrl), { method: "POST" });
  if (!response.ok) throw new Error(`No se pudo iniciar la sesión (HTTP ${response.status}).`);
  const data = (await response.json()) as { token?: string; expiresIn?: number };
  if (!data.token) throw new Error("El servidor no devolvió un token de sesión.");
  // Se renueva un minuto antes de que expire, para que una petición no salga
  // con un token que caduca mientras viaja.
  const ttl = Math.max(60, data.expiresIn ?? 3600);
  cached = { token: data.token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return data.token;
}

/** Token vigente, pidiendo uno nuevo solo si hace falta. */
export async function getSessionToken(chatUrl: string): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  // Varias peticiones simultáneas al arrancar no deben pedir cinco sesiones:
  // el límite por IP de /api/session es justo lo que castigaría eso.
  inFlight ??= requestToken(chatUrl).finally(() => { inFlight = undefined; });
  return inFlight;
}

/** Olvida el token, para forzar una sesión nueva tras un 401. */
export function clearSessionToken(): void {
  cached = undefined;
}

/**
 * `fetch` con el token puesto, que reintenta UNA vez si el backend dice que la
 * sesión ya no vale — el caso normal tras un reinicio del servidor.
 */
export async function fetchWithSession(
  chatUrl: string, url: string, init: RequestInit = {},
): Promise<Response> {
  const withToken = async (): Promise<Response> => {
    const token = await getSessionToken(chatUrl);
    return fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  };
  const response = await withToken();
  if (response.status !== 401) return response;
  clearSessionToken();
  return withToken();
}
