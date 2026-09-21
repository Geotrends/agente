/**
 * Genera el CSV de candidatos que una persona revisa para armar el conjunto
 * dorado de A-12: preguntas reales con las rutas de documento que deberían
 * aparecer.
 *
 *     npm run golden:candidates
 *
 * No decide nada por su cuenta. Lo único que hace además de correr
 * `hybridSearch` es una SUGERENCIA, marcada como tal: si el registro real de
 * interacciones (`data/chat-interactions.csv`) tiene una respuesta pasada para
 * la misma pregunta, y las fuentes que esa respuesta citó coinciden con algo
 * que la recuperación ACTUAL también trae en el top-8, se precompleta
 * `relevante=s` en esa fila con `sugerido=historico`. Es una corroboración
 * entre dos señales independientes —lo que se citó entonces, lo que se
 * recupera ahora—, no una sustitución del juicio de quien revisa. Todo lo
 * demás queda con `relevante` vacío.
 *
 * Salida: test/fixtures/golden-candidates.csv, con una fila por cada
 * (pregunta, posición) — o una sola fila con `path` vacío si la búsqueda no
 * trajo nada. `finalize-golden-set.ts` la convierte en golden-set.json
 * después de la revisión humana.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { getDocumentsRootPath } from "../src/services/context.js";
import { disposeEmbeddings } from "../src/services/embeddings.js";
import { disposeReranker } from "../src/services/reranker.js";
import { hybridSearch, prepareIndex } from "../src/services/search.js";
import { loadSourceMetadata } from "../src/services/sourceMetadata.js";
import type { BaselineQuerySet } from "./lib/baseline.js";
import { parseSemicolonCsv } from "./lib/semicolonCsv.js";

const QUERIES_PATH = path.resolve("test/fixtures/baseline-queries.json");
const ABSTENTION_PATH = path.resolve("test/fixtures/abstention-queries.json");
const LOG_PATH = path.resolve("data/chat-interactions.csv");
const OUTPUT_PATH = path.resolve("test/fixtures/golden-candidates.csv");

type Kind = "factual" | "abstention";
type Query = { id: string; query: string; kind: Kind };

type Row = {
  queryId: string; kind: Kind; query: string;
  rank: number; path: string; chunk: number | ""; bm25: number | ""; semantic: number | ""; rerank: number | ""; score: number | "";
  extracto: string; sugerido: string; relevante: string;
};

function csvField(value: string): string {
  return /[",;\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: Row[]): string {
  const headers = ["query_id", "kind", "query", "rank", "path", "chunk", "bm25", "semantic", "rerank", "score", "extracto", "sugerido", "relevante"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([
      row.queryId, row.kind, csvField(row.query), row.rank, csvField(row.path),
      row.chunk, row.bm25, row.semantic, row.rerank, row.score,
      csvField(row.extracto), row.sugerido, row.relevante,
    ].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Mapa URL de origen → ruta local, a partir de `documentos.csv`/`paginas.csv`
 * (vía `loadSourceMetadata`, que ya los junta). Reutiliza esa lectura en vez
 * de escribir un quinto parser de CSV para el mismo par de archivos.
 */
async function buildUrlToPathIndex(root: string): Promise<Map<string, string>> {
  const catalog = await loadSourceMetadata(root);
  const byUrl = new Map<string, string>();
  for (const [localPath, metadata] of catalog.byPath) {
    if (metadata.sourceUrl && !byUrl.has(metadata.sourceUrl)) byUrl.set(metadata.sourceUrl, localPath);
  }
  return byUrl;
}

/**
 * Mapa nombre de archivo → rutas locales que terminan en ese nombre.
 *
 * Las citas históricas a páginas scrapeadas de antes de A-7 no llevan URL —
 * solo el nombre del .md, p. ej. "2024.md" — porque no había título ni URL que
 * mostrar. Si ese nombre aparece en más de una carpeta (ambiguo), no se puede
 * resolver con certeza y se descarta en vez de adivinar.
 */
