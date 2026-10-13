/**
 * Actividad humana de la sesión del panel (RNF-C3-AD-05).
 *
 * El servidor mide la inactividad por SOLICITUDES: un sondeo periódico mantendría la sesión viva
 * para siempre. Por eso el cliente solo consulta mientras la persona interactúa (≤60 s desde la
 * última interacción) y la pestaña está visible; sin actividad deja de preguntar, la sesión del
 * servidor vence a los 30 min y la interfaz cierra y revoca (mejor esfuerzo) a los 30 min humanos.
 */
export const POLL_IDLE_MS = 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;

const HUMAN_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel", "focusin"] as const;

export type ActivityTracker = {
  /** Registra una interacción humana. */
  touch(): void;
  idleMs(): number;
  /** ¿Se permite un sondeo ahora? Visible, interacción reciente y sin cambio de contraseña pendiente. */
  pollingAllowed(): boolean;
  expired(): boolean;
  dispose(): void;
};

export function createActivityTracker(opts: { now?: () => number; target?: Document } = {}): ActivityTracker {
  const now = opts.now ?? (() => Date.now());
  const doc = opts.target ?? document;
  let last = now();
  const touch = () => { last = now(); };
  for (const ev of HUMAN_EVENTS) doc.addEventListener(ev, touch, { passive: true, capture: true });
  return {
    touch,
    idleMs: () => now() - last,
    pollingAllowed: () => doc.visibilityState !== "hidden" && now() - last < POLL_IDLE_MS,
    expired: () => now() - last >= SESSION_IDLE_MS,
    dispose: () => { for (const ev of HUMAN_EVENTS) doc.removeEventListener(ev, touch, { capture: true } as EventListenerOptions); },
  };
}

/* ---- Rastreador compartido por el cascarón y las pantallas (conteo de referencias) ---- */

let shared: ActivityTracker | null = null;
let holders = 0;

/** Lo toma el cascarón mientras hay una sesión visible; las pantallas leen `currentTracker()`. */
export function acquireTracker(): ActivityTracker {
  if (!shared) shared = createActivityTracker();
  holders++;
  return shared;
}

export function releaseTracker(): void {
  holders = Math.max(0, holders - 1);
  if (holders === 0 && shared) { shared.dispose(); shared = null; }
}

export function currentTracker(): ActivityTracker | null { return shared; }
