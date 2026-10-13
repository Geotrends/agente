/**
 * Reducer único del panel (T010). Reglas:
 *  - Ocultar el panel no toca este estado; recargar lo destruye.
 *  - Reiniciar incrementa `epoch` y limpia todo dato ciudadano.
 *  - Los pares solo salen de respuestas válidas de C3: fallos, mensajes fijos y tardías no cuentan.
 *  - Anónimo: transcripción volátil visible, sin envío como historial.
 */
import type { Categoria, ContactosPublicos, ParHistorial, RespuestaChat } from "../shared/chatContracts";
import { MAX_PARES_ENVIADOS, type PanelSession, type VisibleMessage } from "./types";
import { MAX_REINTENTOS, newAttempt, type QueryAttempt } from "./queryAttempt";
import { feedbackReducer, type FeedbackAction } from "./feedbackState";

export const initialSession = (epoch = 0): PanelSession => ({
  epoch,
  startup: "apertura",
  decision: "pendiente",
  categoria: undefined,
  transcript: [],
  successfulPairs: [],
  feedbackByResponse: {},
  nextId: 1,
  nextSequence: 1,
});

export type SessionAction =
  | FeedbackAction
  | { type: "configListo"; contacts: ContactosPublicos }
  | { type: "configFallida" }
  | { type: "abrirConsentimiento" }
  | { type: "noAutorizo" }
  | { type: "solicitarConversacion" }
  | { type: "conversacionCreada"; conversationId: string; policyVersion: string }
  | { type: "conversacionFallida" }
  | { type: "elegirCategoria"; categoria: Categoria | null }
  | { type: "abrirEmergencia" }
  | { type: "cerrarEmergencia" }
  | { type: "enviar"; question: string; frozenPayload: Record<string, unknown>; now?: number }
  | { type: "respondida"; sequence: number; respuesta: RespuestaChat }
  | { type: "fallida"; sequence: number; mensaje: string; retryable: boolean; retryAfterSeconds?: number }
  | { type: "reintentar"; sequence: number; now?: number }
  | { type: "reiniciar" };

/** Los últimos diez pares y solo en una conversación autorizada con ID confirmado. */
export function historyToSend(s: PanelSession): ParHistorial[] {
  if (s.decision !== "autorizo" || !s.conversationId) return [];
  return s.successfulPairs.slice(-MAX_PARES_ENVIADOS);
}

/** Habilitado solo en `lista`, con categoría elegida y sin intento en vuelo. */
export function canQuery(s: PanelSession): boolean {
  // La emergencia no consulta al modelo: se vuelve al flujo normal para preguntar.
  if (s.startup !== "lista") return false;
  // Conversación autorizada sin su credencial: no se reasocia contexto; hay que reiniciar.
  if (s.sessionLost) return false;
  if (s.categoria === undefined) return false;
  if (s.decision === "pendiente") return false;
  if (s.decision === "autorizo" && !s.conversationId) return false;
  return s.activeAttempt === undefined || s.activeAttempt.phase !== "enviando";
}

/** Cuerpo de POST /api/chat: nada de modelo/proveedor; anónimo sin ID ni historial. */
export function buildPayload(s: PanelSession, question: string): Record<string, unknown> {
  const historial = historyToSend(s);
  return {
    pregunta: question,
    ...(s.decision === "autorizo" && s.conversationId ? { conversationId: s.conversationId } : {}),
    ...(s.categoria ? { categoria: s.categoria } : {}),
    ...(historial.length ? { historial } : {}),
  };
}

function push(s: PanelSession, m: Omit<VisibleMessage, "id">): PanelSession {
  return { ...s, transcript: [...s.transcript, { ...m, id: s.nextId }], nextId: s.nextId + 1 };
}

