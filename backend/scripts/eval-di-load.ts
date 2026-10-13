/**
 * Carga real (N302/N303, RNF-C3-IN-02/03). Se ejecuta en DOS días distintos (America/Bogota).
 *
 *   npm run eval:di-load -- --base-url=https://host/api --origin=https://host --policy-version=<v>
 *        --mode=sequential|waves --output=<dir> [--count=100] [--waves=3 --size=25 --gap-ms=120000]
 *        [--manifest=<load-manifest.json>]
 *
 * Criterios (todos incluyen errores y casos lentos en el denominador; p95 nearest-rank):
 *   secuencial: 100 casos 40/30/30, 10 historiales efectivos de 10 pares, 10 respuestas largas
 *               validadas, p95 ≤ 20 s y ninguna consulta > 40 s; corrida no degenerada.
 *   oleadas:    por oleada 25 (15 autorizadas de 5 conversaciones + 10 anónimas), 0 errores,
 *               p95 ≤ 20 s y ninguna > 40 s; pausa de 120 s entre oleadas.
 * La conciliación contra la base (75 registros por día: 45+30) la hace `scripts/lib/loadReconciliation.ts`
 * con acceso restringido a la base de la corrida; aquí solo se guardan métricas y huellas.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  auditSequential, auditWave, bogotaDay, buildSequentialPlan, checkSequentialAudit, checkWaveAudit, runSequential, runWaves, summarize,
  type LoadItem, type Sample,
} from "./lib/loadRunner.js";

const arg = (n: string) => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const baseUrl = arg("base-url");
const mode = arg("mode");
const output = arg("output");
if (!baseUrl || !output || (mode !== "sequential" && mode !== "waves")) {
  console.error("Uso: eval:di-load -- --base-url=<url/api> --mode=sequential|waves --output=<dir> --policy-version=<v> --origin=<origen del ChatBot>");
  process.exit(2);
}
if (!arg("origin")) { console.error("Falta --origin: la carga se ejecuta con el Origin exacto del ChatBot."); process.exit(2); }
const target = { baseUrl: baseUrl.replace(/\/$/, ""), policyVersion: arg("policy-version") ?? process.env.CONSENT_POLICY_VERSION ?? "", origin: arg("origin") };
const started = new Date();
const fechaLocal = bogotaDay(started);

async function planFromManifest(file: string | undefined, count: number): Promise<LoadItem[]> {
  if (!file) return buildSequentialPlan(count);
  const m = JSON.parse(await fs.readFile(file, "utf8")) as { preguntas: LoadItem[] };
  return m.preguntas;
}

type Resumen = Record<string, unknown>;
let resumen: Resumen;
let problemas: string[] = [];
let muestrasCrudas: Sample[] = [];
if (mode === "sequential") {
  const count = Number(arg("count") ?? 100);
  const muestras = await runSequential(target, await planFromManifest(arg("manifest"), count));
  muestrasCrudas = muestras;
  const s = summarize(muestras);
  const audit = auditSequential(muestras);
  problemas = [...checkSequentialAudit(audit, { total: count, simples: Math.round(count * 0.4), medias: Math.round(count * 0.3), complejas: count - Math.round(count * 0.4) - Math.round(count * 0.3), historias: Math.round(count * 0.1), largas: Math.round(count * 0.1) })];
  if (s.p95 > 20_000) problemas.push(`p95 ${s.p95} ms > 20000 ms`);
  if (s.superan40s > 0) problemas.push(`${s.superan40s} consultas > 40000 ms`);
  if (s.errores > 0) problemas.push(`${s.errores} errores`);
  resumen = { modo: mode, ...s, auditoria: audit, criterio: "100 casos 40/30/30, 10 historiales efectivos, 10 largas validadas, p95 ≤ 20000 ms, ninguna > 40000 ms" };
} else {
  const waves = Number(arg("waves") ?? 3);
  const size = Number(arg("size") ?? 25);
  const oleadas = await runWaves(target, waves, size, Number(arg("gap-ms") ?? 120_000));
  muestrasCrudas = oleadas.flat();
  const porOleada = oleadas.map((o, i) => {
    const s = summarize(o); const a = auditWave(o);
    const pr = [...checkWaveAudit(a)];
    if (s.p95 > 20_000) pr.push(`p95 ${s.p95} ms > 20000 ms`);
    if (s.superan40s > 0) pr.push(`${s.superan40s} consultas > 40000 ms`);
    problemas.push(...pr.map(p => `oleada ${i + 1}: ${p}`));
    return { oleada: i + 1, ...s, auditoria: a };
  });
  resumen = { modo: mode, porOleada, criterio: "por oleada: 15 autorizadas de 5 conversaciones + 10 anónimas, 0 errores, p95 ≤ 20000 ms, ninguna > 40000 ms" };
}
const aprobado = problemas.length === 0;
const evidencia = {
  fecha: started.toISOString(), fechaLocalBogota: fechaLocal, componente: "A/P (solo si la URL es el servicio desplegado)", baseUrl: target.baseUrl,
  ...resumen, aprobado, problemas,
  // Solo metadatos: ids de caso, tiempos y huellas; ningún texto de pregunta o respuesta.
  muestras: muestrasCrudas.map(s => ({ id: s.id, ms: Math.round(s.ms), status: s.status, ok: s.ok, autorizada: s.autorizada, historial: s.historial, larga: s.larga, tipo: s.tipo, tokens: s.tokens, inicioMs: s.inicioMs, grupo: s.grupo, conversacion: s.conversacion, responseId: s.responseId })),
  nota: "Preguntas sintéticas; no se guardan respuestas ni credenciales.",
};
await fs.mkdir(path.resolve(output), { recursive: true });
await fs.writeFile(path.join(path.resolve(output), `${mode}-${fechaLocal}-${started.toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(evidencia, null, 2) + "\n");
console.log(JSON.stringify({ ...evidencia, muestras: `${evidencia.muestras.length} muestras (en el archivo)` }, null, 2));
process.exit(aprobado ? 0 : 1);
