/**
 * Archivos de cargas manuales (SPEC007 T031): directorio privado compartido entre el backend
 * (que recibe) y el kb-worker (que convierte). Nada de lo que escribe el panel sale de aquí ni
 * acepta rutas del cliente: cada archivo vive bajo un nombre generado por el servidor.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function raizCargas(): string {
  return path.resolve(process.env.KB_UPLOAD_DIR?.trim() || path.join(os.tmpdir(), "geobot-cargas"));
}

export const dirStaging = (): string => path.join(raizCargas(), "staging");
export const dirArchivos = (): string => path.join(raizCargas(), "archivos");

export async function asegurarDirectorios(): Promise<void> {
  await fs.mkdir(dirStaging(), { recursive: true, mode: 0o700 });
  await fs.mkdir(dirArchivos(), { recursive: true, mode: 0o700 });
}

export function rutaStaging(): string { return path.join(dirStaging(), `${randomUUID()}.parte`); }

/** Referencia estable guardada en la base: `archivos/<uuid>.<ext>`, relativa a la raíz. */
export function nuevaReferencia(extension: "pdf" | "docx" | "xlsx"): string {
  return `archivos/${randomUUID()}.${extension}`;
}

/** Ruta absoluta de una referencia, sin salir de la raíz de cargas. */
export function resolverReferencia(ref: string): string {
  if (!/^archivos\/[0-9a-f-]{36}\.(pdf|docx|xlsx)$/.test(ref)) throw new Error("referencia de archivo no válida");
  return path.join(raizCargas(), ref);
}

/** Elimina un archivo y comprueba su ausencia. true si ya no existe. */
export async function eliminarArchivo(ref: string | null | undefined): Promise<boolean> {
  if (!ref) return true;
  const ruta = resolverReferencia(ref);
  await fs.rm(ruta, { force: true });
  return fs.access(ruta).then(() => false, () => true);
}

/** Limpia temporales de staging más antiguos que `maxEdadMs` (desconexiones, procesos caídos). */
export async function limpiarStagingViejo(maxEdadMs = 60 * 60_000): Promise<number> {
  let n = 0;
  let nombres: string[] = [];
  try { nombres = await fs.readdir(dirStaging()); } catch { return 0; }
  for (const nombre of nombres) {
    const ruta = path.join(dirStaging(), nombre);
    try {
      const st = await fs.stat(ruta);
      if (Date.now() - st.mtimeMs > maxEdadMs) { await fs.rm(ruta, { force: true }); n++; }
    } catch { /* ya no está */ }
  }
  return n;
}
