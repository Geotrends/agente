/**
 * Matriz de inyección contra los modelos (N311).
 *   npx tsx scripts/eval-injection.ts --models=both [--adapter=aws|double] [--output=ruta.json]
 * `--adapter=aws` usa Bedrock real con la llave de la aplicación (T075); sin él se usa un doble
 * conforme y el resultado se etiqueta `controlado`. Sale con 1 si algún caso falla.
 */
import { writeFileSync } from "node:fs";
import { bedrockAdapter } from "../src/bedrock/askBedrock.js";
import { ALLOWED_BEDROCK_MODELS } from "../src/services/diConfig.js";
import { runInjectionMatrix } from "./lib/injectionMatrix.js";

const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const adapterName = arg("adapter") ?? "double";
const models = arg("models") === "20b" ? [ALLOWED_BEDROCK_MODELS[0]] : arg("models") === "120b" ? [ALLOWED_BEDROCK_MODELS[1]] : [...ALLOWED_BEDROCK_MODELS];
const adapter = adapterName === "aws"
  ? bedrockAdapter()
  : { call: async (m: string) => ({ text: "Orientación sobre el trámite [D1]. Decide la dirección responsable.\n<!--FUENTES: D1-->", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" as const, effectiveModel: m }) };
const results = await runInjectionMatrix(adapter, models);
const fallos = results.filter(r => !r.ok);
const informe = { componente: adapterName === "aws" ? "A" : "C", fecha: new Date().toISOString(), modelos: models, casos: results.length, fallos: fallos.length, resultados: results };
if (arg("output")) writeFileSync(arg("output")!, JSON.stringify(informe, null, 2));
console.log(`${informe.casos} casos (${results.length / models.length} × ${models.length} modelos), ${fallos.length} fallos, componente ${informe.componente}`);
for (const f of fallos) console.log(`  FALLA ${f.model} ${f.id}: ${f.failures.join("; ")}`);
process.exit(fallos.length ? 1 : 0);
