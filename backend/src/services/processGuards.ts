/**
 * Red de seguridad del proceso (hallazgo M-12) con registro seguro (RNF-C3-IN-10).
 *
 * No hay manejadores de promesas sueltas ni excepciones sin capturar en las rutas: estos son la
 * última línea. Solo registran un CÓDIGO acotado —nunca el mensaje, el objeto ni la pila, que
 * podrían traer texto ciudadano, tokens o credenciales—. No emiten avisos externos (Constitución VI).
 */
import { safeErrorCode } from "./safeLog.js";

export type ProcessGuardOptions = {
  /** Cierre ordenado ante una excepción no capturada. */
  onFatal: (reason: string, exitCode: number) => void;
  /** Emisor de eventos de proceso (inyectable en pruebas). */
  proc?: Pick<NodeJS.Process, "on" | "off">;
};

/** Registra los manejadores y devuelve la función que los retira (pruebas). */
export function registerProcessGuards(opts: ProcessGuardOptions): () => void {
  const proc = opts.proc ?? process;
  const rejection = (reason: unknown): void => {
    const code = safeErrorCode(reason);
    console.error(`[proceso] Promesa rechazada sin capturar: ${code}`);
  };
  const exception = (error: Error): void => {
    const code = safeErrorCode(error);
    console.error(`[proceso] Excepción no capturada, cerrando de forma ordenada: ${code}`);
    opts.onFatal("uncaughtException", 1);
  };
  proc.on("unhandledRejection", rejection);
  proc.on("uncaughtException", exception);
  return () => { proc.off("unhandledRejection", rejection); proc.off("uncaughtException", exception); };
}
