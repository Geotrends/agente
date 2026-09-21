/**
 * Cómo arrancar un worker de este proyecto, en desarrollo y compilado.
 *
 * Dos detalles que no son evidentes y que hay que resolver una sola vez, por eso
 * viven aquí y no duplicados en cada cliente de worker.
 */
import os from 'node:os';

/**
 * Bajo `tsx`, Node resuelve la entrada del worker SIN pasar por el loader, así
 * que un `./algoWorker.js` no encuentra el `.ts`. Se arranca con un módulo
 * intermedio que registra tsx dentro del propio worker y después importa la
 * entrada real. Compilado a `dist/` no hace falta: ahí el `.js` existe.
 *
 * @param name  Nombre del módulo hermano, sin extensión: `"retrievalWorker"`.
 */
export function workerEntry(name: string): URL {
  const isTypeScript = import.meta.url.endsWith('.ts');
  const entry = new URL(`./${name}${isTypeScript ? '.ts' : '.js'}`, import.meta.url);
  if (!isTypeScript) return entry;

  const tsxApi = new URL('../../node_modules/tsx/dist/esm/api/index.mjs', import.meta.url);
  const bootstrap =
    `import { register } from ${JSON.stringify(tsxApi.href)};\n` +
    `register();\n` +
    `await import(${JSON.stringify(entry.href)});\n`;
  return new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`);
}

/**
 * Opciones que un worker no puede heredar del proceso padre.
 *
 * `worker_threads` copia `process.execArgv` tal cual, y varias de esas banderas
 * solo tienen sentido para el proceso principal: heredarlas hace que el worker
 * ni siquiera arranque. Con `node --input-type=module -e "..."`, por ejemplo,
 * falla con ERR_INPUT_TYPE_NOT_ALLOWED antes de cargar nada.
 */
const NOT_INHERITABLE = /^--(input-type|eval|print|interactive|check)(=|$)/;

export function workerExecArgv(): string[] {
  return process.execArgv.filter(argument => !NOT_INHERITABLE.test(argument));
}

/**
 * Lee una variable de entorno entera, con mínimo, máximo y valor por defecto.
 *
 * El dimensionado de los pools se ajusta en producción sin recompilar, y un
 * valor absurdo —vacío, texto, negativo— debe caer en el defecto en vez de
 * dejar el servicio sin trabajadores.
 */
/**
 * Se reexporta desde `config.ts`, que es donde vive ahora la validación de toda
 * la configuración (hallazgo M-8). Aquí se mantiene el nombre porque media
 * docena de módulos ya lo importaban de este sitio.
 */
export { intFromEnv } from "./config.js";

/**
 * `Omit<T, "id">` sobre una unión la colapsa a las claves comunes; esto la
 * distribuye miembro a miembro, que es lo que hace falta para escribir la
 * petición sin su identificador y que el compilador siga viendo cada variante.
 */
export type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never;

/** Núcleos utilizables, con un suelo de 1 para entornos que no los reportan. */
export function availableCores(): number {
  return Math.max(1, os.cpus().length || 1);
}