async function buildBasenameIndex(root: string): Promise<Map<string, string[]>> {
  const catalog = await loadSourceMetadata(root);
  const byBasename = new Map<string, string[]>();
  for (const localPath of catalog.byPath.keys()) {
    const basename = path.posix.basename(localPath);
    const list = byBasename.get(basename) ?? [];
    list.push(localPath);
    byBasename.set(basename, list);
  }
  return byBasename;
}

/** Del campo "Fuentes" del log ("Título (URL); Título (URL); 2024.md; ..."), las rutas que se puedan resolver. */
function resolveHistoricalPaths(
  fuentes: string, urlToPath: Map<string, string>, basenameToPaths: Map<string, string[]>,
): string[] {
  const resolved = new Set<string>();
  for (const raw of fuentes.split(";")) {
    const entry = raw.trim();
    if (!entry) continue;
    const withUrl = /\(([^)]+)\)\s*$/.exec(entry);
    if (withUrl) {
      const url = withUrl[1].trim();
      const localPath = urlToPath.get(url);
      if (localPath) resolved.add(localPath);
      continue;
    }
    // Sin paréntesis: cita heredada de antes de A-7, solo el nombre del .md.
    const candidates = basenameToPaths.get(entry);
    if (candidates?.length === 1) resolved.add(candidates[0]);
    // Ambiguo (>1) o no encontrado: se descarta, no se adivina.
  }
  return [...resolved];
}

/**
 * Respuestas que en realidad son un fallo de proveedor filtrado (hallazgo A-4)
 * o la abstención de A-5 una vez exista: no sirven como corroboración de nada.
 */
function looksLikeFailure(answer: string): boolean {
  return /^(Falta configurar |(?:Gemini|Groq|DeepSeek|Ollama|OpenAI) (?:rechazo|indico|devolvio)|El modelo '.*' no esta disponible|No hay fragmentos disponibles|No he encontrado información)/i.test(answer.trim());
}

/**
 * Verificado sobre el registro real: 65 de 67 preguntas distintas se repiten
 * —una hasta 165 veces—, señal de pruebas automatizadas (`rag_tester/eval_bot.py`
 * reintenta indefinidamente, per A-12) y no de tráfico ciudadano variado. Unir
 * las fuentes citadas en TODAS las repeticiones mezcla intentos de distintos
 * momentos y proveedores, algunos con retrieval ya desactualizado: para varias
 * preguntas eso sugería 6-8 documentos distintos e incompatibles entre sí para
 * una respuesta que solo puede tener una.
 *
 * Se usa en cambio el CONSENSO: la ruta cuenta solo si aparece en al menos la
 * mitad de las repeticiones de esa pregunta que sí citaron algo. Con una única
 * repetición, "la mitad" es esa misma — sigue funcionando para preguntas que
 * de verdad solo se hicieron una vez.
 */
