/**
 * Mide la calidad de la recuperación contra el conjunto dorado de A-12:
 * recall@8, MRR y nDCG@8 sobre las preguntas factuales, y tasa de abstención
 * sobre las preguntas fuera de alcance.
 *
 *     npm run eval:retrieval
 *
 * Para calibrar MIN_RERANK_SCORE (A-5) contra varios valores en una sola
 * corrida, sin reconstruir el índice entre cada uno (el umbral se aplica por
 * consulta, no al indexar):
 *
 *     npm run eval:retrieval -- --sweep=-2,-1,0,1,2
 *
 * No gasta un token de LLM: corre `hybridSearch` directamente, así que cuesta
 * segundos, no la media hora de `rag_tester/eval_bot.py` contra la UI. Existe
 * porque `baseline:check` responde una pregunta distinta —"¿cambió algo?"— y
 * exige cero diferencias; este script es para cuando el cambio debe moverlas
 * (A-5, A-6, M-3, M-5) y hace falta saber si mejoran o empeoran.
 *
 * Las métricas están definidas y probadas en scripts/lib/goldenSet.ts
 * (test/golden-set-eval.test.ts) con casos calculados a mano — el arnés se
 * valida ahí, no aquí, para no depender de que el corpus real no cambie.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { disposeEmbeddings } from "../src/services/embeddings.js";
import { disposeReranker } from "../src/services/reranker.js";
import { hybridSearch, prepareIndex } from "../src/services/search.js";
import { aggregate, scoreCase, type CaseScore, type GoldenSet } from "./lib/goldenSet.js";

const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith("--"));

/** `--sweep=a,b,c` sobre una variable de entorno numérica. */
function sweepFor(flag: string): number[] | undefined {
  const arg = process.argv.slice(2).find(a => a.startsWith(`--${flag}=`));
  if (!arg) return undefined;
  const values = arg.slice(flag.length + 3).split(",").map(s => Number(s.trim())).filter(Number.isFinite);
  return values.length ? values : undefined;
}

// A-5: umbral de relevancia. A-1: cuántos candidatos ve el reranker.
const sweepValues = sweepFor("sweep");
const candidateSweep = sweepFor("sweep-candidates");

const GOLDEN_SET_PATH = path.resolve(positionalArgs[0] ?? "test/fixtures/golden-set.json");

let goldenSet: GoldenSet;
try {
  goldenSet = JSON.parse(await fs.readFile(GOLDEN_SET_PATH, "utf8")) as GoldenSet;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.error(`No existe ${path.relative(process.cwd(), GOLDEN_SET_PATH)}.`);
    console.error(`Constrúyelo primero:`);
    console.error(`  npm run golden:candidates   # genera el CSV a revisar`);
    console.error(`  ...revisar el CSV a mano, llenar "relevante"...`);
    console.error(`  npm run golden:finalize     # produce golden-set.json`);
    process.exit(1);
  }
  throw error;
}

if (!goldenSet.cases.length) {
  console.error(`${path.relative(process.cwd(), GOLDEN_SET_PATH)} no tiene ningún caso revisado todavía.`);
  console.error(`(${goldenSet.pendingCases ?? 0} pendiente(s) de revisión en golden-candidates.csv.)`);
  process.exit(1);
}

console.log(`\n═══ EVALUACIÓN DE RECUPERACIÓN (A-12) ═══\n`);
console.log(`${goldenSet.cases.length} preguntas revisadas · ${goldenSet.pendingCases} pendiente(s) sin incluir\n`);

await prepareIndex();

/** Milisegundos por consulta de la última corrida, para el barrido de A-1. */
let lastRunMsPerQuery = 0;

async function runOnce(): Promise<ReturnType<typeof aggregate>> {
  const scores: CaseScore[] = [];
  const started = performance.now();
  for (const goldenCase of goldenSet.cases) {
    const result = await hybridSearch(goldenCase.query);
    scores.push(scoreCase(goldenCase, result.hits));
  }
  lastRunMsPerQuery = (performance.now() - started) / (goldenSet.cases.length || 1);
  return aggregate(scores, goldenSet.cases);
}

