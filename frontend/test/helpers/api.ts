/** API simulada para e2e: respuestas preparadas; sin red real ni modelo (adapter `controlled`). */
import type { BrowserContext } from "@playwright/test";

export const CHAT_ORIGIN = `http://localhost:${process.env.E2E_CHAT_PORT ?? 4311}`;
export const HOST_ORIGIN = `http://localhost:${process.env.E2E_HOST_PORT ?? 4310}`;
export const UUID = "11111111-1111-4111-8111-111111111111";

export const CONFIG = {
  apertura: "Soy Geobot, asistente automatizado del Observatorio.",
  politica: { version: "2026-10", url: "https://ejemplo.gov.co/politica" },
  opciones: [{ valor: "autorizo", etiqueta: "Autorizo" }, { valor: "no_autorizo", etiqueta: "No autorizo" }],
  contactos: {
    revision: 1,
    recepcion: { pqrsd: "https://pqrsd.gov.co/radicar", whatsapp: "+57 300 111 2233", email: "pqrsd@gov.co" },
    general: { phone: "(604) 555 0100", email: "info@gov.co", url: "https://gov.co/contacto" },
    inmediatos: [{ id: "a", name: "Emergencias", description: "24 horas", type: "teléfono", value: "123", position: 1 }],
  },
};

export type ApiLog = { configs: number; sessions: number; conversations: number; chats: Array<Record<string, unknown>>; ratings: Array<Record<string, unknown>> };

export async function stubApi(
  context: BrowserContext,
  opts: { rating?: (n: number, body: Record<string, unknown>) => { status: number; json?: unknown; delayMs?: number }; answer?: (n: number, body: Record<string, unknown>) => { status?: number; json?: unknown; delayMs?: number; hang?: boolean; raw?: { body: string; contentType: string } } } = {},
): Promise<ApiLog> {
  const log: ApiLog = { configs: 0, sessions: 0, conversations: 0, chats: [], ratings: [] };
  await context.route(`${CHAT_ORIGIN}/api/chat/config`, r => { log.configs++; return r.fulfill({ json: CONFIG }); });
  await context.route(`${CHAT_ORIGIN}/api/session`, r => { log.sessions++; return r.fulfill({ json: { token: "tok-tecnico", expiresIn: 3600 } }); });
  await context.route(`${CHAT_ORIGIN}/api/conversations`, r => { log.conversations++; return r.fulfill({ status: 201, json: { modo: "conversación", conversationId: UUID } }); });
  await context.route(`${CHAT_ORIGIN}/api/ratings`, async r => {
    const body = JSON.parse(r.request().postData() ?? "{}") as Record<string, unknown>;
    log.ratings.push(body);
    const custom = opts.rating?.(log.ratings.length, body);
    if (custom?.delayMs) await new Promise(res => setTimeout(res, custom.delayMs));
    if (custom && custom.status !== 201) return r.fulfill({ status: custom.status, json: custom.json ?? { error: { codigo: "VALIDACION", mensaje: "No se pudo registrar la valoración." } } });
    return r.fulfill({ status: 201, json: custom?.json ?? { responseId: body.responseId, registrada: true } });
  });
  await context.route(`${CHAT_ORIGIN}/api/chat`, async r => {
    const body = JSON.parse(r.request().postData() ?? "{}") as Record<string, unknown>;
    log.chats.push(body);
    const n = log.chats.length;
    const custom = opts.answer?.(n, body);
    if (custom?.hang) { await new Promise(() => {}); return; }
    if (custom?.delayMs) await new Promise(res => setTimeout(res, custom.delayMs));
    if (custom?.raw) return r.fulfill({ status: custom.status ?? 200, contentType: custom.raw.contentType, body: custom.raw.body });
    return r.fulfill({
      status: custom?.status ?? 200,
      // Coherente con la solicitud: con conversationId → conversación; sin él → anónima (sin IDs).
      json: custom?.json ?? (typeof body.conversationId === "string"
        ? { modo: "conversación", conversationId: body.conversationId, responseId: `r${n}`, tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] }
        : { modo: "anónima", tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] }),
    });
  });
  return log;
}
