/**
 * Verifica políticas IAM exportadas del rol del servicio contra el contrato (RNF-C3-IN-07/08).
 *
 *   npx tsx scripts/check-iam-policy.ts <politica.json> [más.json…]
 *
 * Cada archivo es un documento de política (inline o adjunta, tal como lo entrega
 * `aws iam get-role-policy` / `get-policy-version`, ya sin envoltorio). Imprime solo nombres de
 * archivo y reglas incumplidas, y resultados de las denegaciones esperadas. Sale con código 1 si
 * algún documento incumple o si la unión permite algo más que lo exigido.
 */
import { readFileSync } from "node:fs";
import { ALLOWED_BEDROCK_MODELS } from "../src/services/diConfig.js";
import { checkContract, evaluate, requiredArns, type PolicyDocument } from "./lib/iamPolicy.js";

const REGION = process.env.BEDROCK_REGION?.trim() || "us-east-1";
const files = process.argv.slice(2);
if (files.length === 0) { console.error("Uso: check-iam-policy.ts <politica.json> [...]"); process.exit(2); }

const docs: PolicyDocument[] = [];
let fail = false;
for (const file of files) {
  const doc = JSON.parse(readFileSync(file, "utf8")) as PolicyDocument;
  docs.push(doc);
  const problemas = checkContract(doc, REGION, ALLOWED_BEDROCK_MODELS);
  console.log(`${problemas.length ? "FALLA" : "ok   "} ${file}${problemas.length ? ": " + problemas.join("; ") : ""}`);
  if (problemas.length) fail = true;
}
const [a, b] = requiredArns(REGION, ALLOWED_BEDROCK_MODELS);
const casos: Array<[string, string, string, "allow" | "implicit_deny" | "deny"]> = [
  ["InvokeModel modelo 20b", "bedrock:InvokeModel", a, "allow"],
  ["InvokeModel modelo 120b", "bedrock:InvokeModel", b, "allow"],
  ["tercer modelo", "bedrock:InvokeModel", `arn:aws:bedrock:${REGION}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`, "implicit_deny"],
  ["listado de modelos", "bedrock:ListFoundationModels", "*", "implicit_deny"],
  ["bucket S3", "s3:GetObject", "arn:aws:s3:::cualquier-bucket/objeto", "implicit_deny"],
  ["gestión de llaves", "iam:CreateAccessKey", "*", "implicit_deny"],
  ["streaming", "bedrock:InvokeModelWithResponseStream", a, "implicit_deny"],
];
for (const [nombre, accion, recurso, esperado] of casos) {
  const r = evaluate(docs, accion, recurso);
  const ok = esperado === "allow" ? r === "allow" : r !== "allow";
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}: ${r}`);
  if (!ok) fail = true;
}
process.exit(fail ? 1 : 0);
