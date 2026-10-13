/** T017: historial por pares, decisión de datos y reinicio sobre el reducer único. */
import { describe, expect, it } from "vitest";
import { buildPayload, canQuery, historyToSend, initialSession, sessionReducer } from "../chat/sessionReducer";
import type { SessionAction } from "../chat/sessionReducer";
import type { PanelSession } from "../chat/types";
import type { ContactosPublicos, RespuestaChat, TipoRespuesta } from "../shared/chatContracts";

const CONTACTOS: ContactosPublicos = {
  revision: 1,
  recepcion: { pqrsd: "https://p.gov.co", whatsapp: "300", email: "a@b.co" },
  general: { phone: "1", email: "a@b.co", url: "https://g.co" },
  inmediatos: [],
};
const run = (s: PanelSession, ...as: SessionAction[]) => as.reduce(sessionReducer, s);
const resp = (n: number, tipo: TipoRespuesta = "respondida"): RespuestaChat =>
  ({ modo: "conversación", conversationId: "c", responseId: `r${n}`, tipo, respuesta: `respuesta ${n}`, fuentes: [] });

function autorizada(): PanelSession {
  return run(initialSession(),
    { type: "configListo", contacts: CONTACTOS },
    { type: "solicitarConversacion" },
    { type: "conversacionCreada", conversationId: "uuid-backend", policyVersion: "2026-10" },
    { type: "elegirCategoria", categoria: null });
}
function anonima(): PanelSession {
  return run(initialSession(), { type: "configListo", contacts: CONTACTOS }, { type: "noAutorizo" }, { type: "elegirCategoria", categoria: "Ecosistemas" });
}
function conversar(s: PanelSession, n: number, from = 0): PanelSession {
  for (let i = from; i < from + n; i++) {
    const seq = s.nextSequence;
    s = run(s, { type: "enviar", question: `p${i}`, frozenPayload: buildPayload(s, `p${i}`) }, { type: "respondida", sequence: seq, respuesta: resp(i) });
  }
  return s;
}

describe("flujo de arranque", () => {
  it("sin decisión no hay consulta, y «Autorizo» sin ID confirmado tampoco", () => {
    let s = run(initialSession(), { type: "configListo", contacts: CONTACTOS });
    expect(canQuery(s)).toBe(false);
    s = run(s, { type: "solicitarConversacion" });
    expect(s.startup).toBe("creandoConversacion");
    expect(canQuery(s)).toBe(false);
    // Un fallo vuelve al consentimiento sin degradar en silencio a anónimo.
    s = run(s, { type: "conversacionFallida" });
    expect(s.startup).toBe("consentimiento");
    expect(s.decision).toBe("pendiente");
  });
  it("el ID solo existe tras «Autorizo» y el anónimo nunca lo tiene", () => {
    expect(autorizada().conversationId).toBe("uuid-backend");
    expect(anonima().conversationId).toBeUndefined();
    expect(anonima().decision).toBe("no_autorizo");
  });
  it("la emergencia no habilita la consulta y vuelve al flujo normal", () => {
    let s = run(initialSession(), { type: "configListo", contacts: CONTACTOS }, { type: "abrirEmergencia" });
    expect(s.startup).toBe("emergencia");
    expect(canQuery(s)).toBe(false);
    s = run(s, { type: "cerrarEmergencia" });
    expect(s.startup).toBe("consentimiento");
    expect(s.decision).toBe("pendiente");
  });
});

