/**
 * Enrutamiento local de modelos (RF-C3-DI-02/03, RF-C3-IN-04).
 *
 * El puntaje sale de reglas deterministas, sin llamar a ningún LLM. Con 10 o más PARES de
 * historial el nivel sube a al menos «complejo» con un puntaje finito. 20b atiende simple y
 * medio; 120b atiende complejo; el otro es el respaldo. Una tentativa a cada uno dentro del
 * plazo único, con circuitos por modelo.
 */
import { scoreQuestionComplexity, type QuestionComplexity } from "../services/contextBudget.js";
import { admit, record } from "../services/circuitBreaker.js";
import { providerFailure, type ProviderResult } from "../shared/llmTypes.js";
import { setting } from "../services/settings.js";
import { ModelError } from "../bedrock/askBedrock.js";
import type { ModelAdapter, ModelCallResult, ModelRequest, ParHistorial } from "./contracts.js";
import { isDeadlineError, type Deadline } from "./deadline.js";

export type Classification = { score: number; level: QuestionComplexity };

const COMPLEX_THRESHOLD = 6;
const MEDIUM_THRESHOLD = 3;
const levelOf = (s: number): QuestionComplexity => (s >= COMPLEX_THRESHOLD ? "complex" : s >= MEDIUM_THRESHOLD ? "medium" : "simple");

export function classify(pregunta: string, historial: ParHistorial[]): Classification {
  const pares = historial.length;
  // El puntuador heredado devuelve Infinity con ≥10 elementos; aquí se acota y se fuerza ≥6 (finito).
  const base = scoreQuestionComplexity(pregunta, Math.min(pares, 9)).score;
  const score = pares >= 10 ? Math.max(base, COMPLEX_THRESHOLD) : base;
  return { score, level: levelOf(score) };
}

export function modelsFor(level: QuestionComplexity): { primary: string; fallback: string } {
  const small = setting("bedrockModelSmall");
  const large = setting("bedrockModelLarge");
  return level === "complex" ? { primary: large, fallback: small } : { primary: small, fallback: large };
}

export class ModelsUnavailableError extends Error {
  constructor() { super("modelos_no_disponibles"); this.name = "ModelsUnavailableError"; }
}

export type ModelEvent = { modelId: string; ok: boolean; kind?: string; at: number };
type Listener = (e: ModelEvent) => void;
const listeners: Listener[] = [];
/** Suscripción del estado operativo (T066): cada intento real emite un evento sin texto. */
export function onModelEvent(l: Listener): () => void {
  listeners.push(l);
  return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
}
const emit = (e: ModelEvent): void => { for (const l of listeners) { try { l(e); } catch { /* un oyente roto no frena la consulta */ } } };

const asResult = (e: ModelError): ProviderResult => {
  const kind = e.kind === "network" ? "network" : e.kind === "throttle" ? "quota" : e.kind === "timeout" ? "timeout" : e.kind === "auth" ? "auth" : e.kind === "config" ? "model" : "unknown";
  return providerFailure(kind, "fallo del modelo", e.diagnosticCode, e.retryable);
};

/**
 * Cede ante la cancelación aunque el adaptador la ignore: el plazo de la solicitud se cumple por
 * esta carrera y no depende de que el SDK atienda `AbortSignal`. Un modelo cancelado no tiene
 * estado local que limpiar; su resultado tardío se descarta sin rechazos sin manejar.
 */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => {});
  if (signal.aborted) return Promise.reject(new ModelError("timeout", false, "abort"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ModelError("timeout", false, "abort"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      v => { signal.removeEventListener("abort", onAbort); resolve(v); },
      e => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

export type RoutedCall = { result: ModelCallResult; classification: Classification; attempts: string[] };

/**
 * Una tentativa al principal y otra al respaldo. Los errores de validación local no deberían
 * llegar aquí (el adaptador los lanza antes de enviar) y no se reintentan en el otro modelo.
 */
export async function callWithRouting(
  adapter: ModelAdapter, req: Omit<ModelRequest, "deadline" | "signal">, deadline: Deadline, now: () => number = Date.now,
): Promise<RoutedCall> {
  const classification = classify(req.pregunta, req.historial);
  const { primary, fallback } = modelsFor(classification.level);
  const attempts: string[] = [];

  for (const [i, modelId] of [primary, fallback].entries()) {
    const admission = admit(modelId, now());
    if (admission === "open") continue;
    const budget = i === 0 ? deadline.attemptBudgets().primaryMs : deadline.modelBudgetMs();
    if (budget <= 0) break;
    attempts.push(modelId);
    const signal = AbortSignal.any([AbortSignal.timeout(budget), deadline.signal]);
    try {
      const result = await abortable(adapter.call(modelId, { ...req, deadline: deadline.expiresAt, signal }), signal);
      record(modelId, { ok: true, answer: "" }, now());
      emit({ modelId, ok: true, at: now() });
      return { result, classification, attempts };
    } catch (error) {
      if (isDeadlineError(error) && deadline.expired) throw new ModelsUnavailableError();
      if (error instanceof ModelError) {
        record(modelId, asResult(error), now());
        emit({ modelId, ok: false, kind: error.kind, at: now() });
        // Configuración o respuesta inválida no mejora con el otro modelo: se corta aquí.
        if (error.kind === "config" && error.diagnosticCode === "modelo_no_permitido") throw error;
        continue;
      }
      throw error;
    }
  }
  throw new ModelsUnavailableError();
}
