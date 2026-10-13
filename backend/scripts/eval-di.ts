import {cerrarPool} from '../src/kb/db.js';import {shutdownRetrieval} from '../src/services/retrievalClient.js';
/**
 * Matriz de evaluación real del bloque 2 (contracts/acceptance.md).
 *
 *   npm run eval:di -- --manifest=<ruta> --models=both --output=<ruta> [--adapter=aws|double] [--force-cut=80] [--run-delegated]
 *
 * `--adapter=aws` usa Bedrock con el rol temporal de la sesión (NUNCA llaves estáticas). El modelo
 * se fuerza SOLO aquí, en este runner privado: la API pública no tiene ningún selector. Con
 * `--adapter=double` solo se valida la mecánica y el informe lo dice: no cuenta como aceptación.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { readContactSnapshot } from "../src/admin/contacts.js";
import { bedrockAdapter } from "../src/bedrock/askBedrock.js";
import { chatPool, closeChatPool } from "../src/chat/db.js";
import { createConversation, loadConversation, saveClarification } from "../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../src/chat/records.js";
import { validateDiConfig } from "../src/services/diConfig.js";
import { hybridSearch, prepareIndex } from "../src/services/search.js";
import type { ModelAdapter } from "../src/chat/contracts.js";
import { produceEvidence } from "./lib/diRunner.js";

const arg = (name: string): string | undefined => process.argv.slice(2).find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const suite = arg("suite") ?? "di";
if (suite !== "di" && suite !== "va") { console.error("suite inválida"); process.exit(2); }
if (suite === "va") {
  try { const { validationCommand } = await import("./lib/validation/vaCommand.js"); process.exitCode = await validationCommand(process.argv.slice(2)); }
  catch { console.error("Preflight o configuración VA inválidos; no se acredita aceptación."); process.exitCode = 2; }
  await Promise.all([closeChatPool(),cerrarPool(),shutdownRetrieval()]);
  process.exit(process.exitCode);
}

const manifestPath = arg("manifest");
const output = arg("output");
const models = (arg("models") ?? "both") as "both" | "20b" | "120b";
const adapterLabel = (arg("adapter") ?? "aws") as "aws" | "double";
if (!manifestPath || !output) { console.error("Uso: eval:di -- --manifest=<ruta> --output=<ruta> [--models=both|20b|120b] [--adapter=aws|double]"); process.exit(2); }
if (!["both", "20b", "120b"].includes(models)) { console.error("--models debe ser both, 20b o 120b."); process.exit(2); }

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { responsable_manual?: string | null; casos?: unknown[] };
if (adapterLabel === "aws") {
  const problems = validateDiConfig();
  if (problems.length) { console.error(`Configuración inválida para la corrida real:\n- ${problems.join("\n- ")}`); process.exit(2); }
}

/** Doble mínimo para validar la mecánica sin red: responde con la primera fuente. */
const doble: ModelAdapter = {
  call: async (modelId, req) => ({
    text: req.pregunta.length ? "Orientación basada en los documentos [D1].\n<!--FUENTES: D1-->" : "",
    usage: { inputTokens: 100, outputTokens: 20 }, stopReason: "end_turn", effectiveModel: modelId,
  }),
};

await prepareIndex();
const result = await produceEvidence({
  outDir: path.resolve(output), adapterLabel, models,
  adapter: adapterLabel === "aws" ? bedrockAdapter() : doble,
  deps: {
    contacts: () => readContactSnapshot(chatPool()),
    retrieve: async (q, cola) => ({ hits: (await hybridSearch(q, cola)).hits }),
    loadConversation: (id, sub) => loadConversation(id, sub),
    saveClarification: (id, p) => saveClarification(id, p),
    saveInteraction: (rec, h) => saveInteraction(rec, h),
    saveAnonymousUsage: (rec, h) => saveAnonymousUsage(rec, h),
  },
  newConversation: () => createConversation("matriz", process.env.CONSENT_POLICY_VERSION ?? "matriz"),
  environment: {
    region: process.env.BEDROCK_REGION ?? "us-east-1", corpusAlias: process.env.KB_QDRANT_ALIAS ?? "kb_chunks",
    contactosRevision: (await readContactSnapshot(chatPool()))?.revision ?? null,
    manifestCasos: manifest.casos?.length ?? null,
  },
  responsable: manifest.responsable_manual ?? null,
  runDelegated: flag("run-delegated"),
  forceCutTokens: arg("force-cut") ? Number(arg("force-cut")) : undefined,
  only: arg("only")?.split(","),
});

console.log(`adapter=${adapterLabel} · ${result.summary.total} casos · aprobados ${result.summary.aprobados} · fallos ${result.summary.fallados} · pendientes ${result.summary.pendientesManual}`);
console.log(`Evidencia en ${path.resolve(output)}${adapterLabel === "double" ? "  (adapter=double: NO es aceptación de AWS)" : ""}`);
await closeChatPool();
process.exit(result.summary.fallados ? 1 : 0);
