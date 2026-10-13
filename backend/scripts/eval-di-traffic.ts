/**
 * Prueba de tráfico (RNF-C3-DI-02, RNF-C3-IN-07/08/10): 20 consultas sintéticas con registro de los
 * destinos de red. Aprueba solo si el único destino de inferencia es Bedrock (modelos permitidos)
 * y hay 0 conexiones a otros proveedores. Solo guarda host:puerto; ni contenido ni credenciales.
 *
 *   npm run eval:di-traffic -- --output=<dir> [--adapter=aws|double] [--infra-hosts=qdrant,postgres]
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { readContactSnapshot } from "../src/admin/contacts.js";
import { bedrockAdapter } from "../src/bedrock/askBedrock.js";
import { chatPool, closeChatPool } from "../src/chat/db.js";
import { Deadline } from "../src/chat/deadline.js";
import { handleChat } from "../src/chat/handleChat.js";
import { loadConversation, saveClarification, createConversation } from "../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../src/chat/records.js";
import { validateDiConfig } from "../src/services/diConfig.js";
import { hybridSearch, prepareIndex } from "../src/services/search.js";
import type { ModelAdapter } from "../src/chat/contracts.js";
import { NetCapture } from "./lib/netCapture.js";

const arg = (n: string) => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const output = arg("output");
const label = (arg("adapter") ?? "aws") as "aws" | "double";
if (!output) { console.error("Uso: eval:di-traffic -- --output=<dir> [--adapter=aws|double]"); process.exit(2); }
const region = process.env.BEDROCK_REGION ?? "us-east-1";
const infra = (arg("infra-hosts") ?? process.env.TRAFFIC_INFRA_HOSTS ?? "").split(",").map(s => s.trim()).filter(Boolean);

const OTHER_PROVIDER_ENV = ["GEMINI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "OLLAMA_BASE_URL", "MIN_RERANK_SCORE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
const configProblems = validateDiConfig();
const envFound = OTHER_PROVIDER_ENV.filter(k => process.env[k]?.trim());

const PREGUNTAS = [
  "¿Cómo registro a mi mascota en el RUM?", "¿Qué requisitos tiene la licencia ambiental?", "¿Cómo solicito una visita técnica de arbolado?", "¿Dónde denuncio el maltrato animal?",
  "¿Cómo adopto una mascota?", "¿Cuál es el horario de atención?", "¿Qué documentos pide la adopción?", "¿Qué es el RUM?", "¿Cómo pido una poda?", "¿Qué es un GT-F?",
  "Compara el procedimiento de adopción con el de registro RUM en requisitos, plazos y responsables", "¿Me aprueban el permiso de poda?", "¿Qué dice la norma sobre el maltrato animal y qué sanciones prevé?",
  "Explícame en detalle los pasos de la licencia ambiental y sus plazos", "¿Cómo hago seguimiento a mi PQRSD?", "¿Qué hace la dirección de Gestión Ambiental?", "¿Cómo registro un criadero?",
  "¿Qué requisitos tiene el carnet de vacunación?", "¿Quién atiende los incendios forestales?", "¿Cómo radico una queja por ruido?",
];

const doble: ModelAdapter = { call: async (m) => ({ text: "Orientación [D1].\n<!--FUENTES: D1-->", usage: { inputTokens: 100, outputTokens: 20 }, stopReason: "end_turn", effectiveModel: m }) };
const capture = new NetCapture();
capture.start();
await prepareIndex();
const adapter = label === "aws" ? bedrockAdapter() : doble;
const deps = {
  contacts: () => readContactSnapshot(chatPool()), adapter,
  retrieve: async (q: string, cola?: string) => ({ hits: (await hybridSearch(q, cola)).hits }),
  loadConversation: (id: string, sub: string) => loadConversation(id, sub),
  saveClarification: (id: string, p: boolean) => saveClarification(id, p),
  saveInteraction: saveInteraction as never, saveAnonymousUsage: saveAnonymousUsage as never,
};
let ok = 0;
for (const [i, pregunta] of PREGUNTAS.entries()) {
  const conversationId = i % 2 === 0 ? await createConversation("trafico", process.env.CONSENT_POLICY_VERSION ?? "trafico") : undefined;
  const r = await handleChat({ pregunta, historial: [], ...(conversationId ? { conversationId } : {}) }, "trafico", deps, new Deadline());
  if (r.status === 200) ok++;
}
capture.stop();

const destinos = capture.destinations(region, infra);
const noAutorizados = destinos.filter(d => d.clase === "NO_AUTORIZADO");
const bedrock = destinos.filter(d => d.clase === "bedrock");
const evidencia = {
  fecha: new Date().toISOString(), adapter: label, consultas: PREGUNTAS.length, respondidas: ok, region,
  destinos, conexionesNoAutorizadas: noAutorizados.reduce((a, d) => a + d.count, 0),
  tráficoBedrockObservado: bedrock.reduce((a, d) => a + d.count, 0),
  configuracion: { problemas: configProblems, variablesDeOtrosProveedoresPresentes: envFound },
  nota: label === "double" ? "adapter=double: no hubo tráfico a Bedrock; esto NO acredita RNF-C3-DI-02." : "Solo host:puerto y contadores; sin contenido ni credenciales.",
};
await fs.mkdir(path.resolve(output), { recursive: true });
await fs.writeFile(path.join(path.resolve(output), "destinos.json"), JSON.stringify(evidencia, null, 2) + "\n");
console.log(`adapter=${label} · ${ok}/${PREGUNTAS.length} respondidas · destinos ${destinos.length} · NO autorizados ${evidencia.conexionesNoAutorizadas} · tráfico Bedrock ${evidencia.tráficoBedrockObservado}`);
await closeChatPool();
const fail = evidencia.conexionesNoAutorizadas > 0 || envFound.length > 0 || (label === "aws" && evidencia.tráficoBedrockObservado === 0);
process.exit(fail ? 1 : 0);
