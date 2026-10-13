/**
 * Lectura segura de respuestas del API y mensaje fijo de fallo (RF-C4-IN-04).
 *
 * Toda causa técnica (VALIDACION, ERROR_INTERNO, SERVICIO_NO_DISPONIBLE, red, plazo, 502 con HTML,
 * cuerpo ilegible) se presenta con el MISMO texto fijo: jamás se muestran códigos, campos, mensajes
 * del servidor, rutas, modelos ni estados HTTP.
 */

export const FALLO_CONSULTA =
  "En este momento no puedo responder. Puede intentarlo de nuevo o comunicarse por los canales oficiales.";

/** Texto visible de un fallo de consulta, sea cual sea la causa. */
export function failureMessage(_causa?: string): string {
  return FALLO_CONSULTA;
}


/** Fallo al pedir la sesión anónima, con lo que el backend dijo al respecto. */
export class SessionError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

/**
 * Cuerpo JSON de la respuesta, o `undefined` si no lo es.
 *
 * Nunca lanza: las páginas de error de un proxy (502/504 en HTML) no son JSON,
 * y `response.json()` sobre ellas era justamente lo que acababa en el mensaje
 * de conexión.
 */
export async function readJsonBody<T>(response: Response): Promise<T | undefined> {
  if (!/\bjson\b/i.test(response.headers.get("content-type") ?? "")) return undefined;
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

/** `Retry-After` en segundos, si la respuesta lo trae. */
export function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
