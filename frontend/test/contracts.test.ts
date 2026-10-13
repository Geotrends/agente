/** T008 (lado cliente): contrato español, validación de forma y token solo en memoria. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfigChat, parseRespuestaChat } from "../shared/chatContracts";
import { sendQuery, createConversation, fetchConfig } from "../shared/chatClient";
import { clearSessionToken, hasSessionToken } from "../shared/session";
import { buildPayload, initialSession, sessionReducer } from "../chat/sessionReducer";

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const CONFIG = {
  apertura: "Soy Geobot, asistente automatizado.",
  politica: { version: "2026-10", url: "https://ejemplo.gov.co/politica" },
  opciones: [{ valor: "autorizo", etiqueta: "Autorizo" }, { valor: "no_autorizo", etiqueta: "No autorizo" }],
  contactos: {
    revision: 1,
    recepcion: { pqrsd: "https://pqrsd.gov.co", whatsapp: "+57 300 000 1111", email: "p@gov.co" },
    general: { phone: "604 000", email: "i@gov.co", url: "https://gov.co/c" },
    inmediatos: [{ id: "i1", name: "Emergencias", description: "24 h", type: "teléfono" as const, value: "123", position: 1 }],
  },
};
const RESPUESTA = { modo: "conversación", conversationId: "c-1", responseId: "r-1", tipo: "respondida", respuesta: "Hola", fuentes: [] };

let calls: Array<{ url: string; init?: RequestInit }>;
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/session")) return jsonRes({ token: "tok-tecnico", expiresIn: 3600 });
    return handler(String(url), init);
  }));
}

beforeEach(() => { clearSessionToken(); window.sessionStorage.clear(); window.localStorage?.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("validación de forma", () => {
  it("config íntegra se acepta y cualquier faltante la invalida", () => {
    expect(parseConfigChat(CONFIG)).toBeDefined();
    expect(parseConfigChat({ ...CONFIG, apertura: "" })).toBeUndefined();
    expect(parseConfigChat({ ...CONFIG, politica: { version: "1", url: "http://x" } })).toBeUndefined();
    expect(parseConfigChat({ ...CONFIG, contactos: undefined })).toBeUndefined();
    expect(parseConfigChat({ ...CONFIG, opciones: [] })).toBeUndefined();
  });
  it("respuesta válida pasa; incompleta, de tipo ajeno o anónima con IDs no", () => {
    expect(parseRespuestaChat(RESPUESTA)?.responseId).toBe("r-1");
    expect(parseRespuestaChat({ ...RESPUESTA, respuesta: undefined })).toBeUndefined();
    expect(parseRespuestaChat({ ...RESPUESTA, tipo: "otra" })).toBeUndefined();
    expect(parseRespuestaChat({ ...RESPUESTA, modo: "anónima" })).toBeUndefined();
    expect(parseRespuestaChat({ ...RESPUESTA, fuentes: "x" })).toBeUndefined();
  });
  it("fuentes con http o javascript se descartan sin tocar el resto", () => {
    const r = parseRespuestaChat({
      ...RESPUESTA,
      fuentes: [
        { id: "a", nombre: "A", enlace: "https://a.gov.co", fecha: "2026-01-01" },
        { id: "b", nombre: "B", enlace: "http://b.gov.co", fecha: "2026-01-01" },
        { id: "c", nombre: "C", enlace: "javascript:alert(1)", fecha: "2026-01-01" },
      ],
    });
    expect(r?.fuentes.map(f => f.id)).toEqual(["a"]);
  });
});

describe("consulta: payload, plazo y errores", () => {
  it("el payload anónimo no lleva conversationId ni historial; ninguno lleva proveedor/modelo", () => {
    let s = initialSession();
    s = sessionReducer(s, { type: "configListo", contacts: CONFIG.contactos });
    s = sessionReducer(s, { type: "noAutorizo" });
    s = sessionReducer(s, { type: "elegirCategoria", categoria: "Ecosistemas" });
    const p = buildPayload(s, "¿Cómo?");
    expect(p).toEqual({ pregunta: "¿Cómo?", categoria: "Ecosistemas" });
    for (const k of ["provider", "model", "autoRoute", "message", "history", "autorizo"]) expect(p).not.toHaveProperty(k);
  });

  it("pregunta larga (>2500) no se trunca ni se rechaza en el cliente", async () => {
    mockFetch(() => jsonRes(RESPUESTA));
    const pregunta = "a".repeat(5000);
    const r = await sendQuery({ pregunta, conversationId: "c-1" });
    expect(r.kind).toBe("ok");
    const sent = JSON.parse(String(calls.find(c => c.url.endsWith("/chat"))?.init?.body));
    expect(sent.pregunta).toHaveLength(5000);
  });

  it("200 incoherente con la solicitud (modo o conversationId distintos) no es éxito", async () => {
    mockFetch(() => jsonRes({ ...RESPUESTA, conversationId: "otra-conversacion" }));
    expect(await sendQuery({ pregunta: "x", conversationId: "c-1" })).toMatchObject({ kind: "fallo", causa: "no_interpretable" });
    mockFetch(() => jsonRes(RESPUESTA));
    expect(await sendQuery({ pregunta: "x" })).toMatchObject({ kind: "fallo", causa: "no_interpretable" }); // anónima recibe conversación
    mockFetch(() => jsonRes({ modo: "anónima", tipo: "respondida", respuesta: "Hola", fuentes: [] }));
    expect(await sendQuery({ pregunta: "x", conversationId: "c-1" })).toMatchObject({ kind: "fallo", causa: "no_interpretable" }); // conversación recibe anónima
    mockFetch(() => jsonRes({ modo: "anónima", tipo: "sin información", respuesta: "No hay información", fuentes: [{ id: "a", nombre: "A", enlace: "https://a.gov.co", fecha: "2026-01-01" }] }));
    expect(await sendQuery({ pregunta: "x" })).toMatchObject({ kind: "fallo", causa: "no_interpretable" }); // fuentes en no respondida
  });

  it("200 incompleto, HTML 502 y JSON roto no son éxito y quedan como recuperables", async () => {
    mockFetch(() => jsonRes({ modo: "conversación" }));
    expect(await sendQuery({ pregunta: "x" })).toMatchObject({ kind: "fallo", causa: "no_interpretable", retryable: true });
    mockFetch(() => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    expect(await sendQuery({ pregunta: "x" })).toMatchObject({ kind: "fallo", causa: "no_interpretable", retryable: true });
  });

  it("VALIDACION no es recuperable; ERROR_INTERNO sí", async () => {
    mockFetch(() => jsonRes({ error: { codigo: "VALIDACION", mensaje: "x" } }, 400));
    expect(await sendQuery({ pregunta: "x" })).toMatchObject({ causa: "validacion", retryable: false });
    mockFetch(() => jsonRes({ error: { codigo: "ERROR_INTERNO", mensaje: "x" } }, 500));
    expect(await sendQuery({ pregunta: "x" })).toMatchObject({ causa: "interno", retryable: true });
  });

  it("429 respeta Retry-After", async () => {
    mockFetch(() => jsonRes({ error: { codigo: "SERVICIO_NO_DISPONIBLE", mensaje: "x" } }, 429, { "Retry-After": "12" }));
    expect(await sendQuery({ pregunta: "x" })).toMatchObject({ causa: "limite", retryAfterSeconds: 12 });
  });

  it("401 no reenvía la generación ni reutiliza el portador", async () => {
    mockFetch(() => jsonRes({ error: { codigo: "VALIDACION" } }, 401));
    const r = await sendQuery({ pregunta: "x", conversationId: "c-1" });
    expect(r).toMatchObject({ kind: "fallo", causa: "sesion", retryable: false });
    expect(calls.filter(c => c.url.endsWith("/chat"))).toHaveLength(1);
    expect(hasSessionToken()).toBe(false);
  });

  it("plazo de 45 s: aborta y marca plazo", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/session")) return Promise.resolve(jsonRes({ token: "t", expiresIn: 3600 }));
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))));
    }));
    const p = sendQuery({ pregunta: "x" });
    await vi.advanceTimersByTimeAsync(44_999);
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ kind: "fallo", causa: "plazo", retryable: true });
  });
});

describe("autorización e identificador", () => {
  it("createConversation envía solo autorizacion y policyVersion, y devuelve el UUID del backend", async () => {
    mockFetch(() => jsonRes({ modo: "conversación", conversationId: "uuid-backend" }, 201));
    const r = await createConversation("2026-10");
    expect(r).toEqual({ kind: "ok", conversationId: "uuid-backend" });
    const body = JSON.parse(String(calls.find(c => c.url.endsWith("/conversations"))?.init?.body));
    expect(body).toEqual({ autorizacion: true, policyVersion: "2026-10" });
  });
  it("versión de política inválida (400) → causa politica", async () => {
    mockFetch(() => jsonRes({ error: { codigo: "VALIDACION", campo: "policyVersion" } }, 400));
    expect(await createConversation("vieja")).toEqual({ kind: "fallo", causa: "politica" });
  });
  it("el token técnico y la conversación NO se escriben en el almacenamiento del navegador", async () => {
    mockFetch(url => url.endsWith("/conversations") ? jsonRes({ modo: "conversación", conversationId: "uuid-backend" }, 201) : jsonRes(RESPUESTA));
    await createConversation("2026-10");
    await sendQuery({ pregunta: "hola", conversationId: "uuid-backend" });
    expect(hasSessionToken()).toBe(true);
    const guardado = JSON.stringify({ ...window.sessionStorage, ...(window.localStorage ?? {}) }) + document.cookie;
    expect(guardado).not.toContain("tok-tecnico");
    expect(guardado).not.toContain("uuid-backend");
    expect(guardado).not.toContain("hola");
    expect(window.location.href).not.toContain("uuid-backend");
  });
  it("fetchConfig no pide token y devuelve fallo ante cuerpo incompleto", async () => {
    mockFetch(() => jsonRes({ apertura: "x" }));
    expect(await fetchConfig()).toEqual({ kind: "fallo" });
    expect(calls.some(c => c.url.endsWith("/session"))).toBe(false);
    mockFetch(() => jsonRes(CONFIG));
    expect((await fetchConfig()).kind).toBe("ok");
  });
});
