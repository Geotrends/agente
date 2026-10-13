/** Utilidades de prueba de componentes: panel real, fetch simulado y reloj controlado. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import ChatPanel from "../../chat/ChatPanel";
import { clearSessionToken } from "../../shared/session";

export const UUID = "11111111-1111-4111-8111-111111111111";
export const CONFIG = {
  apertura: "Soy Geobot, asistente automatizado.",
  politica: { version: "2026-10", url: "https://ejemplo.gov.co/politica" },
  opciones: [{ valor: "autorizo", etiqueta: "Autorizo" }, { valor: "no_autorizo", etiqueta: "No autorizo" }],
  contactos: {
    revision: 1,
    recepcion: { pqrsd: "https://pqrsd.gov.co/radicar", whatsapp: "+57 300 111 2233", email: "pqrsd@gov.co" },
    general: { phone: "(604) 555 0100", email: "info@gov.co", url: "https://gov.co/contacto" },
    inmediatos: [{ id: "a", name: "Emergencias", description: "24 h", type: "teléfono" as const, value: "123", position: 1 }],
  },
};

export const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
export const okAnswer = (n: number) =>
  json({ modo: "anónima", tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] });

/** Respuesta coherente con la solicitud: con conversationId → modo conversación (mismo ID); sin él → anónima. */
export const answerFor = (n: number, body: Record<string, unknown>) =>
  typeof body.conversationId === "string"
    ? json({ modo: "conversación", conversationId: body.conversationId, responseId: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] })
    : okAnswer(n);

export type Call = { url: string; body: Record<string, unknown> | null; at: number };

export type ChatHandler = (n: number, body: Record<string, unknown>, signal?: AbortSignal | null) => Response | Promise<Response>;

/** Instala fetch: config/session/conversaciones reales de prueba y /chat gobernado por `handler`. */
export function installFetch(handler: ChatHandler, over: { config?: () => Response | Promise<Response> } = {}) {
  const calls: Call[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ url, body, at: Date.now() });
    if (url.endsWith("/chat/config")) return over.config ? over.config() : json(CONFIG);
    if (url.endsWith("/session")) return json({ token: "tok", expiresIn: 3600 });
    if (url.endsWith("/conversations")) return json({ modo: "conversación", conversationId: UUID }, 201);
    if (url.endsWith("/chat")) return handler(++n, body ?? {}, init?.signal);
    return new Response("no", { status: 404 });
  }));
  return { calls, chats: () => calls.filter(c => c.url.endsWith("/chat")), configs: () => calls.filter(c => c.url.endsWith("/chat/config")) };
}

/** Respuesta que tarda `ms` de reloj simulado y se cancela si la solicitud se aborta. */
export const after = (ms: number, make: () => Response) => (_n: number, _b: unknown, signal?: AbortSignal | null) =>
  new Promise<Response>((resolve, reject) => {
    const t = setTimeout(() => resolve(make()), ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("abort", "AbortError")); });
  });

export async function mountPanel(opts: { anonymous?: boolean; category?: string } = {}) {
  clearSessionToken();
  render(<ChatPanel />);
  await screen.findByText(/Soy Geobot/);
  if (opts.anonymous !== false) {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No autorizo" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: opts.category ?? "No estoy seguro" })); });
  }
}

export const input = () => screen.getByLabelText("Pregunta") as HTMLInputElement;
export async function ask(q: string) {
  await act(async () => { fireEvent.change(input(), { target: { value: q } }); });
  await act(async () => { fireEvent.submit(input().closest("form")!); });
}
export const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
