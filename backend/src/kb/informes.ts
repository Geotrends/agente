/**
 * Cola de informes de corrida en disco (research R5; RF-C3-IV-02).
 *
 * El scraper deja `<run_id>.json` en el directorio de informes (volumen
 * `geobot-runs`). El kb-worker los procesa en orden de inicio de la corrida y
 * los mueve a `procesados/`; uno inválido va a `rechazados/` con una
 * notificación, para que un archivo roto no bloquee la cola para siempre.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Pool } from "./db.js";
import { notificar } from "./notifications.js";
import { esInformeListo, InformeInvalido } from "./runReport.js";
import { procesarInforme, type ResumenSincronizacion } from "./sync.js";

export function dirInformes(): string {
  return path.resolve(process.env.KB_RUNS_DIR ?? path.join(process.env.GEOTRENDS_DOCUMENTS_ROOT ?? "data", "runs"));
}

async function mover(origen: string, subdir: string): Promise<void> {
  const destino = path.join(path.dirname(origen), subdir, path.basename(origen));
  await fsp.mkdir(path.dirname(destino), { recursive: true });
  try {
    await fsp.rename(origen, destino);
  } catch (error) {
    // Otro proceso (worker o CLI) ya lo movió: el resultado es el que se buscaba.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Informes listos, ordenados por `iniciada_en` (los ilegibles al final, se rechazan al procesarlos). */
async function informesListos(dir: string): Promise<string[]> {
  let nombres: string[];
  try { nombres = (await fsp.readdir(dir)).filter(esInformeListo); } catch { return []; }
  const conFecha = await Promise.all(nombres.map(async nombre => {
    const ruta = path.join(dir, nombre);
    try {
      const { iniciada_en } = JSON.parse(await fsp.readFile(ruta, "utf8")) as { iniciada_en?: string };
      return { ruta, t: Date.parse(iniciada_en ?? "") || Number.MAX_SAFE_INTEGER };
    } catch {
      return { ruta, t: Number.MAX_SAFE_INTEGER };
    }
  }));
  return conFecha.sort((a, b) => a.t - b.t || a.ruta.localeCompare(b.ruta)).map(x => x.ruta);
}

let enCurso: Promise<ResumenSincronizacion[]> | undefined;

/** Procesa todos los informes pendientes. Reentrante: si ya hay una pasada en curso, la espera. */
export function procesarPendientes(db: Pool, dir = dirInformes()): Promise<ResumenSincronizacion[]> {
  enCurso ??= (async () => {
    const resumenes: ResumenSincronizacion[] = [];
    for (const ruta of await informesListos(dir)) {
      try {
        const resumen = await procesarInforme(db, ruta);
        resumenes.push(resumen);
        if (resumen.enProceso) {
          console.log(`[kb-worker] Corrida ${resumen.corrida}: la está procesando otro proceso; se deja el informe en su sitio.`);
          continue;
        }
        await mover(ruta, "procesados");
        console.log(`[kb-worker] Corrida ${resumen.corrida}: ${resumen.verificaciones} verificaciones, ` +
          `${resumen.elementosNuevos} nuevos, ${resumen.versionesPendientes} versiones pendientes, ${resumen.bajas.length} bajas.`);
      } catch (error) {
        if (error instanceof InformeInvalido) {
          await mover(ruta, "rechazados");
          await notificar(db, "verificacion_fallida", path.basename(ruta), `Informe de corrida rechazado: ${error.message}`);
          continue;
        }
        // Un fallo de infraestructura (PostgreSQL, Qdrant) deja el informe en
        // su sitio para reintentarlo en el ciclo siguiente.
        throw error;
      }
    }
    return resumenes;
  })().finally(() => { enCurso = undefined; });
  return enCurso;
}

/**
 * Vigila el directorio y llama `alAparecer` cuando se renombra un `.json`
 * (el scraper escribe `.tmp` y renombra). El sondeo periódico queda como
 * respaldo: `fs.watch` no es fiable en todos los sistemas de archivos.
 */
export function vigilarInformes(alAparecer: () => void, dir = dirInformes()): fs.FSWatcher | undefined {
  try {
    fs.mkdirSync(dir, { recursive: true });
    let pendiente: NodeJS.Timeout | undefined;
    const watcher = fs.watch(dir, (_evento, nombre) => {
      if (!nombre || !esInformeListo(String(nombre))) return;
      clearTimeout(pendiente);
      pendiente = setTimeout(alAparecer, 1_000);   // agrupa ráfagas de eventos
    });
    watcher.unref();
    return watcher;
  } catch (error) {
    console.warn(`[kb-worker] No se pudo vigilar ${dir}; queda el sondeo: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}
