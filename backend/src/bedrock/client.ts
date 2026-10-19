/**
 * Cliente Bedrock Runtime (contracts/bedrock-runtime.md, RNF-C3-DI-02, RNF-C3-IN-07/08/10).
 *
 * Región fija sin respaldo regional, SIN reintentos ocultos del SDK (`maxAttempts: 1`) y
 * credenciales EXCLUSIVAS de la llave de acceso creada para la aplicación (`AWS_ACCESS_KEY_ID` y
 * `AWS_SECRET_ACCESS_KEY`). El proveedor las lee de forma explícita en cada renovación del SDK y no
 * usa la cadena por defecto, que admitiría además perfiles, archivos compartidos, procesos externos,
 * SSO, web identity, contenedores y metadatos de instancia. La configuración que declare cualquier
 * otra fuente se rechaza antes de servir (`validateDiConfig`).
 */
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { setting } from "../services/settings.js";

/** Lo mínimo del cliente que usa el adaptador; permite dobles sin red. */
export interface ConverseSender {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

export type AppCredentials = { accessKeyId: string; secretAccessKey: string };

/**
 * Proveedor de la llave de la aplicación. Lee el entorno en cada llamada; si falta una de las dos
 * partes falla con `CredentialsProviderError`, que el adaptador traduce a error `auth` sin detalles.
 */
export function appKeyProvider(env: NodeJS.ProcessEnv = process.env): () => Promise<AppCredentials> {
  return async () => {
    const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
    if (!accessKeyId || !secretAccessKey) {
      const e = new Error("Faltan las credenciales de la aplicación para Bedrock");
      e.name = "CredentialsProviderError";
      throw e;
    }
    return { accessKeyId, secretAccessKey };
  };
}

let client: BedrockRuntimeClient | undefined;

export function bedrockClient(): ConverseSender {
  client ??= new BedrockRuntimeClient({
    region: setting("bedrockRegion"),
    maxAttempts: 1,
    credentials: appKeyProvider(),
  });
  return client as unknown as ConverseSender;
}

export function resetBedrockClient(): void { client?.destroy(); client = undefined; }
