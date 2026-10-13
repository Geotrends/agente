/**
 * Contexto de una solicitud del chat (RF-C3-IN-04/05, RNF-C3-IN-02).
 *
 * Nace al llegar los encabezados, ANTES de leer el cuerpo, autenticar o esperar en cola, y es la
 * única fuente de la fecha de recepción, del plazo y de la duración registrados. El reloj de
 * plazos es monotónico: un ajuste del reloj del sistema no lo adelanta ni lo retrasa.
 *
 * Nunca se serializa ni identifica a una consulta anónima: vive solo en memoria durante la
 * solicitud.
 */
import { setting } from "../services/settings.js";

export type TerminalState = "activa" | "respuesta" | "error" | "desconectada";
export type PersistenceState = "no_iniciada" | "en_curso" | "confirmada" | "fallida" | "cancelada" | "indeterminada";

/** Plazo máximo de la solicitud y objetivo operativo (RF-C3-IN-04). */
export const REQUEST_MAX_MS = 40_000;
export const REQUEST_TARGET_MS = 39_000;

export class RequestDeadlineError extends Error {
  constructor() { super("deadline_exceeded"); this.name = "DeadlineExceededError"; }
}

/** Reloj monotónico en ms (no cambia si se ajusta la hora del sistema). */
export const monotonicNow = (): number => Math.floor(performance.timeOrigin + performance.now());

export type RequestContextOptions = {
  totalMs?: number;
  /** Reloj monotónico inyectable en pruebas. */
  now?: () => number;
  /** Fecha de pared inyectable; por defecto la hora del sistema en el instante de creación. */
  wallClock?: () => Date;
};

export class RequestContext {
  /** Instante UTC en que llegaron los encabezados; es la fecha persistida en éxito. */
  readonly receivedAt: Date;
  readonly startedMonotonicMs: number;
  readonly expiresMonotonicMs: number;
  readonly totalMs: number;
  terminalState: TerminalState = "activa";
  persistenceState: PersistenceState = "no_iniciada";

  private readonly now: () => number;
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: RequestContextOptions = {}) {
    this.now = opts.now ?? monotonicNow;
    this.totalMs = Math.min(opts.totalMs ?? setting("chatDeadlineMs"), REQUEST_MAX_MS);
    this.receivedAt = (opts.wallClock ?? (() => new Date()))();
    this.startedMonotonicMs = this.now();
    this.expiresMonotonicMs = this.startedMonotonicMs + this.totalMs;
    this.timer = setTimeout(() => this.controller.abort(new RequestDeadlineError()), this.totalMs);
    this.timer.unref();
  }

  /** Cancelación para lectura, cola, búsqueda, SDK, base de datos y composición del error. */
  get signal(): AbortSignal { return this.controller.signal; }

  elapsedMs(): number { return Math.max(0, this.now() - this.startedMonotonicMs); }
  remainingMs(): number { return Math.max(0, this.expiresMonotonicMs - this.now()); }
  /** Lo que queda hasta el objetivo operativo de 39 s (1 s de finalización). */
  targetRemainingMs(): number { return Math.max(0, this.remainingMs() - (REQUEST_MAX_MS - REQUEST_TARGET_MS)); }
  get expired(): boolean { return this.remainingMs() === 0; }

  /** Cancela la solicitud (cliente desconectado u otra causa): propaga la señal a todo lo pendiente. */
  abort(reason: unknown): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason);
  }

  /**
   * Registra la única salida de la solicitud. Devuelve true solo la primera vez: quien recibe
   * false no debe escribir otra respuesta.
   */
  finish(state: Exclude<TerminalState, "activa">): boolean {
    if (this.terminalState !== "activa") return false;
    this.terminalState = state;
    return true;
  }

  /** Limpieza que debe ocurrir en todas las salidas (liberar plaza de cola, temporizadores…). */
  onDispose(fn: () => void): void { this.cleanups.push(fn); }

  dispose(): void {
    clearTimeout(this.timer);
    for (const fn of this.cleanups.splice(0)) {
      try { fn(); } catch { /* la limpieza no debe romper la salida */ }
    }
  }
}
