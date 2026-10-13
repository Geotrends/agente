/**
 * Retención de registros (RNF-C3-IV-03; research R14).
 *
 * Se conservan al menos 12 meses (`KB_RETENCION_MESES`, mínimo 12: un valor
 * menor se recorta con aviso en `settings.ts`). Pasado ese plazo se borran:
 *   · verificaciones y registros de procesamiento;
 *   · notificaciones YA REVISADAS: una sin revisar es trabajo pendiente del
 *     administrador y no se borra nunca, por antigua que sea;
 *   · los informes de corrida ya procesados o rechazados.
 * Lo que se borra queda contado en `kb_purga`. La auditoría de acciones del
 * operador no se purga.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { setting } from "../services/settings.js";
import { registrarAccion } from "./audit.js";
import { kbPool, type Pool } from "./db.js";
import { dirInformes } from "./informes.js";

export type ResultadoPurga = {
  limite: string;
  meses: number;
  filasPorTabla: { kb_verificacion: number; kb_procesamiento: number; kb_notificacion: number; informes: number };
};

async function borrarInformesAnteriores(limite: Date): Promise<number> {
  let borrados = 0;
  for (const sub of ["procesados", "rechazados"]) {
    const dir = path.join(dirInformes(), sub);
    let nombres: string[] = [];
    try { nombres = await fs.readdir(dir); } catch { continue; }
    for (const nombre of nombres) {
      const ruta = path.join(dir, nombre);
      const stat = await fs.stat(ruta).catch(() => undefined);
      if (stat?.isFile() && stat.mtime < limite) {
        await fs.rm(ruta, { force: true });
        borrados++;
      }
    }
  }
  return borrados;
}

export async function purgarRetencion(
  db: Pool = kbPool(), { ahora = new Date(), actor = "kb-worker" }: { ahora?: Date; actor?: string } = {},
): Promise<ResultadoPurga> {
  const meses = setting("kbRetencionMeses");
  const { rows: [{ limite }] } = await db.query<{ limite: Date }>(
    "SELECT $1::timestamptz - make_interval(months => $2) AS limite", [ahora, meses]);
  const verificaciones = await db.query("DELETE FROM kb.kb_verificacion WHERE fecha_hora < $1", [limite]);
  const procesamientos = await db.query("DELETE FROM kb.kb_procesamiento WHERE fecha < $1", [limite]);
  const notificaciones = await db.query(
    "DELETE FROM kb.kb_notificacion WHERE estado = 'revisada' AND revisada_en < $1", [limite]);
  const informes = await borrarInformesAnteriores(limite);
  const filasPorTabla = {
    kb_verificacion: verificaciones.rowCount ?? 0, kb_procesamiento: procesamientos.rowCount ?? 0,
    kb_notificacion: notificaciones.rowCount ?? 0, informes,
  };
  await db.query("INSERT INTO kb.kb_purga (filas_por_tabla) VALUES ($1)", [JSON.stringify(filasPorTabla)]);
  await registrarAccion(db, actor, "purgar_retencion", `anteriores a ${limite.toISOString()}`, JSON.stringify(filasPorTabla));
  return { limite: limite.toISOString(), meses, filasPorTabla };
}

/** ¿Ya corrió la purga en las últimas 24 horas? (el worker la ejecuta una vez al día) */
export async function purgaAlDia(db: Pool = kbPool()): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM kb.kb_purga WHERE ejecutada_en > now() - interval '1 day' LIMIT 1");
  return rows.length > 0;
}
