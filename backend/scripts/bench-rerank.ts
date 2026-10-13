/**
 * Calibra `RERANK_INTRA_OP_THREADS` para la máquina donde se despliegue.
 *
 *     npm run bench:rerank
 *
 * El reranker es el 80 % del tiempo de una consulta y lo único que lo acelera
 * sin tocar los resultados es el número de hilos que ONNX Runtime reparte dentro
 * de una inferencia. El óptimo NO es el número de núcleos: en un Apple M4 (4 de
 * rendimiento + 6 de eficiencia) está en 4, y subir de ahí empeora. Como eso
 * depende del procesador, aquí se mide en lugar de suponerse.
 *
 * Los puntajes son idénticos bit a bit con cualquier número de hilos, así que
 * cambiar este valor no altera ninguna respuesta; el banco lo comprueba.
 */
import "dotenv/config";
import os from "node:os";
import { prepareIndex } from "../src/services/search.js";
import { aliasKb, qdrant } from "../src/services/qdrant.js";
import { disposeReranker, rerank } from "../src/services/reranker.js";

const QUERY = "requisitos y plazos para el permiso de vertimientos de aguas residuales";
const now = () => Number(process.hrtime.bigint()) / 1e6;

console.log("\n═══ CALIBRACIÓN DE HILOS DEL RERANKER ═══\n");
console.log(`  ${os.cpus().length} núcleos lógicos · ${os.cpus()[0]?.model ?? "?"}\n`);

const index = await prepareIndex();
// 16 fragmentos reales repartidos por el corpus: es exactamente lo que recibe
// el reranker en producción, y su largo manda en el coste de la inferencia.
if (index.count < 16) throw new Error("La colección publicada tiene menos de 16 fragmentos; publica la base antes de calibrar.");
const { points } = await qdrant().scroll(aliasKb(), { limit: Math.min(index.count, 1024), with_payload: ["texto"], with_vector: false });
const step = Math.max(1, Math.floor(points.length / 17));
const candidates = Array.from({ length: 16 }, (_, i) => ({
  id: i, snippet: String((points[Math.min(points.length - 1, step * (i + 1))].payload as { texto: string }).texto),
}));
const average = Math.round(candidates.reduce((sum, c) => sum + c.snippet.length, 0) / candidates.length);
console.log(`  16 candidatos de ${average} caracteres de media\n`);

const options = [...new Set([1, 2, 4, 6, 8, os.cpus().length])].filter(t => t >= 1 && t <= 32).sort((a, b) => a - b);
let reference: number[] | undefined;
let best = { threads: 0, ms: Infinity };

console.log("  hilos    latencia   rendimiento   puntajes");
for (const threads of options) {
  await rerank(QUERY, candidates, threads);                       // carga la sesión
  const rounds = 3, started = now();
  let scores: Map<number, number> = new Map();
  for (let r = 0; r < rounds; r++) scores = await rerank(QUERY, candidates, threads);
  const ms = (now() - started) / rounds;
  const values = candidates.map(c => scores.get(c.id)!);
  reference ??= values;
  const identical = values.every((v, i) => v === reference![i]);
  if (ms < best.ms) best = { threads, ms };
  console.log(`  ${String(threads).padStart(5)}   ${ms.toFixed(0).padStart(7)} ms    ${(1000 / ms).toFixed(2).padStart(5)}/s     ${identical ? "idénticos" : "¡DIFIEREN!"}`);
}

console.log(`\n  óptimo en esta máquina: RERANK_INTRA_OP_THREADS=${best.threads} (${best.ms.toFixed(0)} ms)\n`);
await disposeReranker();