function printReport(report: ReturnType<typeof aggregate>): void {
  console.log("Recuperación (preguntas factuales)");
  console.log(`  ${report.factualCount} preguntas`);
  console.log(`  recall@8   ${(report.meanRecallAt8 * 100).toFixed(1).padStart(6)} %`);
  console.log(`  MRR        ${report.meanMrr.toFixed(4).padStart(6)}`);
  console.log(`  nDCG@8     ${report.meanNdcgAt8.toFixed(4).padStart(6)}`);
  if (report.zeroRecallIds.length) {
    console.log(`\n  ${report.zeroRecallIds.length} con recall 0 — ninguna fuente correcta apareció en el top-8:`);
    console.log(`    ${report.zeroRecallIds.join(", ")}`);
  }

  console.log("\nAbstención (preguntas fuera de alcance)");
  console.log(`  ${report.abstentionCount} preguntas`);
  console.log(`  se abstuvieron  ${report.abstainedCount} / ${report.abstentionCount}`);
  if (report.abstentionCount && report.abstainedCount === 0) {
    console.log(`  (con este MIN_RERANK_SCORE el sistema no abstuvo ninguna — sube el umbral, o revisa`);
    console.log(`   si el reranker cayó a la ruta de reserva sin logit que filtrar.)`);
  }
  if (report.falseRelevantAbstentionIds.length) {
    console.log(`\n  ⚠ estas preguntas tienen una fuente marcada relevante pese a estar en la lista`);
    console.log(`    de abstención — revisa si de verdad son casos fuera de alcance:`);
    console.log(`    ${report.falseRelevantAbstentionIds.join(", ")}`);
  }

  if (report.unanswerableCount) {
    console.log("\nNo evaluables (documento sin texto extraíble en el corpus)");
    console.log(`  ${report.unanswerableCount} preguntas — no cuentan en recall/MRR/nDCG: no es un problema`);
    console.log(`  de retrieval, es una limitación de extracción que el ranking no puede arreglar.`);
    console.log(`    ${report.unanswerableIds.join(", ")}`);
  }
  console.log("");
}

if (sweepValues?.length) {
  console.log(`═══ BARRIDO DE MIN_RERANK_SCORE (hallazgo A-5) ═══`);
  console.log(`valores: ${sweepValues.join(", ")}\n`);
  const rows: Array<{ minScore: number; recall: number; mrr: number; ndcg: number; abstained: number; abstentionCount: number }> = [];
  for (const minScore of sweepValues) {
    process.env.MIN_RERANK_SCORE = String(minScore);
    const report = await runOnce();
    rows.push({
      minScore, recall: report.meanRecallAt8, mrr: report.meanMrr, ndcg: report.meanNdcgAt8,
      abstained: report.abstainedCount, abstentionCount: report.abstentionCount,
    });
  }
  console.log("MIN_RERANK_SCORE   recall@8     MRR      nDCG@8   abstención");
  for (const row of rows) {
    console.log(
      `  ${String(row.minScore).padStart(14)}   ${(row.recall * 100).toFixed(1).padStart(6)} %  ${row.mrr.toFixed(4)}   ${row.ndcg.toFixed(4)}   ${row.abstained}/${row.abstentionCount}`
    );
  }
  console.log(`\nElige el valor más alto que NO baje recall@8 frente al barrido con el umbral más bajo,`);
  console.log(`y que suba la abstención en los casos fuera de alcance. Documenta el elegido en el commit.\n`);
} else if (candidateSweep?.length) {
  console.log(`═══ BARRIDO DE RERANK_CANDIDATES (hallazgo A-1) ═══`);
  console.log(`valores: ${candidateSweep.join(", ")}\n`);
  console.log(`El reranker cuesta el 82 % de la consulta y escala con el tamaño del lote, así que`);
  console.log(`aquí se mide calidad Y tiempo: el valor bueno es el más bajo que no mueva recall@8.\n`);
  const rows: Array<{ candidates: number; recall: number; ndcg: number; msPerQuery: number }> = [];
  for (const candidates of candidateSweep) {
    process.env.RERANK_CANDIDATES = String(candidates);
    const report = await runOnce();
    rows.push({
      candidates, recall: report.meanRecallAt8, ndcg: report.meanNdcgAt8, msPerQuery: lastRunMsPerQuery,
    });
  }
  const slowest = Math.max(...rows.map(r => r.msPerQuery));
  console.log("RERANK_CANDIDATES   recall@8     nDCG@8    ms/consulta   frente al más lento");
  for (const row of rows) {
    const saving = ((1 - row.msPerQuery / slowest) * 100).toFixed(0);
    console.log(
      `  ${String(row.candidates).padStart(15)}   ${(row.recall * 100).toFixed(1).padStart(6)} %   ${row.ndcg.toFixed(4)}   ${row.msPerQuery.toFixed(0).padStart(7)} ms   ${saving.padStart(6)} % más rápido`
    );
  }
  console.log("");
} else {
  const report = await runOnce();
  printReport(report);
}

await disposeReranker();
await disposeEmbeddings();
