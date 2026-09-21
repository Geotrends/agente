/**
 * Implementaciones de referencia usadas SOLO para verificar las de producción.
 *
 * Vivían en `src/services/retrievalMath.ts` junto a las versiones optimizadas
 * que verifican. Eso las hacía viajar al bundle de producción sin que ninguna
 * ruta las llamara: un oráculo existe para que una prueba pueda contrastar el
 * resultado rápido contra el resultado obvio, y ese es un rol de la suite, no
 * del servicio.
 *
 * Deben quedarse deliberadamente ingenuas. Si alguna se "optimiza" hasta
 * parecerse a la implementación real, deja de ser una comprobación
 * independiente y las pruebas que la usan pasan a verificar que el código
 * coincide consigo mismo.
 */
import { terms, weighQueryTerms, type Ranked, type WeightedQuery } from "../src/services/retrievalMath.js";

/** BM25 recorriendo todos los documentos, sin índice invertido. Oráculo de `BM25`. */
export class NaiveBM25 {
  private frequencies: Map<string, number>[];
  private lengths: number[];
  private df = new Map<string, number>();
  private average: number;
  constructor(documents: string[]) {
    this.frequencies = documents.map(text => {
      const counts = new Map<string, number>();
      for (const term of terms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const term of counts.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
      return counts;
    });
    this.lengths = this.frequencies.map(f => [...f.values()].reduce((a, b) => a + b, 0));
    this.average = this.lengths.reduce((a, b) => a + b, 0) / (documents.length || 1) || 1;
  }
  search(query: WeightedQuery): Ranked[] {
    const tokens = [...weighQueryTerms(query)];
    const n = this.frequencies.length;
    return this.frequencies.map((f, id) => ({ id, score: tokens.reduce((score, [t, weight]) => {
      const tf = f.get(t) ?? 0;
      const df = this.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      return score + weight * idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * this.lengths[id] / this.average));
    }, 0) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.id - b.id);
  }
}

/**
 * Similitud coseno sobre dos vectores sueltos. Oráculo de `topKByDot`, que usa
 * producto punto aprovechando que los vectores del índice están normalizados.
 */
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) throw new Error('Invalid embedding dimensions');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
