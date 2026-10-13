/** T017: recorridos del arranque con el panel real (jsdom): ID solo tras Autorizo, nada en storage. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChatPanel from "../chat/ChatPanel";
import { clearSessionToken } from "../shared/session";

const UUID = "11111111-1111-4111-8111-111111111111";
const CONFIG = {
  apertura: "Soy Geobot, asistente automatizado.",
  politica: { version: "2026-10", url: "https://ejemplo.gov.co/politica" },
  opciones: [{ valor: "autorizo", etiqueta: "Autorizo" }, { valor: "no_autorizo", etiqueta: "No autorizo" }],
  contactos: {
    revision: 1,
    recepcion: { pqrsd: "https://pqrsd.gov.co", whatsapp: "+57 300 111 2233", email: "p@gov.co" },
    general: { phone: "1", email: "i@gov.co", url: "https://gov.co/c" },
    inmediatos: [{ id: "a", name: "Emergencias", description: "24 h", type: "teléfono" as const, value: "123", position: 1 }],
  },
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

let calls: Array<{ url: string; body: Record<string, unknown> | null; auth: string | null }>;
let chatHandler: (n: number, body: Record<string, unknown> | null) => Response;
let conversationStatus = 201;

beforeEach(() => {
  calls = []; conversationStatus = 201; clearSessionToken();
  window.sessionStorage.clear();
  let n = 0;
  // Coherente con la solicitud: con conversationId → modo conversación; sin él → anónima.
  chatHandler = (i, body) => json(body?.conversationId
    ? { modo: "conversación", conversationId: UUID, responseId: `r${i}`, tipo: "respondida", respuesta: `Respuesta ${i}`, fuentes: [] }
    : { modo: "anónima", tipo: "respondida", respuesta: `Respuesta ${i}`, fuentes: [] });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
    if (url.endsWith("/chat/config")) return json(CONFIG);
    if (url.endsWith("/session")) return json({ token: "tok-tecnico", expiresIn: 3600 });
    if (url.endsWith("/conversations")) return conversationStatus === 201 ? json({ modo: "conversación", conversationId: UUID }, 201) : json({ error: { codigo: "VALIDACION" } }, conversationStatus);
    if (url.endsWith("/chat")) return chatHandler(++n, init?.body ? JSON.parse(String(init.body)) : null);
    return new Response("no", { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = async () => { render(<ChatPanel />); await screen.findByText(/Soy Geobot/); };
const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };
const input = () => screen.getByLabelText("Pregunta") as HTMLInputElement;
const ask = async (q: string) => {
  await act(async () => { fireEvent.change(input(), { target: { value: q } }); });
  await act(async () => { fireEvent.submit(input().closest("form")!); });
};

describe("arranque y consentimiento", () => {
  it("la apertura y la política aparecen y no se llama a sesión/conversación/chat antes de decidir", async () => {
    await mount();
    expect(calls.map(c => c.url.replace(/^.*\/api/, ""))).toEqual(["/chat/config"]);
    expect(input().disabled).toBe(true);
  });

  it("«Autorizo» crea la conversación con la versión de política y habilita tras elegir categoría", async () => {
    await mount();
    await click("Autorizo");
    await screen.findByRole("button", { name: "Ecosistemas" });
    const conv = calls.find(c => c.url.endsWith("/conversations"))!;
    expect(conv.body).toEqual({ autorizacion: true, policyVersion: "2026-10" });
    expect(conv.auth).toBe("Bearer tok-tecnico");
    expect(input().disabled).toBe(true); // falta la categoría
    await click("No estoy seguro");
    expect(input().disabled).toBe(false);
  });

  it("«No autorizo» no pide sesión ni conversación y deja ver la transcripción sin enviarla como contexto", async () => {
    await mount();
    await click("No autorizo");
    await click("Gestión Ambiental");
    await ask("¿Qué requisitos tiene?");
    await screen.findByText("Respuesta 1");
    await ask("¿Y el plazo?");
    await screen.findByText("Respuesta 2");
    expect(calls.some(c => c.url.endsWith("/conversations"))).toBe(false);
    const chats = calls.filter(c => c.url.endsWith("/chat"));
    expect(chats.map(c => Object.keys(c.body!).sort())).toEqual([["categoria", "pregunta"], ["categoria", "pregunta"]]);
    // La transcripción visible conserva ambas preguntas (solo memoria).
    expect(screen.getByRole("log").textContent).toContain("¿Qué requisitos tiene?");
    expect(screen.getByRole("log").textContent).toContain("¿Y el plazo?");
  });

  it("versión de política inválida: no se crea conversación ni se habilita la consulta", async () => {
    conversationStatus = 400;
    await mount();
    await click("Autorizo");
    await screen.findByText(/política de datos cambió/);
    expect(screen.queryByRole("button", { name: "Ecosistemas" })).toBeNull();
    expect(input().disabled).toBe(true);
  });
});

describe("token, ID y almacenamiento", () => {
  it("ni el token ni el UUID ni las preguntas se escriben en storage, cookies o URL", async () => {
    await mount();
    await click("Autorizo");
    await click("Ecosistemas");
    await ask("pregunta secreta del ciudadano");
    await screen.findByText("Respuesta 1");
    const dump = JSON.stringify({ ...window.sessionStorage, ...(window.localStorage ?? {}) }) + document.cookie + window.location.href;
    for (const secreto of ["tok-tecnico", UUID, "pregunta secreta"]) expect(dump).not.toContain(secreto);
  });

  it("401 en la consulta: no se reenvía ni se reutiliza el ID con otro portador", async () => {
    await mount();
    await click("Autorizo");
    await click("Ecosistemas");
    chatHandler = () => json({ error: { codigo: "VALIDACION" } }, 401);
    await ask("hola");
    await screen.findByText(/En este momento no puedo responder/);
    expect(calls.filter(c => c.url.endsWith("/chat"))).toHaveLength(1);
    expect(calls.filter(c => c.url.endsWith("/session"))).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Reintentar/ })).toBeNull();
  });

  it("recargar (desmontar y montar) vuelve a pedir la decisión y un ID distinto solo tras autorizar", async () => {
    await mount();
    await click("Autorizo");
    await click("Ecosistemas");
    cleanup();
    await mount();
    expect(screen.getByRole("button", { name: "Autorizo" })).toBeTruthy();
    expect(input().disabled).toBe(true);
    await waitFor(() => expect(calls.filter(c => c.url.endsWith("/conversations"))).toHaveLength(1));
  });
});
