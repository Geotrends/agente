/**
 * Genera el manifiesto congelado de la carga N302 (`test/fixtures/in/load-manifest.json`).
 *   npx tsx scripts/build-load-manifest.ts [--corpus=<hash>] [--calibracion=<id>] [--check]
 * Con `--check` solo verifica que el archivo coincide con el plan vigente (sale 1 si difiere).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSequentialPlan, LARGA_MAX_TOKENS, LARGA_MIN_TOKENS } from "./lib/loadRunner.js";

const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const raiz = fileURLToPath(new URL("..", import.meta.url));
const destino = `${raiz}test/fixtures/in/load-manifest.json`;
const matrizHash = createHash("sha256").update(readFileSync(`${raiz}config/base-conocimiento.json`)).digest("hex");

export function buildManifest(corpus: string | null, calibracion: string | null) {
  const plan = buildSequentialPlan(100);
  return {
    version: "1",
    spec: "005-integracion-c3-c4",
    caso: "N302/N303",
    nota: "Preguntas sintéticas. La respuesta larga es una convención de selección del arnés (≥700 y ≤2200 tokens visibles), no un requisito nuevo del producto. Base, calibración y respaldo en corpus se registran al ejecutar en el entorno real.",
    muestra: { total: plan.length, simples: 40, medias: 30, complejas: 30, autorizadas_con_10_pares: 10, largas: 10 },
    largaConvencion: { minTokens: LARGA_MIN_TOKENS, maxTokens: LARGA_MAX_TOKENS },
    oleadas: { cantidad: 3, tamano: 25, autorizadas: 15, conversaciones: 5, anonimas: 10, pausaMs: 120_000, registrosPorDia: 75, autorizadosPorDia: 45, anonimosPorDia: 30 },
    corpus: { matrizHash, corpusHash: corpus, calibracion, respaldoVerificado: false },
    preguntas: plan.map(p => ({ id: p.id, kind: p.kind, pregunta: p.pregunta, autorizada: p.autorizada, conHistorial: p.conHistorial, larga: p.larga })),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const actual = JSON.parse(readFileSync(destino, "utf8"));
    const esperado = buildManifest(actual.corpus.corpusHash, actual.corpus.calibracion);
    const igual = JSON.stringify(actual.preguntas) === JSON.stringify(esperado.preguntas) && JSON.stringify(actual.muestra) === JSON.stringify(esperado.muestra);
    console.log(igual ? "manifiesto vigente" : "el manifiesto difiere del plan: regenerarlo de forma deliberada");
    process.exit(igual ? 0 : 1);
  }
  writeFileSync(destino, JSON.stringify(buildManifest(arg("corpus") ?? null, arg("calibracion") ?? null), null, 2) + "\n");
  console.log(`escrito ${destino}`);
}
