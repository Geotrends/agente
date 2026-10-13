/**
 * T021 — La credencial técnica de una conversación autorizada no se renueva en silencio
 * (RF-C4-IN-01/02): al expirar o perderse no se reasocia el contexto previo ni se repite.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindSessionToConversation, clearSessionToken, fetchWithSession, getSessionToken, hasSessionToken } from "../shared/session";
import { SessionError } from "../shared/chatErrors";
import { sessionReducer, initialSession, canQuery } from "../chat/sessionReducer";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const CHAT = "/api/chat";

afterEach(() => { clearSessionToken(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("sesión técnica y conversación autorizada", () => {
  it("anónima: un token vencido se renueva sin intervención", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => json({ token: `t${Math.random()}`, expiresIn: 120 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await getSessionToken(CHAT);
    vi.advanceTimersByTime(3_600_000);
    const b = await getSessionToken(CHAT);
    expect(b).not.toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("autorizada: al vencer el token no se pide otro y se informa pérdida de sesión", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => json({ token: "t1", expiresIn: 120 }));
    vi.stubGlobal("fetch", fetchMock);
    await getSessionToken(CHAT);
    bindSessionToConversation();
    vi.advanceTimersByTime(3_600_000);
    await expect(getSessionToken(CHAT)).rejects.toBeInstanceOf(SessionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hasSessionToken()).toBe(false);
  });

  it("un 401 de la API descarta el token y no reenvía la solicitud", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return String(url).endsWith("/session") ? json({ token: "t1", expiresIn: 3600 }) : json({ error: {} }, 401);
    }));
    const r = await fetchWithSession(CHAT, "/api/chat", { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
    expect(calls.filter(u => u.endsWith("/api/chat"))).toHaveLength(1);
    expect(hasSessionToken()).toBe(false);
  });
});

describe("reducer: conversación autorizada sin credencial", () => {
  it("un fallo de sesión bloquea nuevas consultas; el reinicio las habilita", () => {
    let s = initialSession();
    s = sessionReducer(s, { type: "configListo", contacts: { revision: 1, recepcion: { pqrsd: "https://a.gov.co", whatsapp: "1", email: "a@b.co" }, general: { phone: "1", email: "a@b.co", url: "https://a.gov.co" }, inmediatos: [] } });
    s = sessionReducer(s, { type: "solicitarConversacion" });
    s = sessionReducer(s, { type: "conversacionCreada", conversationId: "00000000-0000-4000-8000-000000000001", policyVersion: "1" });
    s = sessionReducer(s, { type: "elegirCategoria", categoria: null });
    expect(canQuery(s)).toBe(true);
    s = sessionReducer(s, { type: "enviar", question: "hola", frozenPayload: {}, now: 0 });
    s = sessionReducer(s, { type: "fallida", sequence: 1, mensaje: "sesion", retryable: false });
    expect(s.sessionLost).toBe(true);
    expect(canQuery(s)).toBe(false);
    const nuevo = sessionReducer(s, { type: "reiniciar" });
    expect(nuevo.sessionLost).toBeUndefined();
    expect(nuevo.conversationId).toBeUndefined();
  });

  it("anónimo: el fallo de sesión no bloquea (no hay conversación que perder)", () => {
    let s = initialSession();
    s = sessionReducer(s, { type: "configListo", contacts: { revision: 1, recepcion: { pqrsd: "https://a.gov.co", whatsapp: "1", email: "a@b.co" }, general: { phone: "1", email: "a@b.co", url: "https://a.gov.co" }, inmediatos: [] } });
    s = sessionReducer(s, { type: "noAutorizo" });
    s = sessionReducer(s, { type: "elegirCategoria", categoria: null });
    s = sessionReducer(s, { type: "enviar", question: "hola", frozenPayload: {}, now: 0 });
    s = sessionReducer(s, { type: "fallida", sequence: 1, mensaje: "sesion", retryable: false });
    expect(s.sessionLost).toBeUndefined();
    expect(canQuery(s)).toBe(true);
  });
});
