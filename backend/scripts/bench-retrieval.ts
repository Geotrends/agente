/**
 * Banco de medición de la recuperación.
 *
 *     npm run bench:retrieval
 *
 * Imprime las cifras que sustentan los hallazgos C-2, A-1 y A-2, para poder
 * comparar el antes y el después de cada fase con el mismo comando.
 *
 * La separación entre `heapUsed` y `arrayBuffers` es deliberada y es el punto
 * central de C-2: un `Float32Array` vive fuera del heap de V8, así que no cuenta
 * contra el límite de old-space ni lo recorre el recolector. Mover bytes de la
 * primera columna a la segunda vale tanto como eliminarlos.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import v8 from "node:v8";
import { prepareIndex, getIndex, hybridSearch, EMBEDDING_DIMENSIONS } from "../src/services/search.js";
import { embed, disposeEmbeddings } from "../src/services/embeddings.js";
import { rerank, disposeReranker } from "../src/services/reranker.js";
import { topKByDot } from "../src/services/retrievalMath.js";
import type { BaselineQuerySet } from "./lib/baseline.js";

const MB = 1024 * 1024;
const REPEATS = Number(process.env.BENCH_REPEATS) || 7;

const collectGarbage = (globalThis as { gc?: () => void }).gc;
if (!collectGarbage) {
  console.warn("⚠  Sin --expose-gc: las cifras de memoria incluirán basura sin recolectar.");
  console.warn("   Usa: npm run bench:retrieval\n");
}

function settle(): void {
  for (let i = 0; i < 3; i++) collectGarbage?.();
}

function memory() {
  const usage = process.memoryUsage();
  return {
    heap: usage.heapUsed / MB,
    buffers: usage.arrayBuffers / MB,
    external: (usage.external - usage.arrayBuffers) / MB,
    rss: usage.rss / MB,
  };
}

function printMemory(label: string): void {
  settle();
  const m = memory();
  console.log(
    `  ${label.padEnd(30)} heap ${m.heap.toFixed(0).padStart(6)} MB` +
    ` · arrayBuffers ${m.buffers.toFixed(0).padStart(6)} MB` +
    ` · externo ${m.external.toFixed(0).padStart(4)} MB` +
    ` · rss ${m.rss.toFixed(0).padStart(6)} MB`,
  );
}

/**
 * Sonda del retraso del event loop.
 *
 * El hallazgo A-1 no habla de tiempo de reloj sino de BLOQUEO: cuánto tiempo el
 * hilo principal no puede atender otra petición. Un `await` sobre trabajo que
 * corre en otro hilo (el reranker con ONNX) tarda mucho y no bloquea nada; un
 * bucle síncrono sobre 181.000 fragmentos bloquea todo lo que dura. Medir el
 * retraso de un temporizador periódico distingue los dos casos.
 */
function startLoopMonitor(periodMs = 4) {
  let peak = 0;
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const lag = Number(now - last) / 1e6 - periodMs;
    if (lag > peak) peak = lag;
    last = now;
  }, periodMs);
  timer.unref();
  return {
    reset() { peak = 0; last = process.hrtime.bigint(); },
    get peak() { return peak; },
    stop() { clearInterval(timer); },
  };
}

const loop = startLoopMonitor();

/**
 * Cede el turno a la fase de temporizadores.
 *
 * Es imprescindible entre repeticiones: `await` sobre trabajo síncrono solo
 * encola una microtarea, así que el bucle completo correría sin que el
 * `setInterval` de la sonda llegue a dispararse ni una vez, y el pico medido
 * sería siempre cero. Con este `setTimeout` el temporizador vencido se ejecuta
 * y registra el retraso real acumulado.
 */
const yieldToTimers = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