export function sessionReducer(s: PanelSession, a: SessionAction): PanelSession {
  switch (a.type) {
    case "valoracionElegir":
    case "valoracionEnviando":
    case "valoracionConfirmada":
    case "valoracionFallida":
      return feedbackReducer(s, a);
    case "configListo":
      // Recuperación: una configuración que llega tras un fallo desbloquea el flujo.
      return { ...s, contacts: a.contacts, startup: s.startup === "apertura" || s.startup === "bloqueada" ? "consentimiento" : s.startup };
    case "configFallida":
      return s.startup === "apertura" ? { ...s, startup: "bloqueada" } : s;
    case "abrirConsentimiento":
      return s.startup === "bloqueada" ? { ...s, startup: "consentimiento" } : s;
    case "noAutorizo":
      if (s.startup !== "consentimiento") return s;
      return { ...s, decision: "no_autorizo", conversationId: undefined, policyVersion: undefined, startup: "categoria" };
    case "solicitarConversacion":
      if (s.startup !== "consentimiento") return s;
      return { ...s, startup: "creandoConversacion" };
    case "conversacionCreada":
      if (s.startup !== "creandoConversacion") return s;
      return { ...s, decision: "autorizo", conversationId: a.conversationId, policyVersion: a.policyVersion, startup: "categoria" };
    case "conversacionFallida":
      return s.startup === "creandoConversacion" ? { ...s, startup: "consentimiento" } : s;
    case "elegirCategoria":
      if (s.startup !== "categoria" && s.startup !== "lista") return s;
      return { ...s, categoria: a.categoria, startup: "lista" };
    case "abrirEmergencia":
      return s.startup === "emergencia" ? s : { ...s, startup: "emergencia" };
    case "cerrarEmergencia":
      if (s.startup !== "emergencia") return s;
      return { ...s, startup: s.decision === "pendiente" ? "consentimiento" : s.categoria === undefined ? "categoria" : "lista" };
    case "enviar": {
      if (!canQuery(s)) return s;
      const attempt: QueryAttempt = newAttempt({
        epoch: s.epoch, sequence: s.nextSequence, question: a.question, frozenPayload: a.frozenPayload, now: a.now ?? 0,
      });
      const withMsg = push(s, { role: "ciudadano", content: a.question, successful: false });
      return { ...withMsg, activeAttempt: attempt, nextSequence: s.nextSequence + 1 };
    }
    case "respondida": {
      const at = s.activeAttempt;
      if (!at || at.sequence !== a.sequence || at.phase !== "enviando") return s; // tardía/obsoleta
      const next = push({ ...s, activeAttempt: undefined }, {
        role: "geobot", content: a.respuesta.respuesta, tipo: a.respuesta.tipo, sources: a.respuesta.fuentes,
        ...(a.respuesta.responseId ? { responseId: a.respuesta.responseId } : {}), successful: true,
      });
      // El par solo se acumula con respuesta válida; el modo anónimo no acumula nada como historial.
      if (s.decision !== "autorizo") return next;
      return { ...next, successfulPairs: [...next.successfulPairs, { pregunta: at.question, respuesta: a.respuesta.respuesta }] };
    }
    case "fallida": {
      const at = s.activeAttempt;
      if (!at || at.sequence !== a.sequence || at.phase !== "enviando") return s;
      // Tras el envío inicial y dos reintentos fallidos, el control desaparece y quedan mensaje y canales.
      const exhausted = at.retryCount >= MAX_REINTENTOS;
      const failed: QueryAttempt = {
        ...at, phase: exhausted ? "agotado" : "fallido",
        failure: { retryable: a.retryable && !exhausted, ...(a.retryAfterSeconds ? { retryAfterSeconds: a.retryAfterSeconds } : {}) },
      };
      return { ...s, activeAttempt: failed, ...(a.mensaje === "sesion" && s.decision === "autorizo" ? { sessionLost: true } : {}) };
    }
    case "reintentar": {
      const at = s.activeAttempt;
      if (!at || at.sequence !== a.sequence || at.phase !== "fallido" || !at.failure?.retryable) return s;
      if (at.retryCount >= MAX_REINTENTOS) return s;
      // Misma pregunta y mismo payload congelado: sin mensaje visible nuevo ni par.
      // Cada reintento tiene su propio plazo de 45 s.
      const now = a.now ?? 0;
      return { ...s, activeAttempt: { ...at, retryCount: (at.retryCount + 1) as 1 | 2, phase: "enviando", failure: undefined, startedAt: now, deadlineAt: now + (at.deadlineAt - at.startedAt) } };
    }
    case "reiniciar":
      return { ...initialSession(s.epoch + 1), contacts: s.contacts, startup: s.contacts ? "consentimiento" : "apertura" };
  }
}
