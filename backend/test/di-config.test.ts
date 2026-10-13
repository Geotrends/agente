import test from "node:test";
import assert from "node:assert/strict";
import { validateDiConfig } from "../src/services/diConfig.js";

const KEYS = ["BEDROCK_MODEL_20B", "BEDROCK_MODEL_120B", "BEDROCK_REGION", "CHAT_ALLOWED_ORIGINS",
  "CONSENT_POLICY_VERSION", "CONSENT_POLICY_URL", "TOKENIZER_DIR", "GEMINI_API_KEY", "AWS_ACCESS_KEY_ID"];

function withEnv(values: Record<string, string>, fn: () => void): void {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
  try { fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const OK = {
  CHAT_ALLOWED_ORIGINS: "https://geobot.ejemplo.gov.co", CONSENT_POLICY_VERSION: "2026-10",
  CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica", TOKENIZER_DIR: "/app/var/tokenizer",
};

test("una configuración completa no tiene problemas", () => {
  withEnv(OK, () => assert.deepEqual(validateDiConfig(), []));
});

test("sin datos oficiales la readiness queda bloqueada, sin inventar defaults", () => {
  withEnv({}, () => assert.equal(validateDiConfig().length, 4));
});

test("rechaza otros proveedores, llaves estáticas y modelos fuera de la lista", () => {
  withEnv({ ...OK, GEMINI_API_KEY: "x", AWS_ACCESS_KEY_ID: "x", BEDROCK_MODEL_20B: "otro" }, () => {
    const p = validateDiConfig().join("|");
    assert.match(p, /GEMINI_API_KEY/);
    assert.match(p, /AWS_ACCESS_KEY_ID/);
    assert.match(p, /BEDROCK_MODEL_20B=otro/);
  });
});
