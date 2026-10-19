/**
 * T051 (parte 1) — Identidad exclusiva de la llave de la aplicación (RNF-C3-IN-07, RNF-C3-IN-08).
 *
 * El cliente de Bedrock toma sus credenciales solo de AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY,
 * sin cadena por defecto (ni perfil ni metadatos de instancia), y la configuración que declare
 * cualquier otra fuente se rechaza sin imprimir su valor. Es evidencia CONTROLADA: no prueba una
 * llave IAM real (T074/T075).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { appKeyProvider, bedrockClient, resetBedrockClient } from "../../src/bedrock/client.js";
import { askBedrock, ModelError } from "../../src/bedrock/askBedrock.js";
import { validateDiConfig } from "../../src/services/diConfig.js";

const LLAVE = { AWS_ACCESS_KEY_ID: "AKIAAPPKEY000000001", AWS_SECRET_ACCESS_KEY: "secretoDeLaApp/0123456789ABCDEF" };

async function conEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previo = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(previo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("las credenciales salen de la llave de la aplicación, aunque haya perfil o metadatos en el entorno", async () => {
  const cred = await conEnv({ ...LLAVE, AWS_PROFILE: "perfil-local", AWS_EC2_METADATA_SERVICE_ENDPOINT: "http://127.0.0.1:9" }, () => appKeyProvider()());
  assert.deepEqual(cred, { accessKeyId: LLAVE.AWS_ACCESS_KEY_ID, secretAccessKey: LLAVE.AWS_SECRET_ACCESS_KEY });
});

test("el cliente de Bedrock usa ese proveedor", async () => {
  try {
    await conEnv(LLAVE, async () => {
      resetBedrockClient();
      const client = bedrockClient() as unknown as { config: { credentials: () => Promise<{ accessKeyId: string }> } };
      assert.equal((await client.config.credentials()).accessKeyId, LLAVE.AWS_ACCESS_KEY_ID);
    });
  } finally { resetBedrockClient(); }
});

test("llave ausente o incompleta: la consulta falla con error seguro de autenticación, sin detalles", async () => {
  try {
    for (const parcial of [{ AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined }, { ...LLAVE, AWS_SECRET_ACCESS_KEY: "  " }]) {
      await conEnv(parcial, async () => {
        resetBedrockClient();
        await assert.rejects(
          () => askBedrock("openai.gpt-oss-20b-1:0", { system: "s", historial: [], pregunta: "¿Qué requisitos tiene?", deadline: Date.now() + 5_000 }),
          (e: unknown) => {
            assert.ok(e instanceof ModelError);
            assert.equal((e as ModelError).kind, "auth");
            assert.ok(!/AKIA|secret/i.test((e as Error).message), "el mensaje no lleva credenciales");
            return true;
          });
      });
    }
  } finally { resetBedrockClient(); }
});

test("configuración: exige la llave y rechaza cada otra fuente por nombre, sin imprimir su valor", async () => {
  const lineaBase = {
    BEDROCK_MODEL_20B: "openai.gpt-oss-20b-1:0", BEDROCK_MODEL_120B: "openai.gpt-oss-120b-1:0", BEDROCK_REGION: "us-east-1",
    CHAT_ALLOWED_ORIGINS: "https://geobot.ejemplo.gov.co", CONSENT_POLICY_VERSION: "2026-10",
    CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica", TOKENIZER_DIR: "/opt/tokenizer",
  };
  await conEnv(lineaBase, async () => {
    const base = { ...LLAVE } as unknown as NodeJS.ProcessEnv;
    const fuentes: Record<string, string> = {
      AWS_SESSION_TOKEN: "IQoJb3JpZ2luX2VjSECRETO",
      AWS_PROFILE: "mi-perfil-sso", AWS_DEFAULT_PROFILE: "otro", AWS_SHARED_CREDENTIALS_FILE: "/home/x/.aws/credentials", AWS_CONFIG_FILE: "/home/x/.aws/config",
      AWS_BEARER_TOKEN_BEDROCK: "ABSKQmVkcm9ja0FQSUtleSECRETO", AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/token", AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/x",
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc", AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://169.254.170.2/creds",
      AWS_CONTAINER_AUTHORIZATION_TOKEN: "tokenContenedorSECRETO", AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://otro.example",
    };
    assert.deepEqual(validateDiConfig(base), [], "la línea base no tiene problemas");
    for (const faltante of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const) {
      const problemas = validateDiConfig({ ...base, [faltante]: "" });
      assert.ok(problemas.some(p => p.includes(faltante)), `${faltante} es obligatoria`);
    }
    for (const [nombre, valor] of Object.entries(fuentes)) {
      const problemas = validateDiConfig({ ...base, [nombre]: valor });
      assert.ok(problemas.some(p => p.includes(nombre)), `${nombre} debe rechazarse`);
      assert.ok(problemas.every(p => !p.includes(valor)), `el problema de ${nombre} no imprime su valor`);
    }
  });
});
