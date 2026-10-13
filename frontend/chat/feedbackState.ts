/**
 * Estado de valoración por respuesta (FeedbackState). Reglas:
 *  - elegible solo con decisión «Autorizo» y un responseId auténtico de una respuesta exitosa;
 *  - `confirmed` solo tras un 201 (commit); `failed` conserva la respuesta y la selección;
 *  - sin selección múltiple ni texto libre; una valoración por respuesta.
 */
import type { Motivo, Valoracion } from "../shared/feedbackContracts";
import type { FeedbackState, PanelSession, VisibleMessage } from "./types";

export type FeedbackAction =
  | { type: "valoracionElegir"; responseId: string }
  | { type: "valoracionEnviando"; responseId: string; selected: Valoracion; reason?: Motivo }
  | { type: "valoracionConfirmada"; responseId: string }
  | { type: "valoracionFallida"; responseId: string };

/** Controles visibles solo para respuestas con ID auténtico de una conversación autorizada. */
export function isRatable(s: PanelSession, m: VisibleMessage): boolean {
  return s.decision === "autorizo" && !!s.conversationId && m.role === "geobot" && m.successful && !!m.responseId;
}

export function feedbackReducer(s: PanelSession, a: FeedbackAction): PanelSession {
  const msg = s.transcript.find(m => m.responseId === a.responseId);
  if (!msg || !isRatable(s, msg)) return s;
  const cur: FeedbackState = s.feedbackByResponse[a.responseId] ?? { responseId: a.responseId, phase: "idle" };
  const set = (f: FeedbackState): PanelSession => ({ ...s, feedbackByResponse: { ...s.feedbackByResponse, [a.responseId]: f } });
  switch (a.type) {
    case "valoracionElegir":
      // Solo desde idle: una valoración enviada o confirmada no se puede cambiar.
      return cur.phase === "idle" ? set({ ...cur, phase: "choosing", selected: "No útil" }) : s;
    case "valoracionEnviando":
      if (cur.phase === "sending" || cur.phase === "confirmed") return s;
      // Tras un fallo solo se puede reintentar la MISMA selección (evita evadir la unicidad).
      if (cur.phase === "failed" && (cur.selected !== a.selected || cur.reason !== a.reason)) return s;
      return set({ ...cur, phase: "sending", selected: a.selected, ...(a.reason ? { reason: a.reason } : {}) });
    case "valoracionConfirmada":
      return cur.phase === "sending" ? set({ ...cur, phase: "confirmed" }) : s;
    case "valoracionFallida":
      return cur.phase === "sending" ? set({ ...cur, phase: "failed" }) : s;
  }
}
