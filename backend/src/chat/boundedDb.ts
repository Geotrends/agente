/**
 * Acceso a PostgreSQL acotado por el presupuesto restante de la solicitud (RF-C3-IN-04/08).
 *
 * Reglas:
 *  - La adquisición del pool, cada sentencia, la espera de locks y el COMMIT no pueden pasar del
 *    presupuesto. La cancelación es EFECTIVA: se fijan `statement_timeout`/`lock_timeout` en la
 *    transacción y, si el cliente abandona antes, la conexión se descarta (rollback del servidor).
 *  - Nada de `Promise.race` que deje trabajo vivo: toda conexión adquirida tarde se libera y toda
 *    conexión cuyo estado no se puede garantizar se descarta.
 *  - Un COMMIT cuyo resultado se desconoce es `indeterminada`: no demuestra que la fila no exista,
 *    por lo que el llamador no emite ID público ni reenvía el texto.
 */
import type pg from "pg";
import type { PersistenceState } from "./requestContext.js";

/** Lo mínimo del presupuesto: tiempo restante y señal de cancelación opcional. */
export type Budget = { remainingMs(): number; signal?: AbortSignal };

export type BoundedReason = "presupuesto" | "pool" | "sentencia" | "lock" | "commit" | "conexion" | "error";

export type BoundedOutcome<T> =
  | { state: "confirmada"; value: T }
  | { state: Exclude<PersistenceState, "confirmada" | "no_iniciada" | "en_curso">; reason: BoundedReason; code?: string };

/** Margen que se reserva para el cleanup (ROLLBACK/release) dentro del presupuesto. */
const CLEANUP_MS = 50;
const MIN_STEP_MS = 5;

const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error("aborted");

/** Adquiere una conexión sin esperar más de `ms`; una conexión que llegue tarde se libera sola. */
async function acquire(pool: pg.Pool, ms: number, signal?: AbortSignal): Promise<pg.PoolClient | "timeout" | "aborted"> {
  if (ms < MIN_STEP_MS) return "timeout";
  if (signal?.aborted) return "aborted";
  return await new Promise(resolve => {
    let settled = false;
    const finish = (v: pg.PoolClient | "timeout" | "aborted") => {
      if (settled) { if (typeof v !== "string") (v as pg.PoolClient).release(); return; }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const timer = setTimeout(() => finish("timeout"), ms);
    const onAbort = () => finish("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    pool.connect().then(
      client => { if (settled) client.release(); else finish(client); },
      () => finish("timeout"),
    );
  });
}

const isCancelCode = (code?: string): boolean => code === "57014";
const isLockCode = (code?: string): boolean => code === "55P03";
const isConnectionError = (e: unknown): boolean => {
  const code = (e as { code?: string })?.code;
  if (code && /^(08|57P0|53)/.test(code)) return true;
  const msg = e instanceof Error ? e.message : "";
  return /Connection terminated|ECONNRESET|EPIPE|connection.*(closed|lost)/i.test(msg);
};

/**
 * Ejecuta `fn` dentro de una transacción acotada. `fn` recibe la conexión y debe terminar con las
 * sentencias de la transacción; el COMMIT lo emite esta función. Un resultado `confirmada` implica
 * COMMIT reconocido por el servidor.
 */
export async function runBounded<T>(
  pool: pg.Pool, budget: Budget, fn: (client: pg.PoolClient) => Promise<T>,
): Promise<BoundedOutcome<T>> {
  const signal = budget.signal;
  const acquired = await acquire(pool, budget.remainingMs() - CLEANUP_MS, signal);
  if (acquired === "aborted") return { state: "cancelada", reason: "presupuesto" };
  if (acquired === "timeout") return { state: "fallida", reason: "pool" };
  const client = acquired;

  let discard = false;
  let phase: "inicio" | "sentencias" | "commit" = "inicio";
  let aborted = false;
  let onAbort: (() => void) | undefined;
  let rejectOnAbort: ((e: Error) => void) | undefined;
  const abortion = new Promise<never>((_, reject) => { rejectOnAbort = reject; });
  abortion.catch(() => {});
  if (signal) {
    onAbort = () => { aborted = true; discard = true; rejectOnAbort?.(abortError(signal)); };
    if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
  }
  // Si el presupuesto se agota con el cliente aún ocupado, se descarta la conexión (cierra la
  // transacción en el servidor) en lugar de abandonarla viva.
  const hardStop = setTimeout(() => { discard = true; rejectOnAbort?.(new Error("presupuesto_agotado")); },
    Math.max(MIN_STEP_MS, budget.remainingMs()));

  try {
    const statementMs = Math.max(MIN_STEP_MS, Math.floor(budget.remainingMs() - CLEANUP_MS));
    if (aborted) throw abortError(signal!);
    await Promise.race([client.query("BEGIN"), abortion]);
    phase = "sentencias";
    await Promise.race([
      client.query(`SET LOCAL statement_timeout = ${statementMs}; SET LOCAL lock_timeout = ${statementMs}`),
      abortion,
    ]);
    const value = await Promise.race([fn(client), abortion]);
    phase = "commit";
    await Promise.race([client.query("COMMIT"), abortion]);
    return { state: "confirmada", value };
  } catch (error) {
    discard = true;
    const code = (error as { code?: string })?.code;
    if (aborted) return { state: phase === "commit" ? "indeterminada" : "cancelada", reason: "presupuesto" };
    if (phase === "commit") {
      // Un error del servidor durante COMMIT con aborto explícito (p. ej. 57014) deja la transacción
      // revertida; cualquier otra falla (conexión cortada, presupuesto) no permite afirmarlo.
      if (isCancelCode(code) || code === "40001") return { state: "fallida", reason: "commit", code };
      return { state: "indeterminada", reason: isConnectionError(error) ? "conexion" : "commit", code };
    }
    if (isLockCode(code)) return { state: "fallida", reason: "lock", code };
    if (isCancelCode(code)) return { state: "fallida", reason: "sentencia", code };
    if ((error as Error)?.message === "presupuesto_agotado") return { state: "cancelada", reason: "presupuesto" };
    return { state: "fallida", reason: isConnectionError(error) ? "conexion" : "error", code };
  } finally {
    clearTimeout(hardStop);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    // Una conexión con transacción abierta o en estado dudoso se descarta; el servidor la revierte.
    if (!discard) client.release();
    else {
      try { client.release(true); } catch { /* ya liberada */ }
    }
  }
}