async function loadHistoricalCitations(): Promise<Map<string, string[]>> {
  let raw: string;
  try {
    raw = await fs.readFile(LOG_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const root = getDocumentsRootPath();
  const [urlToPath, basenameToPaths] = await Promise.all([buildUrlToPathIndex(root), buildBasenameIndex(root)]);

  // Cada repetición aporta el CONJUNTO de rutas que citó (no cada ruta suelta),
  // para que "aparece en la mitad de las repeticiones" cuente repeticiones,
  // no ocurrencias de una ruta que una sola repetición cite varias veces.
  const citationsByQuestion = new Map<string, string[][]>();
  for (const record of parseSemicolonCsv(raw)) {
    const question = (record.Pregunta ?? "").trim();
    const answer = record.Respuesta ?? "";
    const fuentes = record.Fuentes ?? "";
    if (!question || !fuentes || looksLikeFailure(answer)) continue;
    const paths = resolveHistoricalPaths(fuentes, urlToPath, basenameToPaths);
    if (!paths.length) continue;
    const existing = citationsByQuestion.get(question) ?? [];
    existing.push(paths);
    citationsByQuestion.set(question, existing);
  }

  const byQuestion = new Map<string, string[]>();
  for (const [question, repetitions] of citationsByQuestion) {
    const votes = new Map<string, number>();
    for (const paths of repetitions) {
      for (const path of new Set(paths)) votes.set(path, (votes.get(path) ?? 0) + 1);
    }
    const threshold = repetitions.length / 2;
    const consensus = [...votes.entries()].filter(([, count]) => count >= threshold).map(([path]) => path);
    if (consensus.length) byQuestion.set(question, consensus);
  }
  return byQuestion;
}

async function readQueries(): Promise<Query[]> {
  const querySet = JSON.parse(await fs.readFile(QUERIES_PATH, "utf8")) as BaselineQuerySet;
  const factual: Query[] = querySet.cases
    .filter(c => c.kind === "factual")
    .map(c => ({ id: c.id, query: c.query, kind: "factual" as const }));

  const abstentionSet = JSON.parse(await fs.readFile(ABSTENTION_PATH, "utf8")) as
    { queries: Array<{ id: string; query: string }> };
  const abstention: Query[] = abstentionSet.queries.map(q => ({ id: q.id, query: q.query, kind: "abstention" as const }));

  return [...factual, ...abstention];
}

const queries = await readQueries();
console.log(`\n═══ CANDIDATOS PARA EL CONJUNTO DORADO (A-12) ═══\n`);
console.log(`${queries.filter(q => q.kind === "factual").length} preguntas factuales · ${queries.filter(q => q.kind === "abstention").length} de abstención\n`);

const historicalCitations = await loadHistoricalCitations();
console.log(`${historicalCitations.size} preguntas del registro real tienen al menos una fuente citada resoluble a una ruta del corpus.\n`);

await prepareIndex();

const rows: Row[] = [];
let suggested = 0;
let zeroHits = 0;
let suspiciousAbstention = 0;

for (const query of queries) {
  const result = await hybridSearch(query.query);
  const historical = historicalCitations.get(query.query) ?? [];

  if (!result.hits.length) {
    zeroHits++;
    rows.push({
      queryId: query.id, kind: query.kind, query: query.query, rank: 0, path: "", chunk: "",
      bm25: "", semantic: "", rerank: "", score: "", extracto: "(sin resultados)", sugerido: "", relevante: "",
    });
    continue;
  }
  if (query.kind === "abstention" && result.hits.length) suspiciousAbstention++;

  result.hits.forEach((hit, index) => {
    const matchesHistory = historical.includes(hit.path);
    if (matchesHistory) suggested++;
    rows.push({
      queryId: query.id, kind: query.kind, query: query.query, rank: index + 1,
      path: hit.path, chunk: hit.chunk,
      bm25: Number(hit.bm25.toFixed(4)), semantic: Number(hit.semantic.toFixed(4)),
      rerank: typeof hit.rerank === "number" ? Number(hit.rerank.toFixed(4)) : "",
      score: Number(hit.score.toFixed(6)),
      extracto: hit.snippet.replace(/\s+/g, " ").trim().slice(0, 220),
      sugerido: matchesHistory ? "historico" : "",
      relevante: matchesHistory ? "s" : "",
    });
  });
}

await fs.writeFile(OUTPUT_PATH, toCsv(rows), "utf8");

console.log(`Escrito en ${path.relative(process.cwd(), OUTPUT_PATH)}: ${rows.length} filas, ${queries.length} preguntas.`);
console.log(`  ${suggested} fila(s) precompletadas por coincidir con una fuente citada históricamente.`);
console.log(`  ${zeroHits} pregunta(s) sin ningún resultado.`);
if (suspiciousAbstention) {
  console.log(`\n⚠  ${suspiciousAbstention} pregunta(s) de abstención SÍ trajeron resultados — revisa si de verdad`);
  console.log(`   no tienen relación, o si había que sacarlas de la lista de abstención.`);
}
console.log(`\nSiguiente paso: abrir el CSV, revisar cada pregunta y llenar la columna "relevante"`);
console.log(`(s/n) en las filas que falten. Después: npm run golden:finalize`);

await disposeReranker();
await disposeEmbeddings();
