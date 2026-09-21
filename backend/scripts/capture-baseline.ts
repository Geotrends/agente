/**
 * Captura la línea base de recuperación: corre el conjunto de consultas contra el
 * índice actual y guarda los fragmentos que devuelve, con sus puntajes.
 *
 *     npm run baseline:capture
 *
 * El resultado se versiona en el repositorio. A partir de ahí, `baseline:check`
 * verifica tras cada fase que los resultados no cambiaron.
 *
 * IMPORTANTE: capturar de nuevo sobre un código ya modificado destruye la
 * referencia. Solo debe recapturarse cuando el corpus cambia de forma
 * intencional (la comprobación avisa cuando la firma del índice no coincide).
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { disposeEmbeddings } from "../src/services/embeddings.js";
import { disposeReranker } from "../src/services/reranker.js";
import { BASELINE_FORMAT_VERSION, type BaselineQuerySet } from "./lib/baseline.js";
import { runBaseline, reportProgress } from "./lib/runBaseline.js";

const QUERIES_PATH = path.resolve("test/fixtures/baseline-queries.json");
const OUTPUT_PATH = path.resolve(process.argv[2] ?? "test/fixtures/baseline-results.json");

const querySet = JSON.parse(await fs.readFile(QUERIES_PATH, "utf8")) as BaselineQuerySet;
if (querySet.formatVersion !== BASELINE_FORMAT_VERSION) {
  console.error(`El conjunto de consultas es de formato v${querySet.formatVersion}; se esperaba v${BASELINE_FORMAT_VERSION}. Vuelve a generarlo con "npm run baseline:queries".`);
  process.exit(1);
}

console.log(`Construyendo el índice (${querySet.cases.length} consultas por delante)…`);
const { baseline, buildMs, methods } = await runBaseline(querySet, reportProgress);
process.stdout.write("\n\n");

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

const totalHits = baseline.entries.reduce((sum, entry) => sum + entry.hits.length, 0);
const empty = baseline.entries.filter(entry => !entry.hits.length).length;

console.log(`Línea base escrita en ${path.relative(process.cwd(), OUTPUT_PATH)}`);
console.log(`  índice construido en ${(buildMs / 1000).toFixed(1)} s — ${baseline.corpus.documents} documentos, ${baseline.corpus.chunks} fragmentos`);
console.log(`  firma: ${baseline.signature.slice(0, 16)}…`);
console.log(`  ${baseline.entries.length} consultas · ${totalHits} fragmentos registrados`);
console.log(`  método(s): ${[...methods].join(", ")}`);
if (empty) console.log(`  ${empty} consulta(s) sin ningún fragmento`);
if (methods.size > 1) {
  console.warn("\n  ⚠  Se observó más de un método de recuperación en la misma corrida:");
  console.warn("     el reranker falló a mitad de camino y la línea base no es comparable.");
  console.warn("     Revisa los avisos [retrieval] de arriba y vuelve a capturar.");
  process.exitCode = 1;
}

await disposeReranker();
await disposeEmbeddings();
