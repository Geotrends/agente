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
import { aggregate, normalizarUrl, scoreCase, type CaseScore, type GoldenSet } from "./lib/goldenSet.js";

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
  const porUrl = goldenSet.identificador === "url";
  for (const goldenCase of goldenSet.cases) {
    const result = await hybridSearch(goldenCase.query);
    if (!porUrl) {
      scores.push(scoreCase(goldenCase, result.hits));
      continue;
    }
    // Identificación por URL de origen (R17): igual antes y después de Qdrant.
    // Varios fragmentos del mismo documento comparten URL: cuenta la primera
    // aparición, como un documento, o el nDCG pasaría de 1.
    const vistos = new Set<string>();
    const hits = result.hits
      .map(h => ({ path: normalizarUrl((h as { sourceUrl?: string }).sourceUrl ?? h.path) }))
      .filter(h => !vistos.has(h.path) && vistos.add(h.path));
    scores.push(scoreCase({ ...goldenCase, relevantPaths: goldenCase.relevantPaths.map(normalizarUrl) }, hits));
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

if (process.argv.includes("--calibrar")) {
  // RF-C3-DI-05: barrido de TODOS los umbrales finitos con la selección final; elige el mayor con cero
  // falsas abstenciones sobre las respondibles. `--informe=<dir>` guarda el informe completo;
  // `--guardar` lo registra en kb.kb_calibracion (rol kb_writer) junto a la colección servida.
  const flag = (nombre: string) => process.argv.slice(2).find(a => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
  const { createHash } = await import("node:crypto");
  const { calibrateCollection } = await import("../src/kb/calibrateCollection.js");
  const { CalibrationError, saveCalibration } = await import("../src/kb/calibration.js");
  const { coleccionDelAlias, qdrant } = await import("../src/services/qdrant.js");
  const coleccion = await coleccionDelAlias();
  if (!coleccion) { console.error("El alias no apunta a ninguna colección."); process.exit(1); }
  const { count } = await qdrant().count(coleccion, { exact: true });
  const oro = JSON.parse(await fs.readFile(GOLDEN_SET_PATH, "utf8")) as Parameters<typeof calibrateCollection>[1];
  const oroHash = createHash("sha256").update(await fs.readFile(GOLDEN_SET_PATH)).digest("hex");
  const corpusHash = createHash("sha256").update(`${coleccion}:${count}`).digest("hex");
  try {
    const informe = await calibrateCollection(coleccion, oro, oroHash, { corpusHash });
    console.log(`Umbral elegido: ${informe.selectedThreshold} (${informe.valores.length} valores barridos; ${informe.respondibles.length} respondibles, ${informe.ausentes.length} ausentes)`);
    const dir = flag("informe");
    if (dir) {
      await fs.mkdir(path.resolve(dir), { recursive: true });
      const archivo = path.resolve(dir, `${informe.id}.json`);
      await fs.writeFile(archivo, JSON.stringify(informe, null, 2) + "\n");
      console.log(`Informe completo en ${archivo}`);
    }
    if (process.argv.includes("--guardar")) {
      const { kbPool, cerrarPool } = await import("../src/kb/db.js");
      await saveCalibration(kbPool(), informe);
      await cerrarPool();
      console.log("Calibración registrada junto a la colección.");
    }
  } catch (error) {
    if (error instanceof CalibrationError) { console.error(`ERROR DE CALIBRACIÓN (hallazgo REAL): ${error.message}`); process.exitCode = 1; }
    else throw error;
  }
} else if (sweepValues?.length) {
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

  // Línea base de la migración a Qdrant (research R17, T021/T077):
  //   --guardar-baseline=<ruta>  guarda recall@8, MRR y nDCG@8 de esta corrida
  //   --baseline=<ruta>          compara contra una guardada; sale con 1 si
  //                              recall@8 baja más de 2 puntos porcentuales
  const flag = (nombre: string) => process.argv.slice(2).find(a => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
  const destino = flag("guardar-baseline");
  if (destino) {
    await fs.writeFile(path.resolve(destino), JSON.stringify({
      generadaEn: new Date().toISOString(),
      conjunto: path.relative(process.cwd(), GOLDEN_SET_PATH),
      recallAt8: report.meanRecallAt8, mrr: report.meanMrr, ndcgAt8: report.meanNdcgAt8,
      abstenciones: `${report.abstainedCount}/${report.abstentionCount}`,
      recallCero: report.zeroRecallIds,
    }, null, 2) + "\n");
    console.log(`Línea base guardada en ${destino}`);
  }
  const contra = flag("baseline");
  if (contra) {
    const base = JSON.parse(await fs.readFile(path.resolve(contra), "utf8")) as { recallAt8: number; mrr: number; ndcgAt8: number };
    const delta = (report.meanRecallAt8 - base.recallAt8) * 100;
    console.log(`Frente a la línea base: recall@8 ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts · MRR ${(report.meanMrr - base.mrr).toFixed(4)} · nDCG@8 ${(report.meanNdcgAt8 - base.ndcgAt8).toFixed(4)}`);
    if (delta < -2) {
      console.error("✗ recall@8 bajó más de 2 puntos frente a la línea base: la migración queda bloqueada (R17).");
      process.exitCode = 1;
    } else {
      console.log("✓ Sin regresión de recall@8 mayor a 2 puntos.");
    }
  }
}

await disposeReranker();
await disposeEmbeddings();
