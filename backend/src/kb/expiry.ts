/**
 * Vencimiento por fecha de validez (SPEC007 T038, RF-C3-AD-38).
 *
 * La exclusión de lo vencido NO depende de este proceso: `kb.v_recuperacion` compara la validez
 * con la fecha civil de Bogotá en cada consulta, de modo que un documento deja de recuperarse al
 * comenzar el día siguiente aunque el worker se retrase. Aquí solo se materializa el estado
 * «vencido» y se emite UN aviso por documento/versión/fecha de validez.
 */
import type { Pool } from "./db.js";
import { registrarAccion } from "./audit.js";
import { notificar } from "./notifications.js";

export async function procesarVencimientos(db: Pool): Promise<number> {
  const { rows } = await db.query<{ id: string; clave: string; nombre: string; valido_hasta: string; version_publicada_id: string }>(
    `UPDATE kb.kb_elemento SET estado = 'vencido', vencimiento_avisado_para = valido_hasta, actualizado_en = now()
      WHERE estado = 'publicado' AND retirado_en IS NULL AND valido_hasta IS NOT NULL
        AND valido_hasta < (now() AT TIME ZONE 'America/Bogota')::date
        AND vencimiento_avisado_para IS DISTINCT FROM valido_hasta
      RETURNING id, clave, nombre, to_char(valido_hasta, 'YYYY-MM-DD') AS valido_hasta, version_publicada_id`);
  for (const r of rows) {
    // Objeto = documento + versión + fecha: un solo aviso por vencimiento.
    await notificar(db, "documento_vencido", `${r.clave}|${r.version_publicada_id}|${r.valido_hasta}`,
      `${r.clave} («${r.nombre}») venció el ${r.valido_hasta} y ya no se usa en las respuestas.`, { identidadDocumento: r.id });
    await registrarAccion(db, "kb-worker", "vencer", r.clave, `venció ${r.valido_hasta}`);
  }
  return rows.length;
}
