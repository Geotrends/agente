/**
 * Tipos y métricas del conjunto dorado de A-12.
 *
 * `baseline.ts`/`check-baseline.ts` responden "¿cambió la recuperación?" —
 * exigen cero diferencias, y por eso no sirven para juzgar cambios que
 * *deben* mover resultados (A-5, A-6, M-3, M-5). Este módulo responde una
 * pregunta distinta: "¿de los documentos que sí importan para esta pregunta,
 * cuántos aparecen en el top-8, y en qué posición?" — sin gastar un token de
 * LLM, corriendo solo contra `hybridSearch`.
 */

export const GOLDEN_SET_FORMAT_VERSION = 1;

/**
 * "unanswerable" — preguntas factuales reales cuyo documento correcto existe
 * pero no tiene texto extraíble (verificado a mano: p. ej. un acuerdo de
 * 1899 en cursiva, ilegible para OCR incluso con una segunda configuración).
 * No es lo mismo que un fallo de recuperación: no hay nada que el ranking
 * pueda mejorar, así que se excluyen del recall/MRR/nDCG agregados —de otro
 * modo, una limitación permanente del corpus se contaría como si fuera mala
 * calidad de retrieval, que es una cosa distinta— y se reportan aparte.
 */
export type GoldenCaseKind = "factual" | "abstention" | "unanswerable";

/**
 * Un caso ya revisado por una persona (ver `finalize-golden-set.ts`).
 *
 * `relevantPaths` es la verdad de terreno: las rutas que SÍ responden la
 * pregunta. Para `kind: "abstention"` y `kind: "unanswerable"` debe quedar
 * vacío — si no lo está, la pregunta no era en realidad un caso de ese tipo
 * y `finalize-golden-set.ts` lo señala en vez de aceptarlo en silencio.
 */
export type GoldenCase = {
  id: string;
  query: string;
  kind: GoldenCaseKind;
  relevantPaths: string[];
  /** Por qué es "unanswerable" (motivo de la persona que revisó). */
  note?: string;
};

export type GoldenSet = {
  formatVersion: number;
  generatedAt: string;
  /** Cuántas filas de golden-candidates.csv se revisaron para llegar aquí. */
  reviewedCases: number;
  /** Cuántas quedaron fuera por no tener todavía relevante=s/n en cada fila. */
  pendingCases: number;
  cases: GoldenCase[];
};

/** Lo que hace falta para puntuar un caso: los hits reales, en orden. */
export type ScoredHit = { path: string };

export type CaseScore = {
  id: string;
  kind: GoldenCaseKind;
  /** Fracción de `relevantPaths` que aparece en el top-8. Casos de abstención no aplica (undefined). */
  recallAt8?: number;
  /** 1/posición del primer acierto: 0 si ninguno aparece. No aplica a abstención. */
  mrr?: number;
  /** nDCG@8 con relevancia binaria. No aplica a abstención. */
  ndcgAt8?: number;
  /** Solo para kind: "abstention" — ¿el sistema devolvió cero fragmentos? */
  abstained?: boolean;
};

const AT = 8;

/**
 * Fracción de las rutas relevantes que aparece entre los primeros `AT` hits.
 *
 * Con una sola ruta relevante (el caso típico) esto es 0 o 1. Con varias —una
 * pregunta que dos documentos distintos responden igual de bien— cuenta
 * cuántas de ellas el sistema efectivamente encontró.
 */
export function recallAt(relevantPaths: string[], hits: ScoredHit[], at = AT): number {
  if (!relevantPaths.length) return 0;
  const top = new Set(hits.slice(0, at).map(h => h.path));
  const found = relevantPaths.filter(path => top.has(path)).length;
  return found / relevantPaths.length;
}

/** 1 / posición del primer hit relevante dentro de los primeros `at`; 0 si ninguno aparece. */
export function reciprocalRank(relevantPaths: string[], hits: ScoredHit[], at = AT): number {
  const relevant = new Set(relevantPaths);
  for (let i = 0; i < Math.min(hits.length, at); i++) {
    if (relevant.has(hits[i].path)) return 1 / (i + 1);
  }
  return 0;
}

/**
 * nDCG@`at` con relevancia binaria (0/1, no hay grados de relevancia aquí).
 *
 * El orden ideal pone las `relevantPaths` primero: como mucho `at` de ellas
 * cuentan, así que el IDCG usa `min(relevantPaths.length, at)`.
 */
export function ndcgAt(relevantPaths: string[], hits: ScoredHit[], at = AT): number {
  if (!relevantPaths.length) return 0;
  const relevant = new Set(relevantPaths);
  let dcg = 0;
  for (let i = 0; i < Math.min(hits.length, at); i++) {
    if (relevant.has(hits[i].path)) dcg += 1 / Math.log2(i + 2); // posición 1-based: log2(rank+1)
  }
  let idcg = 0;
  const idealHits = Math.min(relevantPaths.length, at);
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

export function scoreCase(golden: GoldenCase, hits: ScoredHit[]): CaseScore {
  if (golden.kind === "abstention") {
    return { id: golden.id, kind: golden.kind, abstained: hits.length === 0 };
  }
  if (golden.kind === "unanswerable") {
    // Nada que puntuar: no hay documento correcto que la recuperación pueda
    // encontrar. Se deja constancia del caso, sin métricas.
    return { id: golden.id, kind: golden.kind };
  }
  return {
    id: golden.id, kind: golden.kind,
    recallAt8: recallAt(golden.relevantPaths, hits),
    mrr: reciprocalRank(golden.relevantPaths, hits),
    ndcgAt8: ndcgAt(golden.relevantPaths, hits),
  };
}

export type AggregateReport = {
  factualCount: number;
  meanRecallAt8: number;
  meanMrr: number;
  meanNdcgAt8: number;
  /** Preguntas factuales con recall 0: el sistema no encontró NINGUNA fuente correcta. */
  zeroRecallIds: string[];
  abstentionCount: number;
  abstainedCount: number;
  /** Casos de abstención donde SÍ aparece una ruta marcada relevante — la pregunta no era tal. */
  falseRelevantAbstentionIds: string[];
  /**
   * Preguntas reales sin documento legible en el corpus (no cuentan en las
   * métricas de arriba: no son un fallo de retrieval, son una limitación de
   * extracción — ver `GoldenCaseKind`).
   */
  unanswerableCount: number;
  unanswerableIds: string[];
};

export function aggregate(scores: CaseScore[], cases: GoldenCase[]): AggregateReport {
  const byId = new Map(cases.map(c => [c.id, c]));
  const factual = scores.filter(s => s.kind === "factual");
  const abstention = scores.filter(s => s.kind === "abstention");
  const unanswerable = scores.filter(s => s.kind === "unanswerable");
  const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

  return {
    factualCount: factual.length,
    meanRecallAt8: mean(factual.map(s => s.recallAt8 ?? 0)),
    meanMrr: mean(factual.map(s => s.mrr ?? 0)),
    meanNdcgAt8: mean(factual.map(s => s.ndcgAt8 ?? 0)),
    zeroRecallIds: factual.filter(s => (s.recallAt8 ?? 0) === 0).map(s => s.id),
    abstentionCount: abstention.length,
    abstainedCount: abstention.filter(s => s.abstained).length,
    falseRelevantAbstentionIds: abstention
      .filter(s => (byId.get(s.id)?.relevantPaths.length ?? 0) > 0)
      .map(s => s.id),
    unanswerableCount: unanswerable.length,
    unanswerableIds: unanswerable.map(s => s.id),
  };
}
