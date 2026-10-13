/**
 * Purga de retención (RNF-C3-IN-01). Se ejecuta cada hora y es idempotente: dos corridas
 * seguidas no dañan nada. Una consulta cumple 12 meses CALENDARIO desde su fecha; la tarea
 * horaria la depura dentro de las 24 h siguientes. Se vacían SOLO los textos e identificadores
 * ciudadanos (pregunta, respuesta, conversación y respuesta públicas) y se conservan exactamente
 * los demás campos del contrato: fecha, categoría, tipo de resultado, documentos citados (nombre,
 * enlace y fecha del catálogo publicado, sin datos ciudadanos), duración, tokens visibles, modelo,
 * tokens, tarifa y costo, además de `row_id` y la valoración que cuelga de él (RNF-C3-IN-01).
 */
import type pg from "pg";

export type PurgeResult = { runId: number; rowsPurged: number; conversationsDeleted: number };

/** Una conversación sin consultas y sin actividad en este lapso ya no puede estar en uso (el token dura 1 h). */
const STALE_CONVERSATION = "24 hours";

/**
 * `now` solo lo fijan las pruebas con fechas simuladas. En producción inicio y fin son los instantes
 * reales de la corrida, de modo que `chat.purge_run` muestra cuánto tardó cada ejecución.
 */
export async function purgeChat(db: pg.Pool, simulatedNow?: Date): Promise<PurgeResult> {
  const now = simulatedNow ?? new Date();
  const endTime = (): Date => simulatedNow ?? new Date();
  const client = await db.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO chat.purge_run (started_at, cutoff_at, status) VALUES ($1::timestamptz, $1::timestamptz - interval '12 months', 'en_curso') RETURNING run_id, cutoff_at`,
      [now]);
    const runId = Number(rows[0].run_id);
    try {
      await client.query("BEGIN");
      const purged = await client.query(
        `UPDATE chat.interaction
            SET question_text = NULL, answer_text = NULL, conversation_id = NULL, response_id = NULL,
                purged_at = $1::timestamptz
          WHERE purged_at IS NULL AND received_at + interval '12 months' <= $1::timestamptz`, [now]);
      const convs = await client.query(
        `DELETE FROM chat.conversation c
          WHERE c.last_active_at < $1::timestamptz - interval '${STALE_CONVERSATION}'
            AND NOT EXISTS (SELECT 1 FROM chat.interaction i WHERE i.conversation_id = c.conversation_id)`, [now]);
      await client.query("COMMIT");
      await client.query("UPDATE chat.purge_run SET finished_at = $2::timestamptz, rows_purged = $3, status = 'ok' WHERE run_id = $1",
        [runId, endTime(), purged.rowCount ?? 0]);
      return { runId, rowsPurged: purged.rowCount ?? 0, conversationsDeleted: convs.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      await client.query("UPDATE chat.purge_run SET finished_at = $2::timestamptz, status = 'error' WHERE run_id = $1", [runId, endTime()]).catch(() => {});
      throw error;
    }
  } finally {
    client.release();
  }
}
