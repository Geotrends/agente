/**
 * Dónde se va el tiempo de una consulta, etapa por etapa.
 *
 *     npm run bench:stages
 *
 * Existe porque la auditoría cifró el coste de una consulta en 230 ms sumando
 * BM25, escaneo y revalidación, y se dejó fuera el reranker —que resultó ser el
 * 84 %—. Un desglose medido evita repetir ese error: antes de optimizar nada,
 * mirar aquí qué etapa manda de verdad.
 *
 * Reproduce las etapas de `hybridSearch` en vez de llamarlo, que es la única
 * forma de cronometrarlas por separado. Si el pipeline cambia, este banco hay
 * que cambiarlo con él; `baseline:check` sigue siendo quien vigila los
 * resultados, este solo vigila el reloj.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { EMBEDDING_DIMENSIONS, prepareIndex } from "../src/services/search.js";
import { aliasKb, qdrant } from "../src/services/qdrant.js";
import { vectorConsulta } from "../src/kb/sparse.js";
import { embed, disposeEmbeddings } from "../src/services/embeddings.js";
import { reciprocalRankFusion } from "../src/services/retrievalMath.js";
import { disposeReranker, rerank } from "../src/services/reranker.js";
import type { BaselineQuerySet } from "./lib/baseline.js";

const FALLBACK = ["requisitos para el permiso de vertimientos", "sanciones por incumplimiento ambiental"];

async function loadQueries(): Promise<string[]> {
  try {
    const set = JSON.parse(await fs.readFile(path.resolve("test/fixtures/baseline-queries.json"), "utf8")) as BaselineQuerySet;
    const factual = set.cases.filter(c => c.kind === "factual").map(c => c.query);
    return factual.length ? factual.slice(0, 20) : FALLBACK;
  } catch { return FALLBACK; }
}

const now = () => Number(process.hrtime.bigint()) / 1e6;

function unitVector(source: ArrayLike<number>): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS);
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) norm += source[i] * source[i];
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) vector[i] = source[i] * scale;
  return vector;
}

console.log("\n═══ DESGLOSE DE UNA CONSULTA, ETAPA POR ETAPA ═══\n");
const queries = await loadQueries();
const index = await prepareIndex();
console.log(`corpus: ${index.documents} documentos · ${index.count} fragmentos · ${EMBEDDING_DIMENSIONS} dimensiones`);
console.log(`hilos del reranker: ${process.env.RERANK_INTRA_OP_THREADS ?? "(defecto)"}\n`);

const stages = { embed: [] as number[], bm25: [] as number[], vector: [] as number[], rrf: [] as number[], rerank: [] as number[] };

// La primera consulta carga los modelos y no representa a las demás.
for (const query of [queries[0], ...queries]) {
  const measure = query !== queries[0] || stages.embed.length > 0;
  const t0 = now();
  const [raw] = await embed([query], "query");
  const vector = unitVector(raw);
  const t1 = now();
  // Etapas sobre Qdrant (research R17): las dos búsquedas van por red local.
  const filtro = { must: [{ key: "estado", match: { value: "publicado" } }] };
  const ids = new Map<string, number>();
  const textos: string[] = [];
  const aRanking = (points: Array<{ id: string | number; score: number; payload?: Record<string, unknown> | null }>) =>
    points.map(p => {
      const clave = String(p.id);
      if (!ids.has(clave)) { ids.set(clave, textos.length); textos.push(String(p.payload?.texto ?? "")); }
      return { id: ids.get(clave)!, score: p.score };
    });
  const lexical = aRanking((await qdrant().query(aliasKb(), { query: vectorConsulta(query), using: "bm25", limit: 40, filter: filtro, with_payload: ["texto"] })).points);
  const t2 = now();
  const semantic = aRanking((await qdrant().query(aliasKb(), { query: Array.from(vector), using: "dense", limit: 40, filter: filtro, with_payload: ["texto"] })).points);
  const t3 = now();
  const candidates = reciprocalRankFusion([lexical, semantic]).slice(0, 16);
  const t4 = now();
  await rerank(query, candidates.map(c => ({ id: c.id, snippet: textos[c.id] })));
  const t5 = now();
  if (!measure) continue;
  stages.embed.push(t1 - t0); stages.bm25.push(t2 - t1); stages.vector.push(t3 - t2);
  stages.rrf.push(t4 - t3); stages.rerank.push(t5 - t4);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const total = Object.values(stages).reduce((sum, xs) => sum + mean(xs), 0);
const LABEL: Record<string, string> = {
  embed: "embedding de la consulta", bm25: "BM25 disperso (Qdrant)",
  vector: "vectorial denso (Qdrant)", rrf: "fusión RRF", rerank: "reranker (cross-encoder)",
};
console.log("  etapa                            media      p50      máx    parte");
for (const [name, xs] of Object.entries(stages)) {
  const sorted = [...xs].sort((a, b) => a - b);
  console.log(
    `  ${LABEL[name].padEnd(30)} ${mean(xs).toFixed(1).padStart(7)} ms ${sorted[Math.floor(sorted.length / 2)].toFixed(1).padStart(7)} ${sorted.at(-1)!.toFixed(1).padStart(8)}   ${((mean(xs) / total) * 100).toFixed(1).padStart(5)} %`);
}
console.log(`  ${"TOTAL".padEnd(30)} ${total.toFixed(1).padStart(7)} ms`);
console.log(`\n  techo de rendimiento en serie: ${(1000 / total).toFixed(2)} consultas/s`);
console.log(`  (el reranker no cede el hilo ni se puede paralelizar en proceso: ver services/reranker.ts)\n`);

await disposeReranker();
await disposeEmbeddings();
