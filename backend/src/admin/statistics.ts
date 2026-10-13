/**
 * Cuatro tableros agregados (SPEC007 US7, RF-C3-AD-43..46, RNF-C3-AD-07).
 *
 * Solo agregados por SQL con lista de columnas cerrada: ninguna pregunta, respuesta ni
 * identificador sale de aquí. Cada agregado se calcula con su propio COUNT/SUM (nunca sobre un
 * JOIN que multiplique filas). Una fuente que falla se informa como «no disponible»: jamás se
 * muestra como un cero normal. El modo anónimo solo contribuye a total/diario y consumo.
 */
import { Decimal } from "decimal.js";
import type pg from "pg";
import { adminPool } from "./db.js";
import { parseRangoCivil } from "./validation.js";

export type Rango = { desde: Date; hastaExcl: Date; from: string; to: string };

export function rangoDe(q: Record<string, unknown>): Rango {
  const r = parseRangoCivil(q);
  return { desde: r.desde!, hastaExcl: r.hastaExcl!, from: r.from!, to: r.to! };
}

const ENRANGO = (col: string, a = "$1", b = "$2") => `${col} >= ${a}::timestamptz AND ${col} < ${b}::timestamptz`;
const pct = (n: number, total: number): number => (total ? Math.round((n / total) * 10_000) / 100 : 0);

export async function usoGeneral(r: Rango, db: pg.Pool = adminPool()) {
  const p = [r.desde, r.hastaExcl];
  const aut = Number((await db.query(`SELECT count(*) FROM chat.interaction WHERE ${ENRANGO("received_at")}`, p)).rows[0].count);
  const anon = Number((await db.query(`SELECT count(*) FROM chat.anonymous_usage WHERE ${ENRANGO("received_at")}`, p)).rows[0].count);
  const porDia = (await db.query(
    `SELECT dia::text, sum(n)::int AS n FROM (
       SELECT (received_at AT TIME ZONE 'America/Bogota')::date AS dia, count(*) AS n FROM chat.interaction WHERE ${ENRANGO("received_at")} GROUP BY 1
       UNION ALL
       SELECT (received_at AT TIME ZONE 'America/Bogota')::date, count(*) FROM chat.anonymous_usage WHERE ${ENRANGO("received_at")} GROUP BY 1
     ) x GROUP BY dia ORDER BY dia`, p)).rows.map(x => ({ dia: x.dia as string, consultas: Number(x.n) }));
  const categorias = (await db.query(
    `SELECT COALESCE(category, 'Sin categoría') AS k, count(*)::int AS n FROM chat.interaction WHERE ${ENRANGO("received_at")} GROUP BY 1 ORDER BY n DESC, k`, p))
    .rows.map(x => ({ categoria: x.k as string, consultas: Number(x.n) }));
  const tipos = (await db.query(
    `SELECT result_type AS k, count(*)::int AS n FROM chat.interaction WHERE ${ENRANGO("received_at")} GROUP BY 1 ORDER BY n DESC, k`, p))
    .rows.map(x => ({ tipo: x.k as string, consultas: Number(x.n) }));
  return {
    rango: { from: r.from, to: r.to }, total: aut + anon, autorizadas: aut, anonimas: anon,
    porDia, porCategoria: categorias, porTipo: tipos,
    nota: "Las consultas anónimas se cuentan en el total y por día; no tienen categoría ni tipo de resultado.",
  };
}

export async function documentosCitados(r: Rango, db: pg.Pool = adminPool()) {
  const p = [r.desde, r.hastaExcl];
  // Un documento citado varias veces en la MISMA respuesta cuenta una sola vez (DISTINCT por fila).
  const { rows } = await db.query(
    `WITH citas AS (
       SELECT DISTINCT i.row_id, c ->> 'id' AS doc_id, c ->> 'nombre' AS nombre
         FROM chat.interaction i, jsonb_array_elements(i.cited_documents) c
        WHERE ${ENRANGO("i.received_at")} AND (c ->> 'id') IS NOT NULL
     )
     SELECT c.doc_id, COALESCE(max(di.titulo), max(c.nombre), c.doc_id) AS nombre,
            max(di.direccion::text) AS direccion, count(*)::int AS citas
       FROM citas c LEFT JOIN kb.document_identity di ON di.id::text = c.doc_id
      GROUP BY c.doc_id ORDER BY citas DESC, nombre ASC, c.doc_id ASC LIMIT 10`, p);
  const respuestas = Number((await db.query(
    `SELECT count(*) FROM chat.interaction WHERE ${ENRANGO("received_at")} AND jsonb_array_length(cited_documents) > 0`, p)).rows[0].count);
  const DIR: Record<string, string> = { ecosistemas: "Ecosistemas", bienestar_animal: "Bienestar Animal", gestion_ambiental: "Gestión Ambiental", secretaria_general: "Secretaría (general)" };
  return {
    rango: { from: r.from, to: r.to }, respuestasConCitas: respuestas,
    ranking: rows.map((x, i) => ({ posicion: i + 1, nombre: x.nombre as string, direccion: x.direccion ? DIR[x.direccion as string] ?? (x.direccion as string) : null, citas: Number(x.citas) })),
    anonymousCoverage: "not-recorded",
    nota: "El modo anónimo no guarda documentos citados: no se infieren citas de consultas anónimas.",
  };
}

