/**
 * T051 (parte 1) — Identidad exclusiva de instancia (RNF-C3-IN-07, RNF-C3-IN-08).
 *
 * Proveedor de metadatos CONTROLADO (IMDS simulado en 127.0.0.1): el servicio obtiene sus
 * credenciales solo del rol, con IMDSv2, ignora llaves/perfil/proceso del entorno, acota el tiempo
 * de espera, y la configuración que declare cualquier otra fuente se rechaza sin imprimir su valor.
 * Es evidencia CONTROLADA: no prueba un rol IAM real ni IMDS de EC2 (T074/T075).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { bedrockClient, instanceRoleProvider, IMDS_MAX_RETRIES, IMDS_TIMEOUT_MS, resetBedrockClient } from "../../src/bedrock/client.js";
import { askBedrock, ModelError } from "../../src/bedrock/askBedrock.js";
import { validateDiConfig } from "../../src/services/diConfig.js";

const ROLE = "geobot-instance-role";
const SENAL = { AccessKeyId: "ASIAROLEFROMIMDS0001", SecretAccessKey: "secretoDelRolSoloEnMetadatos/0123456789ABCDEF", Token: "tokenSesionRolIMDS" };

type Imds = { endpoint: string; log: Array<{ method: string; url: string; token: string | null }>; close: () => Promise<void>;
  mode: { tokenStatus: number; roleListStatus: number; hang: boolean } };

async function startImds(): Promise<Imds> {
  const log: Imds["log"] = [];
  const mode = { tokenStatus: 200, roleListStatus: 200, hang: false };
  const server = http.createServer((req, res) => {
    log.push({ method: req.method ?? "", url: req.url ?? "", token: (req.headers["x-aws-ec2-metadata-token"] as string | undefined) ?? null });
    if (mode.hang) return; // no responde: prueba el tope de tiempo
    if (req.method === "PUT" && req.url === "/latest/api/token") {
      res.statusCode = mode.tokenStatus; return void res.end(mode.tokenStatus === 200 ? "TOKEN-IMDSV2" : "");
    }
    if (req.headers["x-aws-ec2-metadata-token"] !== "TOKEN-IMDSV2") { res.statusCode = 401; return void res.end(); }
    if (req.url === "/latest/meta-data/iam/security-credentials/") {
      res.statusCode = mode.roleListStatus; return void res.end(mode.roleListStatus === 200 ? ROLE : "");
    }
    if (req.url === `/latest/meta-data/iam/security-credentials/${ROLE}`) {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ Code: "Success", Type: "AWS-HMAC", ...SENAL,
        LastUpdated: new Date().toISOString(), Expiration: new Date(Date.now() + 3_600_000).toISOString() }));
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { endpoint: `http://127.0.0.1:${port}`, log, mode, close: () => new Promise(r => { server.closeAllConnections(); server.close(() => r()); }) };
}

async function conEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previo = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(previo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("las credenciales salen SOLO del rol de la instancia con IMDSv2, aunque el entorno traiga llaves, perfil y proceso", async () => {
  const imds = await startImds();
  try {
    const decoy = {
      AWS_EC2_METADATA_SERVICE_ENDPOINT: imds.endpoint,
      AWS_ACCESS_KEY_ID: "AKIAENVDECOY00000001", AWS_SECRET_ACCESS_KEY: "decoyEnvSecret/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      AWS_SESSION_TOKEN: "decoyEnvSessionToken", AWS_PROFILE: "perfil-local", AWS_BEARER_TOKEN_BEDROCK: "ABSKdecoyBearer",
    };
    const cred = await conEnv(decoy, () => instanceRoleProvider()());
    assert.equal(cred.accessKeyId, SENAL.AccessKeyId, "la identidad es la del rol, no la del entorno");
    assert.notEqual(cred.accessKeyId, decoy.AWS_ACCESS_KEY_ID);
    // IMDSv2: PUT del token primero y cada lectura con el token.
    assert.equal(imds.log[0].method, "PUT");
    assert.ok(imds.log.slice(1).every(l => l.token === "TOKEN-IMDSV2"));
    assert.ok(imds.log.some(l => l.url.endsWith(`/security-credentials/${ROLE}`)));
  } finally { await imds.close(); }
});

test("el cliente de Bedrock usa ese proveedor; sin IMDSv2 no hay retroceso a IMDSv1 y no se envía nada sin token", async () => {
  const imds = await startImds();
  try {
    await conEnv({ AWS_EC2_METADATA_SERVICE_ENDPOINT: imds.endpoint }, async () => {
      resetBedrockClient();
      const client = bedrockClient() as unknown as { config: { credentials: () => Promise<{ accessKeyId: string }> } };
      assert.equal((await client.config.credentials()).accessKeyId, SENAL.AccessKeyId);
      resetBedrockClient();

      // El endpoint de token falla: ninguna lectura de credenciales sin token (IMDSv1 deshabilitado).
      imds.mode.tokenStatus = 404;
      imds.log.length = 0;
      await assert.rejects(() => instanceRoleProvider()());
      assert.ok(imds.log.every(l => l.url === "/latest/api/token" || l.token !== null), "ninguna lectura sin token");
      assert.ok(!imds.log.some(l => l.method === "GET" && l.token === null), "sin GET de credenciales sin token (IMDSv1)");
    });
  } finally { await imds.close(); resetBedrockClient(); }
});

test("rol retirado: la consulta falla con error seguro de autenticación (sin detalles) y se reporta indisponibilidad", async () => {
  const imds = await startImds();
  try {
    await conEnv({ AWS_EC2_METADATA_SERVICE_ENDPOINT: imds.endpoint }, async () => {
      resetBedrockClient();
      imds.mode.roleListStatus = 404; // el rol ya no está asociado a la instancia
      await assert.rejects(
        () => askBedrock("openai.gpt-oss-20b-1:0", { system: "s", historial: [], pregunta: "¿Qué requisitos tiene?", deadline: Date.now() + 5_000 }),
        (e: unknown) => {
          assert.ok(e instanceof ModelError);
          assert.equal((e as ModelError).kind, "auth");
          assert.ok(!/AKIA|ASIA|secret|token/i.test((e as Error).message), "el mensaje no lleva credenciales");
          return true;
        });
    });
  } finally { await imds.close(); resetBedrockClient(); }
});

test("metadatos que no responden: el proveedor falla dentro de un tope acotado (timeout y reintentos fijos)", async () => {
  const imds = await startImds();
  imds.mode.hang = true;
  try {
    const t0 = Date.now();
    await conEnv({ AWS_EC2_METADATA_SERVICE_ENDPOINT: imds.endpoint }, () => assert.rejects(() => instanceRoleProvider()()));
    const ms = Date.now() - t0;
    const tope = IMDS_TIMEOUT_MS * (IMDS_MAX_RETRIES + 1) * 2 + 2_000;
    assert.ok(ms <= tope, `falló en ${ms} ms (tope ${tope} ms)`);
  } finally { await imds.close(); }
});

test("configuración: cada fuente distinta del rol se rechaza por nombre, sin imprimir su valor", async () => {
  // `setting()` lee process.env: la configuración válida de línea base se fija ahí.
  const lineaBase = {
    BEDROCK_MODEL_20B: "openai.gpt-oss-20b-1:0", BEDROCK_MODEL_120B: "openai.gpt-oss-120b-1:0", BEDROCK_REGION: "us-east-1",
    CHAT_ALLOWED_ORIGINS: "https://geobot.ejemplo.gov.co", CONSENT_POLICY_VERSION: "2026-10",
    CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica", TOKENIZER_DIR: "/opt/tokenizer",
  };
  await conEnv(lineaBase, async () => {
  const base = {} as unknown as NodeJS.ProcessEnv;
  const fuentes: Record<string, string> = {
    AWS_ACCESS_KEY_ID: "AKIASECRETO0000000001", AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECRETO", AWS_SESSION_TOKEN: "IQoJb3JpZ2luX2VjSECRETO",
    AWS_PROFILE: "mi-perfil-sso", AWS_DEFAULT_PROFILE: "otro", AWS_SHARED_CREDENTIALS_FILE: "/home/x/.aws/credentials", AWS_CONFIG_FILE: "/home/x/.aws/config",
    AWS_BEARER_TOKEN_BEDROCK: "ABSKQmVkcm9ja0FQSUtleSECRETO", AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/token", AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/x",
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc", AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://169.254.170.2/creds",
    AWS_CONTAINER_AUTHORIZATION_TOKEN: "tokenContenedorSECRETO", AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://otro.example",
    AWS_EC2_METADATA_DISABLED: "true", AWS_EC2_METADATA_SERVICE_ENDPOINT: "http://metadatos-falsos.example",
  };
  assert.deepEqual(validateDiConfig(base), [], "la línea base no tiene problemas");
  for (const [nombre, valor] of Object.entries(fuentes)) {
    const problemas = validateDiConfig({ ...base, [nombre]: valor });
    assert.ok(problemas.some(p => p.includes(nombre)), `${nombre} debe rechazarse`);
    assert.ok(problemas.every(p => !p.includes(valor)), `el problema de ${nombre} no imprime su valor`);
  }
  // El endpoint propio de EC2 sí es aceptable.
  assert.deepEqual(validateDiConfig({ ...base, AWS_EC2_METADATA_SERVICE_ENDPOINT: "http://169.254.169.254" } as NodeJS.ProcessEnv), []);
  });
});
