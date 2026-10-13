/**
 * Vigilante de la corrida semanal (RF-C3-IV-02; research R5).
 *
 * El scraper corre solo, cada ≤ 7 días, en su propio contenedor. Si no deja un
 * informe programado dentro de ese plazo (el contenedor cayó, el cron no
 * disparó, la corrida murió), el administrador debe saberlo: de lo contrario
 * la base se desactualiza sin que nada lo avise.
 */
import { kbPool, type Pool } from "./db.js";
import { notificar } from "./notifications.js";

export const PLAZO_CORRIDA_DIAS = 7;

/**
 * Notifica `verificacion_atrasada` si la última corrida programada terminó hace
 * más de 7 días o, sin ninguna, si pasaron 7 días desde la primera migración.
 * Devuelve si hay atraso. Idempotente: las repeticiones se agrupan.
 */
export async function verificarAtraso(db: Pool = kbPool()): Promise<boolean> {
  const { rows: [r] } = await db.query<{ ultima: Date | null; desde: Date | null; dias: string | null }>(
    `SELECT (SELECT max(terminada_en) FROM kb.kb_corrida WHERE programada) AS ultima,
            (SELECT min(aplicada_en) FROM kb.schema_migrations) AS desde,
            extract(epoch FROM now() - COALESCE((SELECT max(terminada_en) FROM kb.kb_corrida WHERE programada),
                                               (SELECT min(aplicada_en) FROM kb.schema_migrations))) / 86400 AS dias`);
  const dias = r?.dias === null || r?.dias === undefined ? 0 : Number(r.dias);
  if (dias <= PLAZO_CORRIDA_DIAS) return false;
  const referencia = r.ultima ? `la última corrida programada terminó el ${r.ultima.toISOString()}` : `no hay ninguna corrida programada desde ${r.desde?.toISOString()}`;
  await notificar(db, "verificacion_atrasada", "scraper",
    `La verificación de las fuentes está atrasada: ${referencia} (${Math.floor(dias)} días, el máximo es ${PLAZO_CORRIDA_DIAS}). Revisa el servicio scraper.`);
  return true;
}
