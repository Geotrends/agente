/**
 * Calibración vigente del umbral de relevancia (RF-C3-DI-05).
 *
 * El umbral no se fija a ojo: sale del barrido sobre el oro y se guarda junto a la colección
 * que lo originó (`kb.kb_calibracion`). El runtime lo lee con el rol de solo lectura. Si la
 * colección servida no tiene calibración, o se calibró con otro embedding, otro reranker u
 * otras reglas de selección, el chat NO se declara listo: cambiar cualquiera de esas piezas
 * obliga a recalibrar.
 */
import pg from "pg";
import { embeddingModel, embeddingRuntime } from "./embeddings.js";
import { rerankerModel } from "./reranker.js";
import { SELECTION_POLICY_VERSION } from "./selection.js";

export function runtimeVersions(): { embedding: string; reranker: string; politica: string } {
  return { embedding: `${embeddingModel}@${embeddingRuntime}`, reranker: rerankerModel, politica: SELECTION_POLICY_VERSION };
}

export type CalibrationStatus =
  | { estado: "vigente"; umbral: number; coleccion: string }
  | { estado: "ausente"; coleccion: string }
  | { estado: "incompatible"; coleccion: string; motivos: string[] }
  | { estado: "no_comprobada"; coleccion: string };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: CalibrationStatus }>();
let pool: pg.Pool | undefined;

function readerPool(): pg.Pool | undefined {
  const url = process.env.APP_DATABASE_URL;
  if (!url) return undefined;
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3_000 });
    pool.on("error", () => { /* conexión inactiva perdida: se reabre sola */ });
  }
  return pool;
}

export function resetCalibrationCache(): void { cache.clear(); }
export async function closeCalibrationPool(): Promise<void> { await pool?.end(); pool = undefined; cache.clear(); }

export function evaluateRow(
  coleccion: string,
  row: { umbral: number; embedding_version: string; reranker_version: string; politica_version: string } | undefined,
  versions = runtimeVersions(),
): CalibrationStatus {
  if (!row) return { estado: "ausente", coleccion };
  const motivos: string[] = [];
  if (row.embedding_version !== versions.embedding) motivos.push("embedding");
  if (row.reranker_version !== versions.reranker) motivos.push("reranker");
  if (row.politica_version !== versions.politica) motivos.push("política de selección");
  if (!Number.isFinite(row.umbral)) motivos.push("umbral no finito");
  return motivos.length ? { estado: "incompatible", coleccion, motivos } : { estado: "vigente", umbral: row.umbral, coleccion };
}

/** Estado de la calibración de UNA colección (la que se sirve), con caché corta. */
export async function calibrationFor(coleccion: string, db: pg.Pool | undefined = readerPool()): Promise<CalibrationStatus> {
  const hit = cache.get(coleccion);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: CalibrationStatus;
  if (!db) value = { estado: "no_comprobada", coleccion };
  else {
    try {
      const { rows } = await db.query(
        "SELECT umbral, embedding_version, reranker_version, politica_version FROM kb.kb_calibracion WHERE coleccion = $1", [coleccion]);
      value = evaluateRow(coleccion, rows[0]);
    } catch {
      value = { estado: "no_comprobada", coleccion };
    }
  }
  cache.set(coleccion, { at: Date.now(), value });
  return value;
}
