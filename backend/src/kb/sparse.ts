/**
 * Vector BM25 disperso para Qdrant (research R3).
 *
 * La parte léxica de la búsqueda híbrida vive en la misma colección que la
 * semántica, para que un único cambio de alias intercambie las dos a la vez
 * (RNF-C3-IV-02). Qdrant aporta el IDF (`modifier: idf`, se recalcula solo al
 * publicar o derogar); el cliente aporta la parte de BM25 que depende del
 * documento: la frecuencia de término saturada y normalizada por longitud.
 *
 *     peso(t, d) = tf · (k1 + 1) / (tf + k1 · (1 − b + b · |d| / avgdl))
 *     puntaje(q, d) = Σ_t  peso_consulta(t) · peso(t, d) · idf(t)      ← Qdrant
 *
 * Mismo tokenizador (`terms`) y mismas constantes (k1 = 1,2; b = 0,75) que el
 * BM25 en memoria que reemplaza, para que la migración no cambie qué casa con
 * qué. `avgdl` se fija en cada construcción completa (kb_indexacion.avgdl).
 */
import { terms, weighQueryTerms, type WeightedQuery } from "../services/retrievalMath.js";

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export type VectorDisperso = { indices: number[]; values: number[] };

/** FNV-1a de 32 bits: estable entre procesos y versiones, sin dependencias. */
export function hashTermino(termino: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(termino)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combina pesos por índice: dos términos que colisionan en el hash se suman. */
function aVector(pesos: Map<number, number>): VectorDisperso {
  const ordenados = [...pesos.entries()].filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]);
  return { indices: ordenados.map(([i]) => i), values: ordenados.map(([, v]) => v) };
}

/** Número de términos de un texto: la longitud de documento de BM25. */
export function longitudBm25(texto: string): number {
  return terms(texto).length;
}

/** Vector de un fragmento indexado. */
export function vectorBm25(texto: string, avgdl: number): VectorDisperso {
  const tokens = terms(texto);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const norma = 1 - BM25_B + BM25_B * (tokens.length / Math.max(avgdl, 1));
  const pesos = new Map<number, number>();
  for (const [termino, frecuencia] of tf) {
    const peso = (frecuencia * (BM25_K1 + 1)) / (frecuencia + BM25_K1 * norma);
    const indice = hashTermino(termino);
    pesos.set(indice, (pesos.get(indice) ?? 0) + peso);
  }
  return aVector(pesos);
}

/**
 * Vector de una consulta. Cada término pesa lo que diga `weighQueryTerms`: 1
 * para la pregunta actual y `retrievalContextWeight` para la anterior (M-2).
 */
export function vectorConsulta(consulta: WeightedQuery): VectorDisperso {
  const pesos = new Map<number, number>();
  for (const [termino, peso] of weighQueryTerms(consulta)) {
    const indice = hashTermino(termino);
    pesos.set(indice, Math.max(pesos.get(indice) ?? 0, peso));
  }
  return aVector(pesos);
}

/** Texto que alimenta el BM25 de un fragmento: el mismo reparto que el índice anterior. */
export function textoLexico(fragmento: { titulo: string; url: string; direccion: string; texto: string }): string {
  return `${fragmento.url}\n${fragmento.titulo}\n${fragmento.direccion}\n${fragmento.texto}`;
}
