/**
 * Validación estricta de las solicitudes del chat (contracts/chat-api.md). Se rechaza todo
 * lo desconocido —modelo, proveedor, prompt, autoRoute, mensajes role/content— para que
 * nadie pueda elegir proveedor ni inyectar instrucciones por campos laterales.
 */
import { validateHistoryPairs } from "../shared/chatHistory.js";
import { CATEGORIAS, type Categoria, type PreguntaValidada } from "./contracts.js";
import { isUuidV4 } from "./conversations.js";

export type ValidationFailure = { ok: false; campo: string; mensaje: string };
export type ChatRequestResult = { ok: true; value: PreguntaValidada } | ValidationFailure;

const PERMITIDOS = new Set(["pregunta", "conversationId", "categoria", "historial"]);

const fail = (campo: string, mensaje: string): ValidationFailure => ({ ok: false, campo, mensaje });

export function validateChatRequest(body: unknown): ChatRequestResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("cuerpo", "El cuerpo debe ser un objeto JSON.");
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!PERMITIDOS.has(key)) return fail(key, "Campo no permitido.");
  }
  if (typeof b.pregunta !== "string" || !b.pregunta.trim()) return fail("pregunta", "La pregunta es obligatoria.");

  let conversationId: string | undefined;
  if (b.conversationId !== undefined) {
    if (!isUuidV4(b.conversationId)) return fail("conversationId", "Identificador de conversación no válido.");
    conversationId = b.conversationId;
  }
  let categoria: Categoria | undefined;
  if (b.categoria !== undefined) {
    if (typeof b.categoria !== "string" || !(CATEGORIAS as readonly string[]).includes(b.categoria)) {
      return fail("categoria", "La categoría debe ser Ecosistemas, Bienestar Animal o Gestión Ambiental.");
    }
    categoria = b.categoria as Categoria;
  }
  // El historial solo existe con una conversación autorizada: no hay historial anónimo.
  if (b.historial !== undefined && conversationId === undefined) {
    return fail("historial", "El historial solo se admite en una conversación autorizada.");
  }
  const h = validateHistoryPairs(b.historial);
  if (!h.ok) return h;
  return { ok: true, value: { pregunta: b.pregunta, ...(conversationId ? { conversationId } : {}), ...(categoria ? { categoria } : {}), historial: h.pares } };
}

export type ConversationRequestResult = { ok: true; autorizacion: boolean; policyVersion?: string } | ValidationFailure;

export function validateConversationRequest(body: unknown, currentPolicy: string): ConversationRequestResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("cuerpo", "El cuerpo debe ser un objeto JSON.");
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) if (key !== "autorizacion" && key !== "policyVersion") return fail(key, "Campo no permitido.");
  if (typeof b.autorizacion !== "boolean") return fail("autorizacion", "Indique true o false.");
  if (!b.autorizacion) return { ok: true, autorizacion: false };
  if (typeof b.policyVersion !== "string" || b.policyVersion !== currentPolicy) {
    return fail("policyVersion", "La versión de la política presentada no está vigente.");
  }
  return { ok: true, autorizacion: true, policyVersion: b.policyVersion };
}
