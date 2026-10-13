/**
 * Selección final de fragmentos (RF-C3-DI-04/06/12/14, contracts/retrieval.md).
 *
 * Normal: orden por puntaje descendente con ID estable; solo `puntaje > umbral` (la igualdad
 * queda fuera); los casi duplicados (Jaccard ≥ 0,6) se descartan para siempre, conservando el de
 * mayor puntaje —no vuelven por relleno—; se prefieren ≤ 3 por documento y, si SOLO un documento
 * resulta útil, se admiten hasta 8 fragmentos distintos de él; máximo 8. Si faltan alternativas
 * para llegar a 8 manteniendo la preferencia, se entregan menos: nunca se rellena bajo el umbral
 * ni con duplicados.
 *
 * Reranker caído (RF-C3-DI-06): los 8 mejores de la fusión RRF tal cual, sin umbral ni
 * diversificación.
 */
import { jaccard, shingles } from "./retrievalMath.js";

export const MAX_CANDIDATES = 16;
export const MAX_SELECTED = 8;
export const MAX_PER_DOCUMENT = 3;
export const NEAR_DUPLICATE_JACCARD = 0.6;
/** Versión de las reglas de selección; un cambio obliga a recalibrar (contracts/retrieval.md). */
export const SELECTION_POLICY_VERSION = "2026-10-08.1";

export type SelectionOptions<T> = {
  threshold: number;
  scoreOf: (item: T) => number;
  idOf: (item: T) => number;
  documentOf: (item: T) => string;
  textOf: (item: T) => string;
  limit?: number;
  maxPerDocument?: number;
  nearDuplicateJaccard?: number;
};

export function selectFragments<T>(candidates: T[], o: SelectionOptions<T>): T[] {
  const limit = o.limit ?? MAX_SELECTED;
  const sorted = [...candidates].sort((a, b) => o.scoreOf(b) - o.scoreOf(a) || o.idOf(a) - o.idOf(b));
  const passing = sorted.filter(c => o.scoreOf(c) > o.threshold);
  // Un solo documento útil → hasta 8 de él; varios → preferencia de ≤ 3 por documento.
  const usefulDocuments = new Set(passing.map(o.documentOf)).size;
  const cap = usefulDocuments <= 1 ? limit : (o.maxPerDocument ?? MAX_PER_DOCUMENT);
  const minJaccard = o.nearDuplicateJaccard ?? NEAR_DUPLICATE_JACCARD;

  const selected: T[] = [];
  const prints: Array<Set<string>> = [];
  const perDocument = new Map<string, number>();
  for (const item of passing) {
    if (selected.length >= limit) break;
    const doc = o.documentOf(item);
    if ((perDocument.get(doc) ?? 0) >= cap) continue;
    const print = shingles(o.textOf(item));
    if (prints.some(p => jaccard(print, p) >= minJaccard)) continue;
    selected.push(item);
    prints.push(print);
    perDocument.set(doc, (perDocument.get(doc) ?? 0) + 1);
  }
  return selected;
}

/** Excepción por reranker caído: los 8 primeros de la fusión, en su orden, sin filtros. */
export function selectWithoutReranker<T>(fusedInOrder: T[], limit = MAX_SELECTED): T[] {
  return fusedInOrder.slice(0, limit);
}
