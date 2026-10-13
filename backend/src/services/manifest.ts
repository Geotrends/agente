/**
 * Lectura autoritativa de lo recuperable (SPEC007 T036, research R04/R05).
 *
 * El chat NO confía en el payload de Qdrant ni en el alias como autoridad:
 *   · la colección a consultar sale de `kb.active_generation` (cae al alias solo si aún no hay
 *     generación, p. ej. antes de la primera migración);
 *   · cada fragmento devuelto se valida en SQL por solicitud: su versión debe ser la publicada y el
 *     elemento estar vigente (publicado, no retirado, dentro de su validez civil en Bogotá);
 *   · la metadata de la cita (título, enlace, dirección, fechas) se SUPERPONE desde SQL, de modo que
 *     una edición o un vencimiento se reflejan en la consulta siguiente sin TTL.
 * Si la base no responde no hay forma de validar: se lanza el error (indisponibilidad), nunca se
 * entrega contenido sin validar ni se simula «sin información».
 */
import pg from "pg";
import { safeErrorCode } from "./safeLog.js";

export type Superposicion = {
  versionId: string;
  vigente: boolean;
  titulo: string;
  url: string;
  urlPadre: string | null;
  direccion: string;
  codigo: string | null;
  fechaActualizacion: string | null;
  fechaAcceso: string;
};

let pool: pg.Pool | undefined;
let avisoSinBase = false;

function lector(): pg.Pool | undefined {
  const url = process.env.APP_DATABASE_URL;
  if (!url) {
    if (!avisoSinBase) { console.warn("[manifest] Sin APP_DATABASE_URL: no se valida la vigencia en SQL (solo desarrollo)."); avisoSinBase = true; }
    return undefined;
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3_000, statement_timeout: 3_000 });
    pool.on("error", e => console.warn(`[manifest] conexión inactiva perdida: ${safeErrorCode(e)}`));
  }
  return pool;
}

export async function cerrarLectorManifiesto(): Promise<void> { await pool?.end(); pool = undefined; }
/** Solo pruebas: inyecta un pool propio. */
export function ponerLectorManifiestoParaPruebas(p: pg.Pool | undefined): void { pool = p; avisoSinBase = true; }

/** Colección servida según la generación activa; null si no hay base o aún no hay generación. */
export async function coleccionActiva(): Promise<string | null> {
  const db = lector();
  if (!db) return null;
  const { rows } = await db.query("SELECT collection_name FROM kb.active_generation");
  return rows[0]?.collection_name ?? null;
}

const titulo = (r: { codigo: string | null; nombre: string }) =>
  r.codigo && !r.nombre.toUpperCase().startsWith(r.codigo.toUpperCase()) ? `${r.codigo} - ${r.nombre}` : r.nombre;

const aFecha = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : null;

/** Estado vigente y metadata actual de los elementos indicados. */
export async function superposiciones(elementoIds: string[]): Promise<Map<string, Superposicion> | null> {
  const db = lector();
  if (!db) return null;
  const unicos = [...new Set(elementoIds)];
  const mapa = new Map<string, Superposicion>();
  if (!unicos.length) return mapa;
  const { rows } = await db.query(
    `SELECT elemento_id, version_id, vigente, codigo, nombre, direccion, url_origen, url_padre,
            fecha_actualizacion, fecha_acceso
       FROM kb.v_recuperacion WHERE elemento_id = ANY($1::uuid[])`, [unicos]);
  for (const r of rows) {
    mapa.set(r.elemento_id, {
      versionId: r.version_id, vigente: r.vigente, titulo: titulo(r), url: r.url_origen, urlPadre: r.url_padre ?? null,
      direccion: r.direccion, codigo: r.codigo ?? null, fechaActualizacion: aFecha(r.fecha_actualizacion),
      fechaAcceso: new Date(r.fecha_acceso).toISOString(),
    });
  }
  return mapa;
}

/**
 * Revalida evidencia ya recuperada (antes de entregar): true si TODOS los fragmentos siguen
 * siendo la versión publicada y vigente. Sin base configurada (desarrollo) no hay qué contrastar.
 */
export async function evidenciaVigente(hits: Array<{ documentId?: string; versionId?: string }>): Promise<boolean> {
  const ids = hits.map(h => h.documentId).filter((x): x is string => !!x);
  if (!ids.length) return true;
  const mapa = await superposiciones(ids);
  if (!mapa) return true;
  return hits.every(h => {
    if (!h.documentId) return true;
    const s = mapa.get(h.documentId);
    return !!s && s.vigente && (!h.versionId || h.versionId === s.versionId);
  });
}
