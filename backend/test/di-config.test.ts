import test from "node:test";
import assert from "node:assert/strict";
import { validateDiConfig } from "../src/services/diConfig.js";

const KEYS = ["BEDROCK_MODEL_20B", "BEDROCK_MODEL_120B", "BEDROCK_REGION", "CHAT_ALLOWED_ORIGINS",
  "CONSENT_POLICY_VERSION", "CONSENT_POLICY_URL", "TOKENIZER_DIR", "GEMINI_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"];

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
  AWS_ACCESS_KEY_ID: "AKIAAPPKEY000000001", AWS_SECRET_ACCESS_KEY: "secretoDeLaApp/0123456789",
};

test("una configuración completa no tiene problemas", () => {
  withEnv(OK, () => assert.deepEqual(validateDiConfig(), []));
});

test("sin datos oficiales la readiness queda bloqueada, sin inventar defaults", () => {
  withEnv({}, () => assert.equal(validateDiConfig().length, 6));
});

test("rechaza otros proveedores, sesiones temporales y modelos fuera de la lista", () => {
  withEnv({ ...OK, GEMINI_API_KEY: "x", AWS_SESSION_TOKEN: "x", BEDROCK_MODEL_20B: "otro" }, () => {
    const p = validateDiConfig().join("|");
    assert.match(p, /GEMINI_API_KEY/);
    assert.match(p, /AWS_SESSION_TOKEN/);
    assert.match(p, /BEDROCK_MODEL_20B=otro/);
  });
});

test("exige la llave de la aplicación completa y nunca imprime su valor", () => {
  withEnv({ ...OK, AWS_SECRET_ACCESS_KEY: "" }, () => {
    const p = validateDiConfig();
    assert.ok(p.some(x => x.includes("AWS_SECRET_ACCESS_KEY")));
    assert.ok(p.every(x => !x.includes("AKIAAPPKEY")));
  });
});
