/**
 * Interacciones autorizadas (SPEC007 US6, RF-C4-AD-01/02).
 *
 * Fuente ÚNICA: `chat.interaction` con su valoración 1:1; nunca `anonymous_usage` ni el CSV legado.
 * El texto sale ya enmascarado del registro (RF-C3-IN-06). Un registro con `purged_at` o con 12
 * meses calendario cumplidos presenta `disponibilidad = depurada` y texto nulo AUNQUE la purga
 * diaria se retrase. El DTO y la exportación jamás llevan row_id, conversation_id ni response_id.
 */
import type pg from "pg";
import { adminPool } from "./db.js";
import { decodeCursor, encodeCursor, type Page } from "./contracts.js";
import { parseEnum, parseRangoCivil } from "./validation.js";

export const CATEGORIAS = ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental"] as const;
export const RESULTADOS = ["respondida", "sin información", "fuera de alcance", "aclaración"] as const;
export const VALORACIONES = ["Útil", "No útil", "Sin valorar"] as const;

export type FiltroInteracciones = { desde: Date | null; hastaExcl: Date | null; categoria: string | null; resultado: string | null; valoracion: string | null };

export type InteraccionDto = {
  fechaHora: string; categoria: string; pregunta: string | null; respuesta: string | null; tipo: string;
  documentosCitados: Array<{ nombre: string; enlace: string; fecha: string }>; modelo: string;
  valoracion: "Útil" | "No útil" | "Sin valorar"; motivo: string | null; disponibilidad: "disponible" | "depurada";
};

/** Filtros del contrato (`from,to,category,resultType,rating`) con alias en español; rango por defecto: 30 días. */
export function parseFiltro(q: Record<string, unknown>): FiltroInteracciones {
  const { desde, hastaExcl } = parseRangoCivil(q);
  const cat = q.category ?? q.categoria;
  const tipo = q.resultType ?? q.tipo;
  const val = q.rating ?? q.valoracion;
  return {
    desde, hastaExcl,
    categoria: cat ? parseEnum(cat, [...CATEGORIAS, "Sin categoría"] as const, "category") : null,
    resultado: tipo ? parseEnum(tipo, RESULTADOS, "resultType") : null,
    valoracion: val ? parseEnum(val, VALORACIONES, "rating") : null,
  };
}

const COLUMNAS = `
  i.row_id, i.received_at, i.category, i.result_type, i.model, i.cited_documents, i.purged_at,
  (i.purged_at IS NOT NULL OR i.received_at + interval '12 months' <= now()) AS depurada,
  CASE WHEN i.purged_at IS NULL AND i.received_at + interval '12 months' > now() THEN i.question_text END AS question_text,
  CASE WHEN i.purged_at IS NULL AND i.received_at + interval '12 months' > now() THEN i.answer_text END AS answer_text,
  v.valoracion, v.motivo`;
const FROM = "FROM chat.interaction i LEFT JOIN chat.valoracion v ON v.interaction_row_id = i.row_id";
export const WHERE = `($1::timestamptz IS NULL OR i.received_at >= $1) AND ($2::timestamptz IS NULL OR i.received_at < $2)
  AND ($3::text IS NULL OR COALESCE(i.category, 'Sin categoría') = $3) AND ($4::text IS NULL OR i.result_type = $4)
  AND ($5::text IS NULL OR COALESCE(v.valoracion, 'Sin valorar') = $5)`;

export const paramsDe = (f: FiltroInteracciones) => [f.desde, f.hastaExcl, f.categoria, f.resultado, f.valoracion];

export function aDto(r: Record<string, unknown>): InteraccionDto {
  const citas = Array.isArray(r.cited_documents) ? r.cited_documents as Array<{ nombre?: string; enlace?: string; fecha?: string }> : [];
  return {
    fechaHora: new Date(r.received_at as string).toISOString(), categoria: (r.category as string | null) ?? "Sin categoría",
    pregunta: (r.question_text as string | null) ?? null, respuesta: (r.answer_text as string | null) ?? null, tipo: r.result_type as string,
    documentosCitados: citas.map(c => ({ nombre: String(c.nombre ?? ""), enlace: String(c.enlace ?? ""), fecha: String(c.fecha ?? "") })),
    modelo: r.model as string, valoracion: (r.valoracion as "Útil" | "No útil" | null) ?? "Sin valorar",
    motivo: (r.motivo as string | null) ?? null, disponibilidad: r.depurada ? "depurada" : "disponible",
  };
}

export async function listarInteracciones(
  f: FiltroInteracciones, q: { cursor?: unknown; limit: number }, db: pg.Pool = adminPool(),
): Promise<Page<InteraccionDto>> {
  const cur = decodeCursor(q.cursor);
  const params = paramsDe(f);
  const total = Number((await db.query(`SELECT count(*) ${FROM} WHERE ${WHERE}`, params)).rows[0].count);
  const { rows } = await db.query(
    `SELECT ${COLUMNAS}, i.received_at::text AS cursor_received_at ${FROM} WHERE ${WHERE}
        AND ($6::timestamptz IS NULL OR (i.received_at, i.row_id) < ($6::timestamptz, $7::bigint))
      ORDER BY i.received_at DESC, i.row_id DESC LIMIT $8`,
    [...params, cur ? cur[0] : null, cur ? cur[1] : null, q.limit + 1]);
  const pagina = rows.slice(0, q.limit);
  const ultimo = pagina[pagina.length - 1];
  return {
    items: pagina.map(aDto), total,
    // El row_id solo viaja dentro del cursor opaco; nunca como campo de salida.
    nextCursor: rows.length > q.limit && ultimo ? encodeCursor([String(ultimo.cursor_received_at), String(ultimo.row_id)]) : null,
  };
}

export { COLUMNAS, FROM };