async function time(label: string, run: () => Promise<unknown> | unknown, repeats = REPEATS): Promise<number> {
  await run(); // calentamiento: descarta carga perezosa de modelos y JIT
  const samples: number[] = [];
  let blocked = 0;
  for (let i = 0; i < repeats; i++) {
    await yieldToTimers();
    loop.reset();
    const started = process.hrtime.bigint();
    await run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    await yieldToTimers();
    if (loop.peak > blocked) blocked = loop.peak;
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
  console.log(
    `  ${label.padEnd(38)} p50 ${p50.toFixed(1).padStart(7)} ms   p95 ${p95.toFixed(1).padStart(7)} ms` +
    `   bloqueo ${blocked.toFixed(1).padStart(7)} ms`,
  );
  return p50;
}

// --- consultas de prueba -----------------------------------------------------
const FALLBACK_QUERIES = [
  "requisitos para el permiso de vertimientos segun la resolucion vigente",
  "¿Cuál fue la temperatura máxima registrada en mayo de 2023?",
  "¿Qué acuerdo modifica el Acuerdo 001 de 2018 del Concejo de Envigado?",
  "sanciones por incumplimiento ambiental",
  "plan de inversión vigencia fiscal",
];

async function loadQueries(): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.resolve("test/fixtures/baseline-queries.json"), "utf8");
    const set = JSON.parse(raw) as BaselineQuerySet;
    const factual = set.cases.filter(c => c.kind === "factual").map(c => c.query);
    // Un muestreo determinista y estable entre corridas.
    const step = Math.max(1, Math.floor(factual.length / 5));
    const picked = factual.filter((_, i) => i % step === 0).slice(0, 5);
    return picked.length ? picked : FALLBACK_QUERIES;
  } catch {
    return FALLBACK_QUERIES;
  }
}

// --- medición ----------------------------------------------------------------
console.log("\n═══ BANCO DE MEDICIÓN DE RECUPERACIÓN ═══\n");
console.log(`Node ${process.version} · límite de heap ${(v8.getHeapStatistics().heap_size_limit / MB).toFixed(0)} MB\n`);

console.log("ARRANQUE EN FRÍO");
printMemory("antes de construir");
const coldStart = process.hrtime.bigint();
const index = await prepareIndex();
const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
console.log(`  construcción del índice        ${(coldMs / 1000).toFixed(1)} s`);
printMemory("con el índice construido");

const chunks = index.count;
const snippetBytes = index.snippets.reduce((sum, snippet) => sum + snippet.length, 0);
const vectorBytes = index.vectors.byteLength;
console.log("");
console.log(`  documentos ${index.documents} · fragmentos ${chunks} · firma ${index.signature.slice(0, 12)}…`);
console.log(`  componentes calculables: ${(vectorBytes / MB).toFixed(0)} MB de vectores (Float32Array contiguo, fuera del heap)` +
  ` · ${(snippetBytes / MB).toFixed(0)} MB de texto de fragmentos` +
  ` · ${((index.chunkDoc.byteLength + index.chunkNo.byteLength) / MB).toFixed(1)} MB de metadatos`);
console.log(`  índice léxico: ${index.bm25.postingCount.toLocaleString("es")} postings` +
  ` · ${(index.bm25.byteLength / MB).toFixed(0)} MB fuera del heap, más el diccionario de términos dentro`);

console.log("\nREVALIDACIÓN  (hallazgo A-2)");
// prepareIndex() es la comprobación completa del corpus. getIndex() es lo que
// paga de verdad una consulta: tras A-2 solo devuelve el índice y deja la
// comprobación para un temporizador en segundo plano.
await time("prepareIndex()  — revalidación completa", () => prepareIndex());
await time("getIndex()      — lo que paga la consulta", () => getIndex());

console.log("\nCONSULTA  (hallazgo A-1: bloqueo del event loop)");
const queries = await loadQueries();
const [rawQueryVector] = await embed([queries[0]], "query");
const queryVector = new Float32Array(rawQueryVector);

// El coste de BM25 depende del número de términos de la consulta y de cuán
// comunes sean: se recorren los postings de cada uno.
const shortest = [...queries].sort((a, b) => a.length - b.length)[0];
await time(`BM25 — consulta larga (${queries[0].split(/\s+/).length} palabras)`, () => {
  index.bm25.search(queries[0], 0, index.count, 40);
});
await time(`BM25 — consulta corta (${shortest.split(/\s+/).length} palabras)`, () => {
  index.bm25.search(shortest, 0, index.count, 40);
});

await time("escaneo vectorial exhaustivo", () => {
  // El mismo recorrido que hace hybridSearch sin alcance.
  topKByDot(index.vectors, EMBEDDING_DIMENSIONS, 0, index.count, queryVector, 40);
});

const candidates = index.snippets.slice(0, 16).map((snippet, id) => ({ id, snippet }));
await time("reranker sobre 16 candidatos", () => rerank(queries[0], candidates), 3);

console.log("");
await time("hybridSearch() extremo a extremo", async () => {
  for (const query of queries) await hybridSearch(query);
}, 3);

console.log("\n─────────────────────────────────────────");
printMemory("final");
console.log(
  "\n  «bloqueo» = retraso máximo observado en el event loop durante la medición:\n" +
  "  es el tiempo que el proceso no pudo atender ninguna otra petición.\n",
);

loop.stop();
await disposeReranker();
await disposeEmbeddings();