export const MOTIVOS = ["Información incorrecta", "Información desactualizada", "No responde mi pregunta", "Difícil de entender", "Otro"] as const;

export async function valoraciones(r: Rango, db: pg.Pool = adminPool()) {
  const p = [r.desde, r.hastaExcl];
  const { rows } = await db.query(
    `SELECT valoracion, motivo, count(*)::int AS n FROM chat.valoracion WHERE ${ENRANGO("created_at")} GROUP BY 1, 2`, p);
  const util = rows.filter(x => x.valoracion === "Útil").reduce((a, x) => a + Number(x.n), 0);
  const noUtil = rows.filter(x => x.valoracion === "No útil").reduce((a, x) => a + Number(x.n), 0);
  const total = util + noUtil;
  return {
    rango: { from: r.from, to: r.to }, total, util, noUtil, porcentajeUtil: pct(util, total), porcentajeNoUtil: pct(noUtil, total),
    motivos: MOTIVOS.map(m => ({ motivo: m, cantidad: rows.filter(x => x.valoracion === "No útil" && x.motivo === m).reduce((a, x) => a + Number(x.n), 0) })),
    nota: "Solo valoraciones de consultas autorizadas: el modo anónimo no aporta.",
  };
}

export async function consumo(r: Rango, db: pg.Pool = adminPool()) {
  const p = [r.desde, r.hastaExcl];
  const { rows } = await db.query(
    `SELECT model, count(*)::int AS consultas, COALESCE(sum(input_tokens), 0)::bigint AS entrada, COALESCE(sum(output_tokens), 0)::bigint AS salida,
            COALESCE(sum(estimated_cost), 0)::text AS costo,
            count(*) FILTER (WHERE estimated_cost IS NULL AND model <> 'none')::int AS sin_costo,
            count(*) FILTER (WHERE origen = 'conversación')::int AS autorizadas, count(*) FILTER (WHERE origen = 'anónima')::int AS anonimas
       FROM (
         SELECT model, input_tokens, output_tokens, estimated_cost, 'conversación'::text AS origen FROM chat.interaction WHERE ${ENRANGO("received_at")}
         UNION ALL
         SELECT model, input_tokens, output_tokens, estimated_cost, 'anónima' FROM chat.anonymous_usage WHERE ${ENRANGO("received_at")}
       ) u GROUP BY model`, p);
  const por = (m: string) => {
    const x = rows.find(y => y.model === m);
    return {
      modelo: m, consultas: Number(x?.consultas ?? 0), autorizadas: Number(x?.autorizadas ?? 0), anonimas: Number(x?.anonimas ?? 0),
      tokensEntrada: Number(x?.entrada ?? 0), tokensSalida: Number(x?.salida ?? 0), costoTotal: String(x?.costo ?? "0"),
      consultasSinCosto: Number(x?.sin_costo ?? 0), costoParcial: Number(x?.sin_costo ?? 0) > 0,
    };
  };
  const modelos = [por("gpt-oss-20b"), por("gpt-oss-120b")];
  return {
    rango: { from: r.from, to: r.to }, modelos, rutaLocal: por("none"),
    total: {
      consultas: modelos.reduce((a, m) => a + m.consultas, 0) + por("none").consultas,
      tokensEntrada: modelos.reduce((a, m) => a + m.tokensEntrada, 0), tokensSalida: modelos.reduce((a, m) => a + m.tokensSalida, 0),
      costoTotal: rows.filter(x => x.model !== "none").reduce((a, x) => a.add(String(x.costo)), new Decimal(0)).toFixed(12),
      consultasSinCosto: modelos.reduce((a, m) => a + m.consultasSinCosto, 0),
    },
    nota: "El costo ausente (NULL) no se cuenta como cero: se informa la cantidad de consultas sin costo y el total parcial.",
  };
}
