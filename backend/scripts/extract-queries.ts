/**
 * Genera el conjunto de consultas de la línea base a partir del registro real de
 * interacciones, y le añade variantes con alcance (carpeta y documento) para
 * cubrir el camino que reescribe F3.
 *
 * Se ejecuta una sola vez: el JSON resultante se versiona en el repositorio y a
 * partir de ahí es la entrada fija de `baseline:capture` y `baseline:check`.
 * Volver a correrlo solo hace falta si se quiere ampliar la cobertura.
 *
 *     npm run baseline:queries
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { BASELINE_FORMAT_VERSION, type BaselineCase, type BaselineQuerySet } from "./lib/baseline.js";
import { parseSemicolonCsv } from "./lib/semicolonCsv.js";

// Misma resolución que chatLog.ts: el registro salió de `data/` en A-11 para
// no viajar con el corpus, y `CHAT_LOG_FILE` puede reubicarlo.
const LOG_PATH = path.resolve(process.env.CHAT_LOG_FILE?.trim() || "var/chat-interactions.csv");
const OUTPUT_PATH = path.resolve("test/fixtures/baseline-queries.json");

/**
 * Etiqueta informativa. No afecta a la comparación: la línea base solo verifica
 * que la recuperación devuelva lo mismo, no si la respuesta es correcta.
 */
const DOCUMENT_MARKERS = /\b(acuerdo|acta|decreto|ley|resoluci[oó]n|bolet[ií]n|estaci[oó]n|plan de inversi[oó]n|art[ií]culo)\b/i;

function classify(question: string): "factual" | "adversarial" {
  return DOCUMENT_MARKERS.test(question) ? "factual" : "adversarial";
}

const raw = await fs.readFile(LOG_PATH, "utf8");
const questions = [...new Set(
  parseSemicolonCsv(raw)
    .map(record => (record.Pregunta ?? "").trim())
    .filter(question => question.length >= 10),
)];

if (!questions.length) {
  console.error(`No se encontraron preguntas en ${LOG_PATH}`);
  process.exit(1);
}

const cases: BaselineCase[] = questions.map((query, index) => ({
  id: `q${String(index + 1).padStart(3, "0")}`,
  query,
  kind: classify(query),
}));

const querySet: BaselineQuerySet = {
  formatVersion: BASELINE_FORMAT_VERSION,
  generatedAt: new Date().toISOString(),
  cases,
};

await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(querySet, null, 2)}\n`, "utf8");

const byKind = cases.reduce<Record<string, number>>((acc, item) => {
  acc[item.kind] = (acc[item.kind] ?? 0) + 1;
  return acc;
}, {});

console.log(`Conjunto de consultas escrito en ${path.relative(process.cwd(), OUTPUT_PATH)}`);
console.log(`  ${cases.length} casos:`, byKind);
