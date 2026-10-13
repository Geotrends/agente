/**
 * Plazo único y cancelable de una consulta (RF-C3-IN-04, RF-C3-DI-03).
 *
 * Nace al recibir la solicitud (ver `RequestContext`) y cubre lectura, cola, recuperación,
 * modelos y escritura. Presupuesto inicial: recuperación hasta 5 s, finalización 2 s reservados,
 * el resto para los modelos; objetivo operativo 39 s para dejar margen de transporte. Ninguna
 * etapa puede esperar más allá del plazo. El reloj es monotónico.
 */
import { setting } from "../services/settings.js";
import { monotonicNow, RequestContext, RequestDeadlineError } from "./requestContext.js";

export const RETRIEVAL_BUDGET_MS = 5_000;
export const FINALIZATION_RESERVE_MS = 2_000;
export const OPERATIONAL_MARGIN_MS = 1_000;

export const DeadlineExceededError = RequestDeadlineError;
export type DeadlineExceededError = RequestDeadlineError;

export class Deadline {
  readonly context: RequestContext;
  private readonly ownsContext: boolean;

  /**
   * `totalMs` y `now` se conservan para las pruebas existentes. En producción se usa
   * `Deadline.forContext(ctx)`, de modo que el plazo parte de la recepción de la solicitud.
   */
  constructor(totalMs: number = setting("chatDeadlineMs"), now: () => number = monotonicNow, context?: RequestContext) {
    this.ownsContext = !context;
    this.context = context ?? new RequestContext({ totalMs, now });
  }

  static forContext(context: RequestContext): Deadline {
    return new Deadline(context.totalMs, monotonicNow, context);
  }

  get startedAt(): number { return this.context.startedMonotonicMs; }
  get totalMs(): number { return this.context.totalMs; }
  get signal(): AbortSignal { return this.context.signal; }
  get expiresAt(): number { return this.context.expiresMonotonicMs; }
  /** Fecha UTC de recepción: la que se persiste en un registro exitoso. */
  get receivedAt(): Date { return this.context.receivedAt; }

  elapsedMs(): number { return this.context.elapsedMs(); }
  remainingMs(): number { return this.context.remainingMs(); }
  get expired(): boolean { return this.remainingMs() === 0; }

  /** Objetivo operativo: terminar antes de totalMs − 1 s. */
  targetRemainingMs(): number { return this.context.targetRemainingMs(); }

  /** Lo que se concede a la recuperación: su tope o lo que quede menos la finalización. */
  retrievalBudgetMs(): number {
    return Math.min(RETRIEVAL_BUDGET_MS, Math.max(0, this.remainingMs() - FINALIZATION_RESERVE_MS));
  }

  /** Presupuesto para los modelos: todo lo que queda salvo la reserva de finalización. */
  modelBudgetMs(): number { return Math.max(0, this.targetRemainingMs() - FINALIZATION_RESERVE_MS); }

  /** Reparte el presupuesto de modelos: el principal recibe la mitad para que el respaldo tenga su parte. */
  attemptBudgets(): { primaryMs: number; fallbackMs: number } {
    const total = this.modelBudgetMs();
    const primaryMs = Math.floor(total / 2);
    return { primaryMs, fallbackMs: total - primaryMs };
  }

  throwIfExpired(): void { if (this.expired) throw new RequestDeadlineError(); }

  /** Libera el temporizador cuando la consulta termina (solo si este plazo creó su contexto). */
  dispose(): void { if (this.ownsContext) this.context.dispose(); }
}

export const isDeadlineError = (e: unknown): boolean =>
  e instanceof RequestDeadlineError || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"));
