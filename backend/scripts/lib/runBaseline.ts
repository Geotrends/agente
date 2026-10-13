/**
 * Ejecuta el conjunto de consultas contra el índice actual.
 *
 * Lo comparten `capture-baseline.ts` (que guarda el resultado como referencia) y
 * `check-baseline.ts` (que lo compara contra esa referencia): las dos rutas deben
 * ejercitar exactamente el mismo camino, o la comparación no significa nada.
 */
import { prepareIndex, hybridSearch, retrievalStatus } from "../../src/services/search.js";
import { BASELINE_FORMAT_VERSION, type Baseline, type BaselineEntry, type BaselineQuerySet } from "./baseline.js";

export type RunProgress = {
  position: number;
  total: number;
  id: string;
  hits: number;
};

export type RunResult = {
  baseline: Baseline;
  buildMs: number;
  methods: Set<string>;
};

export async function runBaseline(
  querySet: BaselineQuerySet,
  onProgress?: (progress: RunProgress) => void,
): Promise<RunResult> {
  const startedAt = Date.now();
  const index = await prepareIndex();
  const buildMs = Date.now() - startedAt;

  const entries: BaselineEntry[] = [];
  const methods = new Set<string>();

  for (const [position, testCase] of querySet.cases.entries()) {
    const result = await hybridSearch(testCase.query);
    methods.add(result.method);
    entries.push({
      id: testCase.id,
      query: testCase.query,
      method: result.method,
      hits: result.hits.map(hit => ({
        path: hit.path,
        chunk: hit.chunk,
        bm25: hit.bm25,
        semantic: hit.semantic,
        ...(typeof hit.rerank === "number" ? { rerank: hit.rerank } : {}),
        score: hit.score,
      })),
    });
    onProgress?.({
      position: position + 1,
      total: querySet.cases.length,
      id: testCase.id,
      hits: result.hits.length,
    });
  }

  return {
    baseline: {
      formatVersion: BASELINE_FORMAT_VERSION,
      capturedAt: new Date().toISOString(),
      node: process.version,
      // La "firma" del índice es ahora la colección física servida por el alias.
      signature: retrievalStatus.coleccion,
      corpus: { documents: index.documents, chunks: index.count },
      entries,
    },
    buildMs,
    methods,
  };
}

export function reportProgress(progress: RunProgress): void {
  const line = `  [${progress.position}/${progress.total}] ${progress.id} · ${progress.hits} frag.`;
  if (process.stdout.isTTY) {
    // Una sola línea que se reescribe; en un log redirigido eso deja basura,
    // así que allí se emite un resumen cada 20 casos y el final.
    process.stdout.write(`\r${line.padEnd(110)}`);
    return;
  }
  if (progress.position % 20 === 0 || progress.position === progress.total) {
    console.log(`${line}   (${progress.position}/${progress.total})`);
  }
}
