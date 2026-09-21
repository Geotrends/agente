/**
 * Reintentos ante fallos transitorios de proveedor (hallazgo M-10).
 *
 * Ningún proveedor reintentaba: un parpadeo de red o un 503 pasajero se
 * convertía directamente en un mensaje de error para el ciudadano, teniendo la
 * respuesta a un intento de distancia.
 *
 * Lo que hace que esto sea seguro y no un multiplicador de latencia y de cuota
 * es la clasificación de A-4: solo se reintenta lo que el tipo marca como
 * `retryable` —red y 5xx— más la saturación, que se pasa sola. Un 401 o un
 * modelo inexistente se devuelven al primer intento, porque repetirlos da
 * exactamente el mismo error.
 */
import { setting } from "../services/settings.js";
import type { ProviderResult } from "./llmTypes.js";

export type RetryConfig = {
  /** Intentos TOTALES, no reintentos: 2 significa uno y, si falla, otro. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export function retryConfig(): RetryConfig {
  return {
    attempts: setting('providerRetryAttempts'),
    baseDelayMs: setting('providerRetryBaseMs'),
    maxDelayMs: setting('providerRetryMaxMs'),
  };
}

/**
 * Cuánto esperar antes del siguiente intento.
 *
 * Si el proveedor mandó `Retry-After`, esa es la espera que él considera
 * correcta: ignorarla y reintentar de inmediato es pedir otro 429. Se respeta,
 * pero acotada por `maxDelayMs` — un `Retry-After: 3600` no puede dejar una
 * petición HTTP colgada una hora. Sin cabecera, retroceso exponencial.
 */
export function retryDelayMs(
  config: RetryConfig, attemptIndex: number, retryAfterSeconds?: number,
): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, config.maxDelayMs);
  }
  return Math.min(config.baseDelayMs * 2 ** attemptIndex, config.maxDelayMs);
}

/** `Retry-After` en segundos, tanto en su forma numérica como de fecha HTTP. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, (date - Date.now()) / 1000);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type Attempt = () => Promise<{ result: ProviderResult; retryAfterSeconds?: number }>;

/**
 * Ejecuta `attempt` hasta `config.attempts` veces, parando en cuanto haya
 * respuesta o un fallo que no mejore repitiéndose.
 */
export async function withRetry(
  attempt: Attempt,
  config: RetryConfig,
  onRetry?: (result: ProviderResult, delayMs: number) => void,
): Promise<ProviderResult> {
  let last: ProviderResult | undefined;
  for (let index = 0; index < config.attempts; index++) {
    const { result, retryAfterSeconds } = await attempt();
    if (result.ok || !result.retryable) return result;
    last = result;
    const isLast = index === config.attempts - 1;
    if (isLast) break;
    const delay = retryDelayMs(config, index, retryAfterSeconds);
    onRetry?.(result, delay);
    if (delay > 0) await sleep(delay);
  }
  return last!;
}
