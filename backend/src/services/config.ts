/**
 * Lectura y validación de la configuración de entorno (hallazgo M-8).
 *
 * No existía un solo sitio: cada módulo hacía su propio `Number(process.env.X)
 * || default`, con su propio criterio sobre qué es un valor aceptable. El
 * patrón se traga cualquier error de tipeo en silencio — `OCR_MIN_TEXT_CHARS=8O`
 * con la letra O se convierte en el valor por defecto sin que nadie se entere—,
 * y el trabajo reciente empeoró el problema: de cinco variables se pasó a once.
 *
 * Aquí se avisa en vez de callar. Lo que NO se hace es abortar el arranque: una
 * variable opcional mal escrita no justifica dejar sin servicio a quien
 * consulta, y el valor por defecto es siempre una opción razonable. Se registra
 * una advertencia con el valor recibido y el defecto aplicado, para que quien
 * administra pueda corregirlo.
 *
 * Tampoco se adopta una dependencia de validación: para once escalares, sumar
 * un paquete al árbol que A-10 ya señala como problema no compensa.
 */

/** Ya avisado, para no repetir la misma queja en cada consulta. */
const warned = new Set<string>();

function warnOnce(name: string, received: string, applied: unknown, reason: string): void {
  const key = `${name}=${received}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[config] ${name}="${received}" ${reason}; se aplica ${String(applied)}.`);
}

/** Solo para pruebas: olvida qué avisos ya se dieron. */
export function resetConfigWarnings(): void {
  warned.clear();
}

/**
 * Entero acotado. Un valor fuera de rango se recorta al extremo más cercano y
 * se avisa, en lugar de caer al defecto: si alguien pide 10.000 hilos, lo que
 * quiere es "todos los que se pueda", no "los de siempre".
 */
export function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    warnOnce(name, raw, fallback, "no es un número");
    return fallback;
  }
  const clamped = Math.max(min, Math.min(max, Math.trunc(value)));
  if (clamped !== Math.trunc(value)) {
    warnOnce(name, raw, clamped, `está fuera del rango [${min}, ${max}]`);
  }
  return clamped;
}

/** Flotante acotado, para umbrales como el de relevancia o el de Jaccard. */
export function floatFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    warnOnce(name, raw, fallback, "no es un número");
    return fallback;
  }
  if (value < min || value > max) {
    const clamped = Math.max(min, Math.min(max, value));
    warnOnce(name, raw, clamped, `está fuera del rango [${min}, ${max}]`);
    return clamped;
  }
  return value;
}

/**
 * Bandera. Solo "true"/"false" (sin distinguir mayúsculas) son valores válidos;
 * cualquier otra cosa es casi siempre un error de escritura, y merece aviso.
 */
export function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  warnOnce(name, raw, fallback, 'no es "true" ni "false"');
  return fallback;
}

/** Lista ordenada de enteros únicos, útil para porcentajes de alerta. */
export function intListFromEnv(
  name: string, fallback: number[], min: number, max: number,
): number[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return [...fallback];
  const parsed = raw.split(",").map(value => Number(value.trim()));
  if (parsed.some(value => !Number.isInteger(value) || value < min || value > max)) {
    warnOnce(name, raw, fallback.join(","), `debe ser una lista de enteros en [${min}, ${max}]`);
    return [...fallback];
  }
  return [...new Set(parsed)].sort((a, b) => a - b);
}
