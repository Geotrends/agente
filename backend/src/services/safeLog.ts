/**
 * Registro seguro de errores (RNF-C3-IN-10). Los logs y avisos llevan solo un código acotado:
 * jamás el mensaje, el objeto, la pila, cabeceras, SQL ni valores de la consulta, que podrían
 * contener texto ciudadano, tokens o credenciales.
 */
const CODE = /^(E[A-Z0-9_]{2,30}|[0-9A-Z]{5})$/;
const NAME = /^[A-Za-z]{3,40}$/;

/** Código del sistema (ECONNRESET, 57014…) o nombre de la clase del error; nunca su mensaje. */
export function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && CODE.test(code)) return code;
  const name = error instanceof Error ? error.name : "";
  return NAME.test(name) ? name : "error";
}
