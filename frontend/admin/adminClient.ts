/**
 * Cliente tipado del panel: sobre `shared/adminSession` (cookie HttpOnly + CSRF en memoria).
 * Nunca guarda preguntas, textos ni identificadores en almacenamiento local ni en la URL.
 */
import { llamar, tokenCsrf, type ErrorApi, type Resultado } from "../shared/adminSession";

export { llamar };
export type { ErrorApi, Resultado };

/** Navegación inyectable: las pruebas la sustituyen; en producción es una carga de página completa. */
export const navegacion = {
  ir(ruta: string): void { window.location.assign(ruta); },
};

/** Mensaje en lenguaje de la persona para un error de la API (sin detalles internos). */
export function mensajeError(error: ErrorApi, status: number): string {
  if (status === 503) return "El servicio no está disponible en este momento. Intente de nuevo en unos minutos.";
  if (status === 0) return error.mensaje;
  if (status === 403) return error.codigo === "CAMBIO_CONTRASENA_REQUERIDO"
    ? "Debe cambiar la contraseña temporal antes de continuar."
    : "Su perfil no tiene acceso a esta función.";
  if (status === 409) return error.codigo === "REVISION_OBSOLETA"
    ? "Otra persona modificó este elemento. Recargue y vuelva a intentar."
    : error.mensaje;
  return error.mensaje;
}

/** Envía un formulario multipart (carga de documentos) con el token CSRF de la sesión. */
export async function subirArchivo<T>(path: string, form: FormData, idempotencyKey?: string): Promise<Resultado<T>> {
  try {
    const res = await fetch(`/api/admin${path}`, {
      method: "POST", credentials: "same-origin", body: form,
      headers: { ...(tokenCsrf() ? { "X-CSRF-Token": tokenCsrf() } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    });
    const text = await res.text();
    const json = text && /json/i.test(res.headers.get("content-type") ?? "") ? JSON.parse(text) : undefined;
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    return { ok: false, status: res.status, error: json?.error ?? { codigo: "ERROR", mensaje: "No se pudo completar la operación." } };
  } catch {
    return { ok: false, status: 0, error: { codigo: "RED", mensaje: "No hay conexión con el servidor. Intente de nuevo." } };
  }
}