describe("historial enviado", () => {
  it("12 consultas autorizadas: la duodécima envía exactamente 10 pares cronológicos; la primera ninguno", () => {
    let s = autorizada();
    expect(buildPayload(s, "primera")).not.toHaveProperty("historial");
    s = conversar(s, 11);
    const payload = buildPayload(s, "duodécima") as { historial: Array<{ pregunta: string }>; conversationId: string };
    expect(payload.historial).toHaveLength(10);
    expect(payload.historial[0].pregunta).toBe("p1");
    expect(payload.historial[9].pregunta).toBe("p10");
    expect(payload.conversationId).toBe("uuid-backend");
  });
  it("la anónima nunca envía historial ni ID, aunque la transcripción visible crezca", () => {
    const s = conversar(anonima(), 5);
    expect(s.transcript).toHaveLength(10);
    expect(s.successfulPairs).toHaveLength(0);
    expect(historyToSend(s)).toEqual([]);
    expect(buildPayload(s, "otra")).toEqual({ pregunta: "otra", categoria: "Ecosistemas" });
  });
  it("un fallo no entra al historial y los tipos de éxito (aclaración, sin información) sí forman par", () => {
    let s = autorizada();
    const seq = s.nextSequence;
    s = run(s, { type: "enviar", question: "falla", frozenPayload: {} }, { type: "fallida", sequence: seq, mensaje: "x", retryable: true });
    expect(s.successfulPairs).toHaveLength(0);
    s = run(s, { type: "reintentar", sequence: seq }, { type: "respondida", sequence: seq, respuesta: resp(1, "aclaración") });
    expect(s.successfulPairs).toEqual([{ pregunta: "falla", respuesta: "respuesta 1" }]);
    expect(s.transcript.filter(m => m.role === "ciudadano")).toHaveLength(1); // el reintento no duplica la pregunta
  });
  it("una respuesta tardía de un intento anterior se descarta", () => {
    let s = autorizada();
    const seq = s.nextSequence;
    s = run(s, { type: "enviar", question: "p", frozenPayload: {} }, { type: "respondida", sequence: seq + 99, respuesta: resp(1) });
    expect(s.transcript).toHaveLength(1);
    expect(s.activeAttempt?.phase).toBe("enviando");
  });
  it("un solo intento activo: enviar mientras espera no hace nada", () => {
    let s = autorizada();
    s = run(s, { type: "enviar", question: "a", frozenPayload: {} });
    const again = sessionReducer(s, { type: "enviar", question: "b", frozenPayload: {} });
    expect(again).toBe(s);
  });
});

describe("reinicio", () => {
  it("incrementa el epoch y descarta decisión, categoría, ID, transcripción y pares; conserva contactos", () => {
    const s = conversar(autorizada(), 3);
    const r = sessionReducer(s, { type: "reiniciar" });
    expect(r.epoch).toBe(s.epoch + 1);
    expect(r.decision).toBe("pendiente");
    expect(r.categoria).toBeUndefined();
    expect(r.conversationId).toBeUndefined();
    expect(r.transcript).toEqual([]);
    expect(r.successfulPairs).toEqual([]);
    expect(r.contacts).toEqual(CONTACTOS);
    expect(r.startup).toBe("consentimiento");
  });
});

describe("reintentos manuales", () => {
  it("un inicial + dos reintentos; el tercero fallo deja «agotado» sin control", () => {
    let s = autorizada();
    const seq = s.nextSequence;
    s = run(s, { type: "enviar", question: "p", frozenPayload: { pregunta: "p" } });
    for (let i = 0; i < 2; i++) {
      s = run(s, { type: "fallida", sequence: seq, mensaje: "x", retryable: true }, { type: "reintentar", sequence: seq });
      expect(s.activeAttempt?.retryCount).toBe(i + 1);
      expect(s.activeAttempt?.frozenPayload).toEqual({ pregunta: "p" });
    }
    s = run(s, { type: "fallida", sequence: seq, mensaje: "x", retryable: true });
    expect(s.activeAttempt?.phase).toBe("agotado");
    expect(s.activeAttempt?.failure?.retryable).toBe(false);
    expect(sessionReducer(s, { type: "reintentar", sequence: seq })).toBe(s);
  });
  it("VALIDACION no admite reintento", () => {
    let s = autorizada();
    const seq = s.nextSequence;
    s = run(s, { type: "enviar", question: "p", frozenPayload: {} }, { type: "fallida", sequence: seq, mensaje: "v", retryable: false });
    expect(sessionReducer(s, { type: "reintentar", sequence: seq })).toBe(s);
  });
});
