/**
 * Mide lo que la fase F6 promete: que el hilo principal deje de bloquearse.
 *
 *     npm run bench:worker
 *
 * El banco general (`bench:retrieval`) mide la recuperación en proceso, que es
 * lo que corren los scripts y lo que valida `baseline:check`. Este mide la ruta
 * REAL del servidor: `search()` delegando en el worker, con una sonda del
 * retraso del event loop del hilo principal y un "latido" que imita a lo que
 * vería `GET /health` mientras hay consultas en vuelo.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { search, warmUpRetrieval, getRetrievalStatus, stopRetrievalWorker } from "../src/services/retrievalClient.js";
import type { BaselineQuerySet } from "./lib/baseline.js";

const FALLBACK = [
  "requisitos para el permiso de vertimientos",
  "¿Cuál fue la temperatura máxima registrada en mayo de 2023?",
  "sanciones por incumplimiento ambiental",
];

async function loadQueries(): Promise<string[]> {
  try {
    const set = JSON.parse(await fs.readFile(path.resolve("test/fixtures/baseline-queries.json"), "utf8")) as BaselineQuerySet;
    const factual = set.cases.filter(c => c.kind === "factual").map(c => c.query);
    return factual.length ? factual.slice(0, 20) : FALLBACK;
  } catch { return FALLBACK; }
}

/** Latido cada 4 ms: cada retraso es tiempo en que el proceso no atendió nada. */
function startHeartbeat(periodMs = 4) {
  const lags: number[] = [];
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    lags.push(Math.max(0, Number(now - last) / 1e6 - periodMs));
    last = now;
  }, periodMs);
  timer.unref();
  return {
    reset() { lags.length = 0; last = process.hrtime.bigint(); },
    stop() { clearInterval(timer); },
    report(label: string) {
      const sorted = [...lags].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
      console.log(
        `  ${label.padEnd(34)} p50 ${at(0.5).toFixed(1).padStart(6)} ms` +
        `   p99 ${at(0.99).toFixed(1).padStart(7)} ms` +
        `   máx ${(sorted.at(-1) ?? 0).toFixed(1).padStart(7)} ms   (${sorted.length} latidos)`);
      return at(0.99);
    },
  };
}

console.log("\n═══ BANCO DEL WORKER DE RECUPERACIÓN (F6) ═══\n");
console.log(`worker: ${process.env.RETRIEVAL_WORKER === "false" ? "DESACTIVADO (en proceso)" : "activo"}\n`);

const queries = await loadQueries();
const warmStart = Date.now();
await warmUpRetrieval();
console.log(`índice listo en ${((Date.now() - warmStart) / 1000).toFixed(1)} s · estado=${getRetrievalStatus().state}\n`);

const heartbeat = startHeartbeat();

console.log("RETRASO DEL HILO PRINCIPAL");
// Secuencial: una consulta cada vez, como una sola visita.
await search(queries[0]);
heartbeat.reset();
const sequentialStart = Date.now();
for (const query of queries.slice(0, 8)) await search(query);
const sequentialMs = (Date.now() - sequentialStart) / 8;
const sequentialLag = heartbeat.report("8 consultas en serie");

// Concurrente: el caso que antes ponía a los usuarios en cola.
heartbeat.reset();
const concurrentStart = Date.now();
await Promise.all(Array.from({ length: 20 }, (_, i) => search(queries[i % queries.length])));
const concurrentMs = Date.now() - concurrentStart;
const concurrentLag = heartbeat.report("20 consultas concurrentes");

console.log("");
console.log(`  latencia media por consulta en serie   ${sequentialMs.toFixed(0)} ms`);
console.log(`  20 consultas concurrentes en total     ${(concurrentMs / 1000).toFixed(1)} s`);
console.log("");
console.log("  El p99 del retraso es lo que esperaría GET /health estando el servidor ocupado.");
console.log(`  Criterio de F6: p99 por debajo de 10 ms → ${Math.max(sequentialLag, concurrentLag) < 10 ? "CUMPLE" : "NO CUMPLE"}`);

heartbeat.stop();
await stopRetrievalWorker();
