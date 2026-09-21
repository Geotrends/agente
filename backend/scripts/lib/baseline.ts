/**
 * Formato y comparación de la línea base de recuperación (hallazgo F0 del plan).
 *
 * La línea base congela el comportamiento ACTUAL de `hybridSearch` para poder
 * demostrar que los refactores de F1-F3 (Float32Array, índice invertido, rangos
 * contiguos) no cambian los resultados. No es una medida de calidad: no lleva
 * etiquetas ni juicio humano. Solo responde a "¿esto devuelve lo mismo que antes?".
 *
 * El criterio principal es el ORDEN de los fragmentos, no la igualdad exacta de
 * los puntajes: al pasar los vectores a Float32 se pierden ~1e-7 de precisión, lo
 * que es irrelevante salvo en empates casi exactos.
 */

export const BASELINE_FORMAT_VERSION = 2;

/**
 * Una consulta a evaluar.
 *
 * Ya no hay variantes con alcance: el filtrado por carpeta y por documento se
 * retiró del RAG junto con los endpoints que lo alimentaban, así que toda
 * consulta recorre el corpus entero. Por eso el formato subió a v2 — una línea
 * base capturada antes contiene casos con alcance y no es comparable.
 */
export type BaselineCase = {
  id: string;
  query: string;
  /** Etiqueta informativa: de dónde salió la consulta. */
  kind: "factual" | "adversarial";
};

export type BaselineQuerySet = {
  formatVersion: number;
  generatedAt: string;
  cases: BaselineCase[];
};

export type BaselineHit = {
  path: string;
  chunk: number;
  bm25: number;
  semantic: number;
  rerank?: number;
  score: number;
};

export type BaselineEntry = {
  id: string;
  query: string;
  /** El método debe coincidir: sin reranker los resultados son otros. */
  method: string;
  hits: BaselineHit[];
};

export type Baseline = {
  formatVersion: number;
  capturedAt: string;
  node: string;
  /** Firma del índice. Si cambia, el corpus cambió y la comparación no aplica. */
  signature: string;
  corpus: { documents: number; chunks: number };
  entries: BaselineEntry[];
};

/**
 * Tolerancias por campo.
 *
 * - `bm25`: el índice invertido de F2 suma las contribuciones por término en el
 *   mismo orden que hoy y acumula en float64, así que debería ser exacto.
 * - `semantic`: los vectores pasan a Float32 (error relativo ~6e-8 por
 *   componente) pero el producto punto se acumula en float64, así que el error
 *   del total se mantiene en ese orden.
 * - `score` (RRF): depende solo de posiciones, así que es exacto salvo empates.
 * - `rerank`: ONNX es determinista para la misma entrada; el margen cubre
 *   diferencias de versión del runtime.
 */
export const TOLERANCES = {
  bm25: 1e-9,
  semantic: 1e-6,
  score: 1e-12,
  rerank: 1e-4,
} as const;

export type CaseVerdict =
  | { id: string; status: "identical" }
  | { id: string; status: "score-drift"; details: string[] }
  | { id: string; status: "reordered"; details: string[] }
  | { id: string; status: "changed"; details: string[] }
  | { id: string; status: "method-changed"; details: string[] }
  | { id: string; status: "missing"; details: string[] };

export type ComparisonReport = {
  signatureMatches: boolean;
  expectedSignature: string;
  actualSignature: string;
  verdicts: CaseVerdict[];
  counts: Record<CaseVerdict["status"], number>;
  ok: boolean;
};

function key(hit: { path: string; chunk: number }): string {
  return `${hit.path}#${hit.chunk}`;
}

function drift(label: string, expected: number, actual: number, tolerance: number): string | null {
  const delta = Math.abs(expected - actual);
  // Tolerancia relativa para magnitudes grandes (BM25 llega a decenas),
  // absoluta para las que viven cerca de cero (coseno, RRF).
  const allowed = tolerance < 1e-8 ? tolerance * Math.max(1, Math.abs(expected)) : tolerance;
  if (delta <= allowed) return null;
  return `${label}: esperado ${expected.toPrecision(10)}, obtenido ${actual.toPrecision(10)} (Δ ${delta.toExponential(2)} > ${allowed.toExponential(2)})`;
}

