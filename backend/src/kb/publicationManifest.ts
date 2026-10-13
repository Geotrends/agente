/**
 * Generación activa y manifiesto de lo que sirve el chat (SPEC007 T030, research R04).
 *
 * PostgreSQL es la autoridad: `kb.active_generation` dice QUÉ colección física se sirve y
 * `kb.generation_manifest` qué versión de cada elemento contiene. El alias `kb_chunks` de Qdrant
 * queda como espejo reconciliable. No hay transacción distribuida: el orden de operaciones es
 * preparar la candidata completa → commit SQL único → reconciliar alias → limpiar la anterior.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "./db.js";
import { coleccionDelAlias, qdrant } from "../services/qdrant.js";

type Db = Pool | PoolClient;

export type EntradaManifiesto = { elementoId: string; versionId: string; hash: string; revisionMetadata: string };

export type GeneracionActiva = {
  generacionId: string; coleccion: string; manifiestoHash: string; revision: string; confirmadaEn: Date;
};

export function hashManifiesto(entradas: EntradaManifiesto[]): string {
  const lineas = [...entradas].sort((a, b) => a.elementoId.localeCompare(b.elementoId))
    .map(e => `${e.elementoId}:${e.versionId}:${e.hash}:${e.revisionMetadata}`);
  return createHash("sha256").update(lineas.join("\n")).digest("hex");
}

export async function generacionActiva(db: Db): Promise<GeneracionActiva | null> {
  const { rows } = await db.query(
    "SELECT generation_id, collection_name, manifest_hash, revision, committed_at FROM kb.active_generation");
  const r = rows[0];
  return r ? { generacionId: r.generation_id, coleccion: r.collection_name, manifiestoHash: r.manifest_hash,
    revision: String(r.revision), confirmadaEn: r.committed_at } : null;
}

/**
 * Commit único (dentro de la transacción del llamador): reemplaza el manifiesto y apunta la
 * generación activa a la colección candidata. Devuelve la generación anterior.
 */
export async function confirmarGeneracion(
  client: PoolClient, coleccion: string, entradas: EntradaManifiesto[],
): Promise<{ generacionId: string; anterior: GeneracionActiva | null }> {
  const anterior = await generacionActiva(client);
  const generacionId = randomUUID();
  const hash = hashManifiesto(entradas);
  for (const e of entradas) {
    await client.query(
      `INSERT INTO kb.generation_manifest (generation_id, element_id, version_id, content_hash, metadata_revision)
       VALUES ($1,$2,$3,$4,$5)`, [generacionId, e.elementoId, e.versionId, e.hash, e.revisionMetadata]);
  }
  await client.query(
    `INSERT INTO kb.active_generation (singleton, generation_id, collection_name, manifest_hash)
     VALUES (true, $1, $2, $3)
     ON CONFLICT (singleton) DO UPDATE SET generation_id = EXCLUDED.generation_id, collection_name = EXCLUDED.collection_name,
       manifest_hash = EXCLUDED.manifest_hash, revision = kb.active_generation.revision + 1, committed_at = now()`,
    [generacionId, coleccion, hash]);
  // Los manifiestos de generaciones anteriores a la inmediata ya no sirven para nada.
  await client.query("DELETE FROM kb.generation_manifest WHERE generation_id <> $1 AND generation_id <> $2",
    [generacionId, anterior?.generacionId ?? randomUUID()]);
  return { generacionId, anterior };
}

/** Manifiesto vigente reconstruido desde la matriz (versiones publicadas). */
export async function manifiestoDeMatriz(db: Db): Promise<EntradaManifiesto[]> {
  const { rows } = await db.query(
    `SELECT e.id, e.version_publicada_id AS version_id, v.hash_contenido, e.revision
       FROM kb.kb_elemento e JOIN kb.kb_version v ON v.id = e.version_publicada_id
      WHERE e.estado IN ('publicado', 'vencido') AND e.retirado_en IS NULL ORDER BY e.id`);
  return rows.map(r => ({ elementoId: r.id, versionId: r.version_id, hash: r.hash_contenido, revisionMetadata: String(r.revision) }));
}

/**
 * Alias de Qdrant → generación activa (espejo). Idempotente: si el alias ya apunta a la colección
 * activa no hace nada. Nunca borra colecciones.
 */
export async function reconciliarAlias(db: Db, alias: string, cliente = qdrant(120_000)): Promise<"ok" | "movido" | "sin_generacion"> {
  const g = await generacionActiva(db);
  if (!g) return "sin_generacion";
  const actual = await coleccionDelAlias(cliente, alias);
  if (actual === g.coleccion) return "ok";
  const actions: Array<Record<string, unknown>> = [];
  if (actual) actions.push({ delete_alias: { alias_name: alias } });
  actions.push({ create_alias: { collection_name: g.coleccion, alias_name: alias } });
  await cliente.updateCollectionAliases({ actions: actions as never });
  return "movido";
}

/**
 * Arranque: si aún no hay generación activa pero el alias apunta a una colección, la adopta
 * contrastando el manifiesto de la matriz con los elementos realmente indexados. Si discrepan
 * NO se adopta (la generación se creará en la siguiente reindexación) y se informa.
 */
export async function adoptarGeneracionInicial(
  db: Pool, alias: string, elementosIndexados: (coleccion: string) => Promise<Set<string>>,
): Promise<"adoptada" | "existente" | "sin_alias" | "discrepante"> {
  if (await generacionActiva(db)) return "existente";
  const coleccion = await coleccionDelAlias(qdrant(120_000), alias);
  if (!coleccion) return "sin_alias";
  const entradas = await manifiestoDeMatriz(db);
  const indexados = await elementosIndexados(coleccion);
  const esperados = new Set(entradas.map(e => e.elementoId));
  const igual = indexados.size === esperados.size && [...esperados].every(id => indexados.has(id));
  if (!igual) return "discrepante";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE kb.active_generation IN EXCLUSIVE MODE");
    if (!(await generacionActiva(client))) await confirmarGeneracion(client, coleccion, entradas);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return "adoptada";
}

/**
 * Recalcula el manifiesto de la generación ACTIVA tras un cambio que no reconstruye la colección
 * (retiro, derogación). Mantiene la misma colección física y sube la revisión.
 */
export async function refrescarManifiestoActivo(client: PoolClient): Promise<void> {
  const g = await generacionActiva(client);
  if (!g) return;
  const entradas = await manifiestoDeMatriz(client);
  await client.query("DELETE FROM kb.generation_manifest WHERE generation_id = $1", [g.generacionId]);
  for (const e of entradas) {
    await client.query(
      `INSERT INTO kb.generation_manifest (generation_id, element_id, version_id, content_hash, metadata_revision)
       VALUES ($1,$2,$3,$4,$5)`, [g.generacionId, e.elementoId, e.versionId, e.hash, e.revisionMetadata]);
  }
  await client.query(
    "UPDATE kb.active_generation SET manifest_hash = $1, revision = revision + 1, committed_at = now() WHERE generation_id = $2",
    [hashManifiesto(entradas), g.generacionId]);
}
