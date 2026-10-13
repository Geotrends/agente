/**
 * Intento de consulta (RF-C4-UI-07/08, RF-C4-IN-02/03). Un intento activo a la vez, con el payload
 * original congelado: los reintentos manuales lo reutilizan sin recomponer historial, categoría ni ID.
 * El reloj de 45 s vive en el cliente (`sendQuery`) y no se reinicia al ocultar el panel ni al recibir
 * cabeceras; aquí se guardan las marcas y el controlador de cancelación.
 */
import { QUERY_DEADLINE_MS, sendQuery, type QueryOutcome } from "../shared/chatClient";

export type AttemptPhase = "enviando" | "fallido" | "agotado";

export type QueryAttempt = {
  /** Epoch de la sesión que lo creó: un resultado de otro epoch se descarta. */
  epoch: number;
  /** Secuencia local técnica; no sale al servidor. */
  sequence: number;
  question: string;
  frozenPayload: Record<string, unknown>;
  /** 0 = envío inicial; máximo 2 reintentos manuales. */
  retryCount: 0 | 1 | 2;
  phase: AttemptPhase;
  /** Marcas del intento en curso (ms desde epoch Unix; solo UI). */
  startedAt: number;
  deadlineAt: number;
  failure?: { retryable: boolean; retryAfterSeconds?: number };
};

export const MAX_REINTENTOS = 2;

export function newAttempt(args: { epoch: number; sequence: number; question: string; frozenPayload: Record<string, unknown>; now: number }): QueryAttempt {
  return {
    epoch: args.epoch, sequence: args.sequence, question: args.question, frozenPayload: args.frozenPayload,
    retryCount: 0, phase: "enviando", startedAt: args.now, deadlineAt: args.now + QUERY_DEADLINE_MS,
  };
}

export type Handlers = {
  onResult: (sequence: number, outcome: QueryOutcome) => void;
};

/**
 * Ejecuta un intento y garantiza: un solo intento activo, cancelación por reinicio y descarte de
 * resultados tardíos u obsoletos (guardas de epoch y secuencia antes de cada callback).
 */
export class AttemptRunner {
  private controller: AbortController | undefined;
  private activeSequence: number | undefined;
  private currentEpoch: () => number;

  constructor(currentEpoch: () => number) {
    this.currentEpoch = currentEpoch;
  }

  /** Bloqueo síncrono: verdadero mientras hay un intento en vuelo. */
  get busy(): boolean {
    return this.activeSequence !== undefined;
  }

  start(attempt: Pick<QueryAttempt, "epoch" | "sequence" | "frozenPayload">, handlers: Handlers): boolean {
    if (this.busy) return false;
    const ctl = new AbortController();
    this.controller = ctl;
    this.activeSequence = attempt.sequence;
    void sendQuery(attempt.frozenPayload, ctl.signal)
      .then(outcome => {
        if (ctl.signal.aborted) return;
        if (attempt.epoch !== this.currentEpoch() || this.activeSequence !== attempt.sequence) return; // tardío u obsoleto
        handlers.onResult(attempt.sequence, outcome);
      })
      .catch(() => { /* cancelado por reinicio o desmontaje */ })
      .finally(() => {
        if (this.controller === ctl) { this.controller = undefined; this.activeSequence = undefined; }
      });
    return true;
  }

  /** Cancela el intento activo (reinicio/desmontaje). Su resultado nunca llegará a los handlers. */
  abort(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.activeSequence = undefined;
  }
}
