/**
 * Calibración del umbral de relevancia (RF-C3-DI-05, contracts/retrieval.md).
 *
 * Se define de antemano qué preguntas del oro son respondibles y cuáles no tienen respuesta en el
 * corpus. Para CADA valor finito del barrido se ejecuta la selección final y se cuenta cuántas
 * respondibles terminarían con texto de ausencia (falsa abstención). El umbral elegido es el
 * MAYOR valor con cero falsas abstenciones; si no existe, es un error de calibración (hallazgo
 * REAL) y no se activa nada a ojo. Se conservan los resultados de todas las preguntas y valores.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { MAX_SELECTED, SELECTION_POLICY_VERSION, selectFragments } from "../services/selection.js";

export type CalibrationCandidate = { id: number; rerank: number; documentId: string; text: string };

export type CalibrationQuestion = {
  id: string;
  kind: "respondible" | "ausente";
  /** Candidatos (hasta 16) con el puntaje del reranker, tal como los recibe la selección. */
  candidates: CalibrationCandidate[];
};

export type SweepRow = {
  value: number;
  falseAbstentions: number;
  /** Preguntas respondibles que terminan sin ningún fragmento con este valor. */
  falseAbstentionIds: string[];
  respondibles: number;
  /** Ausentes que terminan sin fragmentos (abstención correcta). */
  correctAbstentions: number;
  ausentes: number;
  /** Fracción de respondibles con al menos un fragmento. */
  recall: number;
};

export class CalibrationError extends Error {
  constructor(message: string, readonly report?: Partial<CalibrationReport>) { super(message); this.name = "CalibrationError"; }
}

/** Valores finitos del barrido: cada puntaje observado más un piso por debajo del mínimo. */
export function sweepValues(questions: CalibrationQuestion[]): number[] {
  const scores = new Set<number>();
  for (const q of questions) for (const c of q.candidates) if (Number.isFinite(c.rerank)) scores.add(c.rerank);
  if (!scores.size) return [];
  const sorted = [...scores].sort((a, b) => a - b);
  return [sorted[0] - 1, ...sorted];
}

function endsEmpty(q: CalibrationQuestion, threshold: number): boolean {
  return selectFragments(q.candidates, {
    threshold, scoreOf: c => c.rerank, idOf: c => c.id, documentOf: c => c.documentId, textOf: c => c.text, limit: MAX_SELECTED,
  }).length === 0;
}

export function runSweep(questions: CalibrationQuestion[], values = sweepValues(questions)): SweepRow[] {
  const resp = questions.filter(q => q.kind === "respondible");
  const aus = questions.filter(q => q.kind === "ausente");
  return values.map(value => {
    const falseIds = resp.filter(q => endsEmpty(q, value)).map(q => q.id);
    return {
      value, falseAbstentions: falseIds.length, falseAbstentionIds: falseIds,
      respondibles: resp.length, ausentes: aus.length,
      correctAbstentions: aus.filter(q => endsEmpty(q, value)).length,
      recall: resp.length ? (resp.length - falseIds.length) / resp.length : 1,
    };
  });
}

/** MAYOR valor con cero falsas abstenciones, o null si ninguno lo logra. */
export function chooseThreshold(rows: SweepRow[]): number | null {
  const valid = rows.filter(r => r.falseAbstentions === 0 && Number.isFinite(r.value));
  return valid.length ? Math.max(...valid.map(r => r.value)) : null;
}

export type CalibrationReport = {
  id: string;
  fecha: string;
  corpusAlias: string;
  coleccion: string;
  corpusHash: string;
  embeddingVersion: string;
  rerankerVersion: string;
  politicaVersion: string;
  goldenSetHash: string;
  valores: number[];
  respondibles: string[];
  ausentes: string[];
  barrido: SweepRow[];
  selectedThreshold: number;
  regla: string;
};

export const SELECTION_RULE = "mayor valor finito del barrido con cero falsas abstenciones sobre las preguntas respondibles";

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type CalibrationMeta = {
  corpusAlias: string; coleccion: string; corpusHash: string; goldenSetHash: string;
  embeddingVersion: string; rerankerVersion: string; fecha?: Date;
};

export function buildReport(questions: CalibrationQuestion[], meta: CalibrationMeta): CalibrationReport {
  if (!questions.some(q => q.kind === "respondible")) throw new CalibrationError("El oro no tiene preguntas respondibles: no hay con qué calibrar.");
  const barrido = runSweep(questions);
  const selected = chooseThreshold(barrido);
  if (selected === null) {
    const peor = barrido.reduce((a, b) => (b.falseAbstentions < a.falseAbstentions ? b : a), barrido[0]);
    throw new CalibrationError(
      `Ningún umbral finito logra cero falsas abstenciones (mínimo ${peor?.falseAbstentions} en ${peor?.falseAbstentionIds.join(", ")}). ` +
      "Hallazgo REAL de recuperación o de datos: se corrige y se vuelve a ejecutar; no se activa un umbral a ojo.");
  }
  const fecha = (meta.fecha ?? new Date()).toISOString();
  return {
    id: `cal-${fecha.slice(0, 10)}-${meta.coleccion}`, fecha,
    corpusAlias: meta.corpusAlias, coleccion: meta.coleccion, corpusHash: meta.corpusHash, goldenSetHash: meta.goldenSetHash,
    embeddingVersion: meta.embeddingVersion, rerankerVersion: meta.rerankerVersion, politicaVersion: SELECTION_POLICY_VERSION,
    valores: barrido.map(r => r.value),
    respondibles: questions.filter(q => q.kind === "respondible").map(q => q.id),
    ausentes: questions.filter(q => q.kind === "ausente").map(q => q.id),
    barrido, selectedThreshold: selected, regla: SELECTION_RULE,
  };
}

/** Guarda la calibración junto a su colección (rol kb_writer). Reemplaza la de la misma colección. */
export async function saveCalibration(db: pg.Pool | pg.PoolClient, r: CalibrationReport): Promise<void> {
  if (!Number.isFinite(r.selectedThreshold)) throw new CalibrationError("El umbral elegido no es finito.");
  await db.query(
    `INSERT INTO kb.kb_calibracion (coleccion, umbral, embedding_version, reranker_version, politica_version, corpus_hash, oro_hash, reporte)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (coleccion) DO UPDATE SET umbral = EXCLUDED.umbral, embedding_version = EXCLUDED.embedding_version,
       reranker_version = EXCLUDED.reranker_version, politica_version = EXCLUDED.politica_version, corpus_hash = EXCLUDED.corpus_hash,
       oro_hash = EXCLUDED.oro_hash, reporte = EXCLUDED.reporte, creada_en = now()`,
    [r.coleccion, r.selectedThreshold, r.embeddingVersion, r.rerankerVersion, r.politicaVersion, r.corpusHash, r.goldenSetHash, JSON.stringify(r)]);
}
