/**
 * Compara la recuperación actual contra la línea base capturada.
 *
 *     npm run baseline:check
 *
 * Se corre después de cada fase del plan (F1 Float32Array, F2 índice
 * invertido). Sale con código 1 si algún top-8 cambió de contenido o
 * de orden; la deriva de puntajes dentro de tolerancia se informa pero no falla,
 * porque pasar los vectores a Float32 la produce por diseño.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { disposeEmbeddings } from "../src/services/embeddings.js";
import { disposeReranker } from "../src/services/reranker.js";
import {
  BASELINE_FORMAT_VERSION, compareBaselines, formatReport,
  type Baseline, type BaselineQuerySet,
} from "./lib/baseline.js";
import { runBaseline, reportProgress } from "./lib/runBaseline.js";

const QUERIES_PATH = path.resolve("test/fixtures/baseline-queries.json");
const BASELINE_PATH = path.resolve(process.argv[2] ?? "test/fixtures/baseline-results.json");

async function readJson<T>(filePath: string, what: string): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`No existe ${what}: ${path.relative(process.cwd(), filePath)}`);
      console.error(`Genera la referencia primero, con el código SIN modificar:`);
      console.error(`  npm run baseline:queries && npm run baseline:capture`);
      process.exit(1);
    }
    throw error;
  }
}

const querySet = await readJson<BaselineQuerySet>(QUERIES_PATH, "el conjunto de consultas");
const expected = await readJson<Baseline>(BASELINE_PATH, "la línea base");

if (expected.formatVersion !== BASELINE_FORMAT_VERSION) {
  console.error(`La línea base es de formato v${expected.formatVersion}; se esperaba v${BASELINE_FORMAT_VERSION}.`);
  process.exit(1);
}

console.log(`Línea base: ${expected.entries.length} consultas capturadas el ${expected.capturedAt.slice(0, 16).replace("T", " ")}`);
console.log(`Reconstruyendo el índice y repitiendo las consultas…`);

const { baseline: actual, buildMs, methods } = await runBaseline(querySet, reportProgress);
process.stdout.write("\n");

const report = compareBaselines(expected, actual);
console.log(formatReport(report));

console.log("");
console.log(`  índice: ${actual.corpus.documents} documentos, ${actual.corpus.chunks} fragmentos, construido en ${(buildMs / 1000).toFixed(1)} s`);
console.log(`  método(s): ${[...methods].join(", ")}`);

if (report.ok) {
  const drift = report.counts["score-drift"];
  console.log(`\n  ✓ La recuperación no cambió${drift ? ` (${drift} consulta(s) con deriva numérica dentro de tolerancia)` : ""}.`);
} else {
  console.error(`\n  ✗ La recuperación CAMBIÓ. El refactor no es equivalente.`);
  process.exitCode = 1;
}

if (!report.signatureMatches) {
  // Ya se explicó en el informe; aquí solo se marca el resultado como no concluyente.
  console.error(`  ✗ Además, el corpus cambió desde la captura: el resultado no es concluyente.`);
  process.exitCode = 1;
}

await disposeReranker();
await disposeEmbeddings();
