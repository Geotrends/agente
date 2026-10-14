/**
 * Validación de la configuración del bloque 2 (RNF-C3-DI-02, RNF-C3-IN-07/08/10).
 *
 * Devuelve la lista de problemas en vez de lanzar: la readiness los muestra todos
 * a la vez y el arranque decide. Nada aquí inventa un valor oficial (rol, contactos,
 * tarifas): si falta, el servicio no se declara listo.
 */
import { setting } from "./settings.js";
import { parseTrustProxy } from "./trustProxy.js";

/** Los dos únicos modelos que pueden recibir una consulta. */
export const ALLOWED_BEDROCK_MODELS = ["openai.gpt-oss-20b-1:0", "openai.gpt-oss-120b-1:0"] as const;

/** Variables que habilitarían otro proveedor de inferencia; si alguna tiene valor, se rechaza. */
const FORBIDDEN_LLM_ENV = [
  "GEMINI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "OLLAMA_BASE_URL",
  // El umbral de relevancia sale de la calibración vigente, no de una variable fijada a ojo.
  "MIN_RERANK_SCORE",
] as const;

/**
 * Toda fuente de credenciales distinta del rol de la instancia (RNF-C3-IN-07/08/10). El runtime usa
 * únicamente `fromInstanceMetadata`; declarar cualquiera de estas variables indica una identidad
 * que no es la del servidor (llaves, sesión temporal exportada, perfil/SSO, proceso externo, web
 * identity, credenciales de contenedor, bearer key de Bedrock o metadatos alternos) y bloquea la
 * readiness. Los mensajes nombran la variable, jamás su valor.
 */
const NON_ROLE_AWS_ENV = [
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_CREDENTIAL_EXPIRATION",
  "AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "AWS_SDK_LOAD_CONFIG",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  "AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
] as const;

/** Metadatos de instancia: solo los extremos propios de EC2 son aceptables. */
const IMDS_ENDPOINTS = new Set(["http://169.254.169.254", "http://[fd00:ec2::254]"]);

export function parseOrigins(raw: string): string[] {
  return raw.split(",").map(o => o.trim()).filter(Boolean);
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

/**
 * Variables de proveedores o identidades deshabilitados con valor (SPEC008, principio V). Se usa
 * en el arranque directo del backend: `make up` ya las rechaza con `check-env`, pero un arranque
 * sin Compose no pasaba por ahí y solo marcaba `/ready`. Nunca incluye valores.
 */
export function forbiddenCredentialEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...FORBIDDEN_LLM_ENV, ...NON_ROLE_AWS_ENV].filter(name => name !== "MIN_RERANK_SCORE" && Boolean(env[name]?.trim()));
}

export function validateDiConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const small = setting("bedrockModelSmall");
  const large = setting("bedrockModelLarge");
  for (const [name, id] of [["BEDROCK_MODEL_20B", small], ["BEDROCK_MODEL_120B", large]] as const) {
    if (!(ALLOWED_BEDROCK_MODELS as readonly string[]).includes(id)) {
      problems.push(`${name}=${id} no está en la lista permitida`);
    }
  }
  if (small === large) problems.push("BEDROCK_MODEL_20B y BEDROCK_MODEL_120B deben ser distintos");
  if (setting("bedrockRegion") !== "us-east-1") problems.push("BEDROCK_REGION debe ser us-east-1");

  for (const name of NON_ROLE_AWS_ENV) {
    if (env[name]?.trim()) problems.push(`${name} no se admite: la identidad es exclusivamente el rol de la instancia`);
  }
  if (env.AWS_EC2_METADATA_DISABLED?.trim().toLowerCase() === "true") {
    problems.push("AWS_EC2_METADATA_DISABLED no se admite: el rol de instancia es la única identidad");
  }
  const imds = env.AWS_EC2_METADATA_SERVICE_ENDPOINT?.trim();
  if (imds && !IMDS_ENDPOINTS.has(imds.replace(/\/+$/, ""))) {
    problems.push("AWS_EC2_METADATA_SERVICE_ENDPOINT no se admite: solo los metadatos propios de EC2");
  }
  if (env.AWS_EC2_METADATA_V1_DISABLED?.trim().toLowerCase() === "false") {
    problems.push("AWS_EC2_METADATA_V1_DISABLED=false no se admite: IMDSv2 es obligatorio");
  }
  for (const name of FORBIDDEN_LLM_ENV) {
    if (env[name]?.trim()) problems.push(`${name} habilitaría otro proveedor de inferencia`);
  }

  // El límite por IP solo es fiable si la IP del cliente se resuelve con una topología declarada.
  problems.push(...parseTrustProxy(env.TRUST_PROXY).problems);

  const origins = parseOrigins(setting("chatAllowedOrigins"));
  if (origins.length === 0) problems.push("CHAT_ALLOWED_ORIGINS está vacío");
  for (const origin of origins) {
    if (!isHttpsUrl(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      problems.push(`origen inválido en CHAT_ALLOWED_ORIGINS: ${origin}`);
    }
  }
  if (!setting("consentPolicyVersion")) problems.push("CONSENT_POLICY_VERSION está vacía");
  if (!isHttpsUrl(setting("consentPolicyUrl"))) problems.push("CONSENT_POLICY_URL debe ser una URL https");
  if (!setting("tokenizerDir")) problems.push("TOKENIZER_DIR está vacío");
  return problems;
}
