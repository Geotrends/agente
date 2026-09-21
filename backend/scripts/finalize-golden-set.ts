/**
 * Convierte golden-candidates.csv, ya revisado por una persona, en
 * golden-set.json — la entrada de `eval-retrieval.ts`.
 *
 *     npm run golden:finalize
 *
 * Una pregunta entra al conjunto dorado solo si TODAS sus filas tienen
 * "relevante" explícito (s, n, o u). Si falta una sola, la pregunta entera
 * queda fuera y se informa como pendiente — no se asume "no relevante" por
 * omisión, porque una fila sin revisar no es lo mismo que una fila revisada
 * y descartada, y confundirlas metería juicios que nadie hizo.
 *
 * "u" (o "u:motivo") marca la pregunta entera como no evaluable: existe una
 * pregunta real, pero el documento que la respondería no tiene texto
 * extraíble (verificado a mano, no una suposición) y por tanto ningún cambio
 * de retrieval puede arreglarlo. Se excluye de recall/MRR/nDCG y se reporta
 * aparte — mezclarla ahí contaría una limitación del corpus como si fuera
 * mala calidad de búsqueda, que es un problema distinto.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { GOLDEN_SET_FORMAT_VERSION, type GoldenCase, type GoldenSet } from "./lib/goldenSet.js";
import { parseCsvRows as parseCsv } from "../src/shared/csv.js";

const INPUT_PATH = path.resolve(process.argv[2] ?? "test/fixtures/golden-candidates.csv");
const OUTPUT_PATH = path.resolve("test/fixtures/golden-set.json");

type Row = { queryId: string; kind: string; query: string; path: string; relevante: string };

/** Parser RFC 4180 simple: comillas dobles, delimitador coma. Suficiente para lo que escribe build-golden-candidates.ts. */

function truthy(value: string): boolean {
  return /^(s|si|sí|y|yes|true|1)$/i.test(value.trim());
}
function falsy(value: string): boolean {
  return /^(n|no|false|0)$/i.test(value.trim());
}
/** "u" o "u:motivo libre" — ver el docstring de arriba. */
function unanswerableNote(value: string): string | undefined {
  const match = /^u\s*:?\s*(.*)$/i.exec(value.trim());
  return match ? match[1] || undefined : undefined;
}
function isUnanswerable(value: string): boolean {
  return /^u\b/i.test(value.trim());
}
function isMarked(value: string): boolean {
  return truthy(value) || falsy(value) || isUnanswerable(value);
}

const raw = await fs.readFile(INPUT_PATH, "utf8");
const table = parseCsv(raw);
const headers = table[0];
const idx = (name: string) => {
  const at = headers.indexOf(name);
  if (at < 0) throw new Error(`Columna "${name}" no encontrada en ${INPUT_PATH}`);
  return at;
};
const col = {
  queryId: idx("query_id"), kind: idx("kind"), query: idx("query"),
  path: idx("path"), relevante: idx("relevante"),
};

const rows: Row[] = table.slice(1).map(cells => ({
  queryId: cells[col.queryId], kind: cells[col.kind], query: cells[col.query],
  path: cells[col.path], relevante: cells[col.relevante] ?? "",
}));

const byQuery = new Map<string, Row[]>();
for (const row of rows) {
  const list = byQuery.get(row.queryId) ?? [];
  list.push(row);
  byQuery.set(row.queryId, list);
}

const cases: GoldenCase[] = [];
const pending: string[] = [];
const malformed: Array<{ id: string; value: string }> = [];
const abstentionWithRelevant: string[] = [];

for (const [queryId, queryRows] of byQuery) {
  const unmarked = queryRows.filter(r => !isMarked(r.relevante) && r.path !== "");
  if (unmarked.length) { pending.push(queryId); continue; }

  for (const row of queryRows) {
    if (row.relevante && !isMarked(row.relevante)) {
      malformed.push({ id: queryId, value: row.relevante });
    }
  }

  const markedUnanswerable = queryRows.find(r => isUnanswerable(r.relevante));
  const kind = markedUnanswerable
    ? "unanswerable" as const
    : queryRows[0].kind === "abstention" ? "abstention" as const : "factual" as const;
  const relevantPaths = kind === "unanswerable"
    ? []
    : [...new Set(queryRows.filter(r => r.path !== "" && truthy(r.relevante)).map(r => r.path))];

  if (kind === "abstention" && relevantPaths.length) abstentionWithRelevant.push(queryId);

  cases.push({
    id: queryId, query: queryRows[0].query, kind, relevantPaths,
    ...(markedUnanswerable ? { note: unanswerableNote(markedUnanswerable.relevante) } : {}),
  });
}

cases.sort((a, b) => a.id.localeCompare(b.id));

const goldenSet: GoldenSet = {
  formatVersion: GOLDEN_SET_FORMAT_VERSION,
  generatedAt: new Date().toISOString(),
  reviewedCases: cases.length,
  pendingCases: pending.length,
  cases,
};

await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(goldenSet, null, 2)}\n`, "utf8");

const factual = cases.filter(c => c.kind === "factual");
const abstention = cases.filter(c => c.kind === "abstention");
const unanswerable = cases.filter(c => c.kind === "unanswerable");
console.log(`\n═══ CONJUNTO DORADO FINALIZADO ═══\n`);
console.log(`Escrito en ${path.relative(process.cwd(), OUTPUT_PATH)}`);
console.log(`  ${cases.length} preguntas revisadas (${factual.length} factuales, ${abstention.length} de abstención, ${unanswerable.length} no evaluables)`);
console.log(`  ${pending.length} pendiente(s) de revisión, excluidas: ${pending.join(", ") || "—"}`);
if (unanswerable.length) {
  console.log(`\n  No evaluables (documento sin texto extraíble, no cuentan en recall/MRR/nDCG):`);
  for (const c of unanswerable) console.log(`    ${c.id}${c.note ? ` — ${c.note}` : ""}`);
}
if (malformed.length) {
  console.log(`\n⚠  ${malformed.length} valor(es) en "relevante" no se reconocen como sí/no y se ignoraron:`);
  for (const { id, value } of malformed) console.log(`     ${id}: "${value}"`);
}
if (abstentionWithRelevant.length) {
  console.log(`\n⚠  Estas preguntas de abstención tienen una fuente marcada relevante — no eran`);
  console.log(`   casos de abstención después de todo, o la marca fue un error: ${abstentionWithRelevant.join(", ")}`);
}
const zeroPaths = factual.filter(c => !c.relevantPaths.length);
if (zeroPaths.length) {
  console.log(`\n${zeroPaths.length} pregunta(s) factual(es) revisada(s) sin ninguna fuente relevante marcada`);
  console.log(`  (ninguno de los candidatos servía): ${zeroPaths.map(c => c.id).join(", ")}`);
}
