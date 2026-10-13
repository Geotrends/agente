/**
 * Exportación .xlsx de las interacciones del filtro (SPEC007 T072, RF-C4-AD-02, research R11).
 *
 * ExcelJS en modo streaming sobre un archivo temporal PRIVADO y efímero: el libro se completa y se
 * valida (filas, vigencia de retención) ANTES de enviar encabezados, y el temporal se elimina en
 * todos los desenlaces. Lectura en una transacción REPEATABLE READ por lotes con cursor de
 * claves. Las celdas son cadenas explícitas (nunca fórmulas ni hipervínculos): `=`, `+`, `-`, `@`
 * al inicio no se evalúan. Sin row_id, conversation_id ni response_id.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type pg from "pg";
import { adminPool } from "./db.js";
import { ApiError } from "./contracts.js";
import { aDto, COLUMNAS, FROM, paramsDe, WHERE, type FiltroInteracciones } from "./interactions.js";
import { raizCargas } from "../kb/documentFiles.js";

const LOTE = 1000;
export const MAX_FILAS_EXPORTACION = 100_000;

export const ENCABEZADOS = [
  "Fecha y hora", "Categoría", "Pregunta", "Respuesta", "Tipo de resultado", "Documentos citados", "Modelo", "Valoración", "Motivo de la valoración",
] as const;

export type ExportacionPreparada = { ruta: string; filas: number; nombre: string; limpiar: () => Promise<void> };

/** Texto seguro para una celda: siempre cadena; vacío si no hay dato. */
const celda = (v: string | null | undefined): string => (v ?? "");

export async function prepararExportacion(
  filtro: FiltroInteracciones,
  opciones: { sesionVigente: () => Promise<boolean>; db?: pg.Pool; reintentos?: number } = { sesionVigente: async () => true },
): Promise<ExportacionPreparada> {
  const db = opciones.db ?? adminPool();
  const dir = path.join(raizCargas(), "exportaciones");
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const ruta = path.join(dir, `${randomUUID()}.xlsx`);
  const limpiar = async () => { await fsp.rm(ruta, { force: true }).catch(() => {}); };
  try {
    for (let intento = 0; ; intento++) {
      const salida = fs.createWriteStream(ruta, { mode: 0o600 });
      const libro = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: salida, useStyles: false, useSharedStrings: false });
      const hoja = libro.addWorksheet("Interacciones");
      hoja.addRow([...ENCABEZADOS]).commit();
      const client = await db.connect();
      let filas = 0;
      let minConTexto: number | null = null;
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const params = paramsDe(filtro);
        let cursor: [string, number] | null = null as [string, number] | null;
        for (;;) {
          if (!(await opciones.sesionVigente())) throw new ApiError(401, "NO_AUTENTICADO", "La sesión terminó; la exportación se canceló.");
          const lote: pg.QueryResult = await client.query(
            `SELECT ${COLUMNAS} ${FROM} WHERE ${WHERE}
                AND ($6::timestamptz IS NULL OR (i.received_at, i.row_id) < ($6::timestamptz, $7::bigint))
              ORDER BY i.received_at DESC, i.row_id DESC LIMIT ${LOTE}`,
            [...params, cursor ? cursor[0] : null, cursor ? cursor[1] : null]);
          const rows = lote.rows as Array<Record<string, unknown>>;
          for (const r of rows) {
            const d = aDto(r);
            hoja.addRow([
              d.fechaHora, celda(d.categoria), celda(d.pregunta), celda(d.respuesta), d.tipo,
              d.documentosCitados.map(c => c.nombre).filter(Boolean).join("; "), d.modelo, d.valoracion, celda(d.motivo),
            ].map(String)).commit();
            filas++;
            if (d.disponibilidad === "disponible") {
              const t = new Date(d.fechaHora).getTime();
              minConTexto = minConTexto === null ? t : Math.min(minConTexto, t);
            }
            if (filas > MAX_FILAS_EXPORTACION) throw new ApiError(422, "EXPORTACION_EXCESIVA", `El filtro supera ${MAX_FILAS_EXPORTACION} filas; acote el rango de fechas.`);
          }
          if (rows.length < LOTE) break;
          const u = rows[rows.length - 1];
          cursor = [new Date(u.received_at as string).toISOString(), Number(u.row_id)];
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release(); }
      await hoja.commit();
      await libro.commit();
      await new Promise<void>((res, rej) => { salida.once("close", () => res()); salida.once("error", rej); salida.end(); });

      // Revalida la retención justo antes de entregar: si alguna fila con texto cruzó el corte de
      // 12 meses mientras se escribía el libro, se reconstruye (el texto ya no se expone).
      const cruza = minConTexto !== null && (await db.query(
        "SELECT to_timestamp($1::double precision / 1000) + interval '12 months' <= now() AS vencida", [minConTexto])).rows[0].vencida;
      if (!cruza) return { ruta, filas, nombre: `interacciones-${new Date().toISOString().slice(0, 10)}.xlsx`, limpiar };
      if (intento >= (opciones.reintentos ?? 1)) throw new ApiError(503, "SERVICIO_NO_DISPONIBLE", "Los datos cruzaron el límite de retención durante la exportación. Intente de nuevo.");
    }
  } catch (error) {
    await limpiar();
    throw error;
  }
}

/** Elimina exportaciones huérfanas (proceso caído) con más de `maxEdadMs`; TTL ≤ 24 h. */
export async function limpiarExportacionesViejas(maxEdadMs = 60 * 60_000): Promise<number> {
  const dir = path.join(raizCargas(), "exportaciones");
  let n = 0;
  let nombres: string[] = [];
  try { nombres = await fsp.readdir(dir); } catch { return 0; }
  for (const nombre of nombres) {
    const ruta = path.join(dir, nombre);
    try { if (Date.now() - (await fsp.stat(ruta)).mtimeMs > maxEdadMs) { await fsp.rm(ruta, { force: true }); n++; } } catch { /* ya no está */ }
  }
  return n;
}