function compareEntry(expected: BaselineEntry, actual: BaselineEntry | undefined): CaseVerdict {
  const id = expected.id;
  if (!actual) {
    return { id, status: "missing", details: ["La consulta no aparece en la corrida actual."] };
  }
  if (expected.method !== actual.method) {
    return {
      id,
      status: "method-changed",
      details: [
        `El método de recuperación cambió: "${expected.method}" → "${actual.method}".`,
        "Suele significar que el reranker dejó de cargar. Los resultados no son comparables.",
      ],
    };
  }

  const expectedKeys = expected.hits.map(key);
  const actualKeys = actual.hits.map(key);

  if (expectedKeys.join("|") !== actualKeys.join("|")) {
    const expectedSet = new Set(expectedKeys);
    const actualSet = new Set(actualKeys);
    const added = actualKeys.filter(k => !expectedSet.has(k));
    const removed = expectedKeys.filter(k => !actualSet.has(k));

    if (!added.length && !removed.length) {
      return {
        id,
        status: "reordered",
        details: [
          "Mismos fragmentos, distinto orden.",
          `  antes:  ${expectedKeys.join("  ")}`,
          `  ahora:  ${actualKeys.join("  ")}`,
        ],
      };
    }
    return {
      id,
      status: "changed",
      details: [
        ...(removed.length ? [`  faltan:  ${removed.join("  ")}`] : []),
        ...(added.length ? [`  sobran:  ${added.join("  ")}`] : []),
      ],
    };
  }

  const details: string[] = [];
  for (const [index, expectedHit] of expected.hits.entries()) {
    const actualHit = actual.hits[index];
    const checks = [
      drift("bm25", expectedHit.bm25, actualHit.bm25, TOLERANCES.bm25),
      drift("semantic", expectedHit.semantic, actualHit.semantic, TOLERANCES.semantic),
      drift("score", expectedHit.score, actualHit.score, TOLERANCES.score),
      expectedHit.rerank !== undefined && actualHit.rerank !== undefined
        ? drift("rerank", expectedHit.rerank, actualHit.rerank, TOLERANCES.rerank)
        : null,
    ].filter((entry): entry is string => entry !== null);
    if (checks.length) details.push(`  [${index}] ${key(expectedHit)} — ${checks.join("; ")}`);
  }

  return details.length ? { id, status: "score-drift", details } : { id, status: "identical" };
}

export function compareBaselines(expected: Baseline, actual: Baseline): ComparisonReport {
  const byId = new Map(actual.entries.map(entry => [entry.id, entry]));
  const verdicts = expected.entries.map(entry => compareEntry(entry, byId.get(entry.id)));

  const counts: Record<CaseVerdict["status"], number> = {
    identical: 0, "score-drift": 0, reordered: 0, changed: 0, "method-changed": 0, missing: 0,
  };
  for (const verdict of verdicts) counts[verdict.status]++;

  return {
    signatureMatches: expected.signature === actual.signature,
    expectedSignature: expected.signature,
    actualSignature: actual.signature,
    verdicts,
    counts,
    // La deriva de puntajes dentro de tolerancia es aceptable; el orden no.
    ok: counts.reordered === 0 && counts.changed === 0
      && counts["method-changed"] === 0 && counts.missing === 0,
  };
}

export function formatReport(report: ComparisonReport): string {
  const lines: string[] = [];
  const { counts } = report;

  if (!report.signatureMatches) {
    lines.push(
      "",
      "  ⚠  LA FIRMA DEL ÍNDICE CAMBIÓ",
      `     línea base: ${report.expectedSignature.slice(0, 16)}…`,
      `     ahora:      ${report.actualSignature.slice(0, 16)}…`,
      "     El corpus o la configuración de indexado cambiaron desde la captura.",
      "     Las diferencias de abajo pueden deberse a eso y no al refactor.",
      "     Si el cambio de corpus fue intencional: npm run baseline:capture",
      "",
    );
  }

  for (const verdict of report.verdicts) {
    if (verdict.status === "identical") continue;
    const mark = verdict.status === "score-drift" ? "~" : "✗";
    lines.push(`  ${mark} ${verdict.id} — ${verdict.status}`);
    for (const detail of verdict.details) lines.push(`     ${detail}`);
  }

  const total = report.verdicts.length;
  lines.push(
    "",
    `  ${counts.identical}/${total} idénticas` +
    (counts["score-drift"] ? ` · ${counts["score-drift"]} con deriva de puntaje dentro de tolerancia` : "") +
    (counts.reordered ? ` · ${counts.reordered} REORDENADAS` : "") +
    (counts.changed ? ` · ${counts.changed} CAMBIADAS` : "") +
    (counts["method-changed"] ? ` · ${counts["method-changed"]} con método distinto` : "") +
    (counts.missing ? ` · ${counts.missing} ausentes` : ""),
  );

  return lines.join("\n");
}
