/**
 * T055 — Contrato ejecutable de la política IAM (RNF-C3-IN-07, RNF-C3-IN-08).
 * Una acción, dos ARN exactos, sin comodines, y denegación de todo lo demás. Es evaluación estática
 * del documento: la verificación de políticas efectivas y denegaciones REALES es T075.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALLOWED_BEDROCK_MODELS } from "../../src/services/diConfig.js";
import { checkContract, evaluate, requiredArns, type PolicyDocument } from "../../scripts/lib/iamPolicy.js";

const politica = JSON.parse(readFileSync(fileURLToPath(new URL("../../config/iam-bedrock-policy.json", import.meta.url)), "utf8")) as PolicyDocument;
const REGION = "us-east-1";
const [A, B] = requiredArns(REGION, ALLOWED_BEDROCK_MODELS);

test("la política versionada cumple el contrato: 1 acción, 2 ARN foundation-model exactos, sin comodines", () => {
  assert.deepEqual(checkContract(politica, REGION, ALLOWED_BEDROCK_MODELS), []);
  assert.equal(A, "arn:aws:bedrock:us-east-1::foundation-model/openai.gpt-oss-20b-1:0");
  assert.equal(B, "arn:aws:bedrock:us-east-1::foundation-model/openai.gpt-oss-120b-1:0");
});

test("2 éxitos y 4 denegaciones (+ streaming) sobre el documento", () => {
  assert.equal(evaluate([politica], "bedrock:InvokeModel", A), "allow");
  assert.equal(evaluate([politica], "bedrock:InvokeModel", B), "allow");
  for (const [accion, recurso] of [
    ["bedrock:InvokeModel", `arn:aws:bedrock:${REGION}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`], // tercer modelo
    ["bedrock:ListFoundationModels", "*"],                                                                       // listado
    ["s3:GetObject", "arn:aws:s3:::bucket/objeto"],                                                             // bucket
    ["iam:CreateAccessKey", "*"],                                                                               // llaves
    ["bedrock:InvokeModelWithResponseStream", A],                                                               // streaming
    ["bedrock:InvokeModel", `arn:aws:bedrock:${REGION}:123456789012:inference-profile/us.openai.gpt-oss-20b-1:0`], // perfil
  ] as const) assert.notEqual(evaluate([politica], accion, recurso), "allow", `${accion} ${recurso}`);
});

test("el verificador rechaza comodines, acciones extra, perfiles de inferencia, NotAction y recursos faltantes", () => {
  const con = (s: Record<string, unknown>): PolicyDocument => ({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "bedrock:InvokeModel", Resource: [A, B], ...s } as never] });
  const malas: Array<[string, PolicyDocument, RegExp]> = [
    ["comodín de recurso", con({ Resource: "*" }), /comodines|exactamente/],
    ["comodín de acción", con({ Action: "bedrock:*" }), /bedrock:InvokeModel/],
    ["acción adicional", con({ Action: ["bedrock:InvokeModel", "bedrock:ListFoundationModels"] }), /bedrock:InvokeModel/],
    ["streaming", con({ Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"] }), /bedrock:InvokeModel/],
    ["perfil de inferencia", con({ Resource: [A, `arn:aws:bedrock:${REGION}:123456789012:inference-profile/x`] }), /foundation-model/],
    ["falta un modelo", con({ Resource: [A] }), /exactamente/],
    ["NotAction", { Statement: [{ Effect: "Allow", NotAction: "iam:*", Resource: [A, B] }] }, /NotAction/],
    ["Allow doble", { Statement: [{ Effect: "Allow", Action: "bedrock:InvokeModel", Resource: [A, B] }, { Effect: "Allow", Action: "s3:*", Resource: "*" }] }, /exactamente un Allow/],
  ];
  for (const [nombre, doc, patron] of malas) {
    const p = checkContract(doc, REGION, ALLOWED_BEDROCK_MODELS);
    assert.ok(p.length > 0 && p.some(x => patron.test(x)), `${nombre}: ${p.join(" | ")}`);
  }
});

test("la unión de varias políticas adjuntas se evalúa: un Allow ajeno rompe el contrato; un Deny explícito prevalece", () => {
  const extra: PolicyDocument = { Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "*" }] };
  assert.equal(evaluate([politica, extra], "s3:GetObject", "arn:aws:s3:::x/y"), "allow", "una política adjunta adicional abre acceso: la revisión debe verla");
  const deny: PolicyDocument = { Statement: [{ Effect: "Deny", Action: "bedrock:InvokeModel", Resource: B }] };
  assert.equal(evaluate([politica, deny], "bedrock:InvokeModel", B), "deny");
});
