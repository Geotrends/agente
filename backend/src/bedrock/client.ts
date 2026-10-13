/**
 * Cliente Bedrock Runtime (contracts/bedrock-runtime.md, RNF-C3-DI-02, RNF-C3-IN-07/08/10).
 *
 * Región fija sin respaldo regional, SIN reintentos ocultos del SDK (`maxAttempts: 1`) y
 * credenciales EXCLUSIVAS del rol de la instancia: el proveedor es `fromInstanceMetadata`, no la
 * cadena por defecto. La cadena por defecto admitiría además variables, perfiles, archivos
 * compartidos, procesos externos, SSO, web identity y contenedores aunque la configuración
 * rechazara dos variables. IMDSv2 es obligatorio (sin retroceso a IMDSv1). La configuración que
 * declare cualquier otra fuente se rechaza antes de servir (`validateDiConfig`).
 */
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { fromInstanceMetadata } from "@aws-sdk/credential-providers";
import { setting } from "../services/settings.js";

/** Lo mínimo del cliente que usa el adaptador; permite dobles sin red. */
export interface ConverseSender {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

/** Tiempo y reintentos acotados al consultar metadatos: un servicio de metadatos caído no cuelga la consulta. */
export const IMDS_TIMEOUT_MS = 1_000;
export const IMDS_MAX_RETRIES = 2;

/** Proveedor del rol de instancia (IMDSv2 obligatorio, con renovación administrada por el SDK). */
export function instanceRoleProvider(): ReturnType<typeof fromInstanceMetadata> {
  return fromInstanceMetadata({ timeout: IMDS_TIMEOUT_MS, maxRetries: IMDS_MAX_RETRIES, ec2MetadataV1Disabled: true });
}

let client: BedrockRuntimeClient | undefined;

export function bedrockClient(): ConverseSender {
  client ??= new BedrockRuntimeClient({
    region: setting("bedrockRegion"),
    maxAttempts: 1,
    credentials: instanceRoleProvider(),
  });
  return client as unknown as ConverseSender;
}

export function resetBedrockClient(): void { client?.destroy(); client = undefined; }
