/**
 * Entidades del panel (data-model.md). Todo vive SOLO en la memoria del iframe: ni el token, ni la
 * conversación, ni el epoch se envían al servidor ni se escriben en almacenamiento del navegador.
 */
import type { Categoria, ContactosPublicos, FuenteCitada, ParHistorial, TipoRespuesta } from "../shared/chatContracts";

/** Etapas del arranque (SPEC003): apertura → consentimiento → categoría → lista; emergencia en paralelo. */
export type Startup =
  | "apertura"
  | "consentimiento"
  | "creandoConversacion"
  | "categoria"
  | "lista"
  | "emergencia"
  | "bloqueada";

/** «Token técnico no la sustituye»: la decisión solo cambia por una elección explícita. */
export type ConsentDecision = "pendiente" | "autorizo" | "no_autorizo";

/**
 * Mensaje de la transcripción. Las consultas del ciudadano son texto plano; los mensajes fijos y los
 * fallos no tienen `responseId` ni forman pares (`successful: false`).
 */
export type VisibleMessage = {
  /** Identificador local técnico; no sale al servidor. */
  id: number;
  role: "ciudadano" | "geobot" | "sistema";
  content: string;
  tipo?: TipoRespuesta;
  sources?: FuenteCitada[];
  responseId?: string;
  successful: boolean;
};

/** Solo respuestas válidas actuales de C3, en orden cronológico; todos los tipos de éxito admiten par. */
export type SuccessfulPair = ParHistorial;

export const MAX_PARES_ENVIADOS = 10;

import type { QueryAttempt } from "./queryAttempt";
export type { QueryAttempt, AttemptPhase } from "./queryAttempt";

export type FeedbackPhase = "idle" | "choosing" | "sending" | "confirmed" | "failed";
export type FeedbackState = {
  responseId: string;
  selected?: "Útil" | "No útil";
  reason?: string;
  phase: FeedbackPhase;
};

export type PanelSession = {
  /** Entero local que invalida resultados antiguos tras reiniciar; no identifica al ciudadano. */
  epoch: number;
  startup: Startup;
  decision: ConsentDecision;
  /** `null` = «No estoy seguro» (no se envía categoría); `undefined` = aún sin elegir. */
  categoria: Categoria | null | undefined;
  conversationId?: string;
  policyVersion?: string;
  transcript: VisibleMessage[];
  successfulPairs: SuccessfulPair[];
  contacts?: ContactosPublicos;
  activeAttempt?: QueryAttempt;
  /** La credencial técnica de una conversación autorizada expiró o se perdió: solo cabe reiniciar. */
  sessionLost?: boolean;
  feedbackByResponse: Record<string, FeedbackState>;
  /** Contador de ids locales de mensajes y de secuencia de intentos. */
  nextId: number;
  nextSequence: number;
};
