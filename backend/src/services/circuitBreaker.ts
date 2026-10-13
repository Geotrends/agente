/**
 * Circuit breaker por proveedor y modelo (auditoría pre-producción, rendimiento).
 *
 * Sin esto, un proveedor caído seguía recibiendo cada consulta: cada una
 * esperaba sus timeouts completos ocupando una plaza del chat, y en hora pico
 * las plazas se agotaban aunque el proveedor de reemplazo estuviera sano.
 *
 * Tras `PROVIDER_BREAKER_FAILURES` fallos seguidos el circuito se abre, y
 * durante `PROVIDER_BREAKER_COOLDOWN_MS` las consultas saltan directo al
 * reemplazo sin esperar. Al vencer, UNA sola consulta de prueba decide: si
 * responde, el circuito se cierra; si falla, se vuelve a abrir. Las demás
 * siguen saltándolo mientras la prueba está en curso, para no mandar una
 * ráfaga entera a un proveedor que quizá sigue caído.
 *
 * Solo cuentan los fallos que dicen algo de la salud del proveedor: red,
 * timeout, saturación y 5xx. Una clave mala o un modelo inexistente son
 * errores de configuración: no se arreglan esperando, y ya los reporta el
 * aviso de consulta sin respuesta.
 *
 * El estado vive en el proceso, igual que las cuotas: vale para una réplica.
 */
import { setting } from "./settings.js";
import type { ProviderResult } from "../shared/llmTypes.js";

type Circuit = {
  /** Fallos seguidos que cuentan contra el proveedor. */
  failures: number;
  /** Hasta cuándo se salta (epoch ms). 0 = cerrado. */
  openUntil: number;
  /** Hay una consulta de prueba en curso tras vencer la espera. */
  probing: boolean;
};

const circuits = new Map<string, Circuit>();

/**
 * `closed`: se llama con normalidad. `probe`: es la consulta de prueba tras la
 * espera. `open`: se salta, sin llamar al proveedor.
 */
export type Admission = "closed" | "probe" | "open";

export function admit(key: string, now = Date.now()): Admission {
  const circuit = circuits.get(key);
  if (!circuit || circuit.openUntil === 0) return "closed";
  if (now < circuit.openUntil || circuit.probing) return "open";
  circuit.probing = true;
  return "probe";
}

/** Si un fallo dice algo de la salud del proveedor, y no de nuestra configuración. */
export function countsAgainstProvider(result: ProviderResult): boolean {
  if (result.ok) return false;
  if (result.kind === "network" || result.kind === "quota" || result.kind === "timeout") return true;
  // `unknown` reintentable es un 5xx o una respuesta vacía por límite de tokens.
  return result.kind === "unknown" && result.retryable;
}

/**
 * Registra el desenlace de una llamada. Devuelve `true` solo cuando esta
 * llamada ABRE un circuito que estaba cerrado: es el momento de avisar, no
 * cada vez que una prueba vuelve a fallar.
 */
export function record(key: string, result: ProviderResult, now = Date.now()): boolean {
  if (result.ok) {
    circuits.delete(key);
    return false;
  }
  const circuit = circuits.get(key) ?? { failures: 0, openUntil: 0, probing: false };
  const wasProbe = circuit.probing;
  circuit.probing = false;
  if (!countsAgainstProvider(result)) {
    // La prueba no aclaró nada (p. ej. un 401): la siguiente consulta vuelve a
    // probar. Si estaba cerrado, sigue cerrado.
    if (circuit.openUntil !== 0 || circuit.failures > 0) circuits.set(key, circuit);
    return false;
  }
  circuit.failures++;
  circuits.set(key, circuit);
  if (wasProbe || circuit.failures >= setting("providerBreakerFailures")) {
    const opening = circuit.openUntil === 0;
    circuit.openUntil = now + setting("providerBreakerCooldownMs");
    return opening;
  }
  return false;
}

/** Fallos seguidos de un circuito, para los mensajes de aviso. */
export function consecutiveFailures(key: string): number {
  return circuits.get(key)?.failures ?? 0;
}

/** Solo para pruebas: cierra todos los circuitos. */
export function resetCircuits(): void {
  circuits.clear();
}
