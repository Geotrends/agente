/**
 * Caso de uso de POST /api/chat (contracts/chat-api.md), sin Express: recibe la solicitud ya
 * validada y las dependencias, y devuelve el estado HTTP y el cuerpo. Orden: conversación →
 * saneamiento de PII → orquestación con plazo único → registro confirmado → respuesta.
 * Ninguna ruta de error devuelve SQL, modelo, proveedor ni trazas.
 */
import { sanitizeCitizenText, sanitizeForRecord, sanitizeFragment } from "../services/pii.js";
import { MAX_HISTORY_PAIRS } from "../shared/chatHistory.js";
import { needsPreviousContext } from "../services/contextBudget.js";
import { TEXTO_AVISO_PII } from "../prompts/institutionalTexts.js";
import { ModelsUnavailableError } from "./modelRouting.js";
import { reportUnavailable } from "./unavailable.js";
import { assertPublicResponse, type ContactSnapshot, type ErrorCodigo, type ModelAdapter, type ModelRequest, type ModelCallResult, type PreguntaValidada, type RespuestaPublica } from "./contracts.js";
import { Deadline, isDeadlineError } from "./deadline.js";
import { ContactReadError } from "../admin/contacts.js";
import { ConversationStoreError, type ConversationState } from "./conversations.js";
import type { Budget } from "./boundedDb.js";
import { ChatFailure, orchestrate, type ChatOutcome } from "./orchestrator.js";
import { prioritizeByCategory, prioritizeProcedures } from "./categoryPriority.js";
import { callWithRouting } from "./modelRouting.js";
import type { AuthorizedRecord, AnonymousRecord, WriteHooks } from "./records.js";
import type { RegistryEpisode } from "./registryEpisode.js";
import type { RetrievedHit } from "./sources.js";
import { safeErrorCode } from "../services/safeLog.js";

export type ChatDeps = {
  contacts: (budget?: Budget) => Promise<ContactSnapshot | null>;
  retrieve: (pregunta: string, cola?: string) => Promise<{ hits: RetrievedHit[] }>;
  /** Revalida la evidencia antes de entregar (documento retirado/vencido/reemplazado durante la consulta). */
  revalidate?: (hits: RetrievedHit[]) => Promise<boolean>;
  adapter: ModelAdapter;
  /** Política privada del proceso de evaluación; producción conserva routing. */
  modelCall?: (req: Omit<ModelRequest, "deadline" | "signal">, deadline: Deadline) => Promise<ModelCallResult>;
  loadConversation: (id: string, subject: string, budget?: Budget) => Promise<ConversationState | null>;
  saveClarification: (id: string, pending: boolean, budget?: Budget) => Promise<void>;
  saveInteraction: (rec: AuthorizedRecord, hooks: WriteHooks, budget?: Budget) => Promise<string | null>;
  saveAnonymousUsage: (rec: AnonymousRecord, hooks: WriteHooks, budget?: Budget) => Promise<boolean>;
  linkCodes?: (text: string) => Promise<string>;
  /** Eventos operativos sin texto de ciudadano. */
  onModelsUnavailable?: () => void;
  onRegistryFailureEpisode?: (episode: RegistryEpisode) => void;
  /** El registro volvió a normal: primer éxito del proceso o cierre de un episodio. */
  onRegistryNormal?: (info: { recovered?: RegistryEpisode; at: Date }) => void;
  now?: () => Date;
};

export type ChatResult =
  | { status: 200; body: RespuestaPublica }
  | { status: 400 | 500 | 503; error: { codigo: ErrorCodigo; campo?: string; mensaje?: string } };

/**
 * Cola de seguimiento (RF-C3-DI-15): los últimos ≤500 caracteres de la pregunta previa, desde una
 * frontera de palabra. Una palabra mayor de 500 no se mutila: la cola queda vacía. Solo alimenta
 * la BÚSQUEDA (BM25 y reranker); nunca entra al contexto del modelo.
 */
export function tailOf(previous: string, max = 500): string {
  const text = previous.trim();
  if (text.length <= max) return text;
  const tail = text.slice(-max);
  const boundary = tail.search(/\s/);
  return boundary === -1 ? "" : tail.slice(boundary + 1).trim();
}

export function followUpTail(pregunta: string, previous: string | undefined): string | undefined {
  if (!previous || !needsPreviousContext(pregunta)) return undefined;
  return tailOf(previous) || undefined;
}

export async function handleChat(input: PreguntaValidada, subject: string, deps: ChatDeps, deadline: Deadline): Promise<ChatResult> {
  // La fecha de recepción y la duración parten del contexto creado al llegar los encabezados
  // (antes de cuerpo, sesión y cola). `deps.now` solo lo sustituyen las pruebas con reloj fijo.
  const now = deps.now;
  const receivedAt = now ? now() : deadline.receivedAt;
  // Todo acceso a base durante el caso de uso se acota al objetivo operativo de la solicitud.
  const budget: Budget = { remainingMs: () => deadline.targetRemainingMs(), signal: deadline.signal };
  let conversation: ConversationState | null = null;
  if (input.conversationId) {
    try {
      conversation = await deps.loadConversation(input.conversationId, subject, budget);
    } catch (error) {
      // La propiedad no pudo verificarse: no se cambia en silencio a modo anónimo ni se registra.
      if (error instanceof ConversationStoreError || isDeadlineError(error)) return { status: 503, error: { codigo: "SERVICIO_NO_DISPONIBLE" } };
      throw error;
    }
    // Identificador desconocido o ajeno: nunca habilita historial ni registro.
    if (!conversation) return { status: 400, error: { codigo: "VALIDACION", campo: "conversationId", mensaje: "Conversación no válida." } };
  }

  // Saneamiento antes de salir: pregunta e historial (pregunta y respuesta previas).
  const q = sanitizeCitizenText(input.pregunta);
  // Defensa en profundidad: aunque la validación ya recorta, nada pasa de 10 pares hacia el proveedor.
  const historial = input.historial.slice(-MAX_HISTORY_PAIRS).map(h => ({
    pregunta: sanitizeCitizenText(h.pregunta).texto,
    respuesta: sanitizeFragment(h.respuesta).texto,
  }));
  const previous = historial.length ? historial[historial.length - 1].pregunta : undefined;
  const clean: PreguntaValidada = { ...input, pregunta: q.texto, historial };

  let outcome: ChatOutcome;
  try {
    outcome = await orchestrate(clean, {
      contacts: async () => {
        try { return await deps.contacts(budget); } catch (error) {
          // Lectura acotada que no terminó a tiempo: indisponibilidad, no error interno.
          if (error instanceof ContactReadError) throw new ChatFailure("contactos_no_disponibles");
          throw error;
        }
      },
      retrieve: async (pregunta) => {
        const r = await deps.retrieve(pregunta, followUpTail(pregunta, previous));
        // Los fragmentos también se sanean antes de llegar al proveedor.
        const hits = r.hits.map(h => ({ ...h, snippet: sanitizeFragment(h.snippet).texto }));
        // La categoría solo prioriza el orden; no descarta fragmentos de otras direcciones. Los
        // procedimientos GT-P van siempre por delante de las páginas web y demás fuentes.
        return { hits: prioritizeProcedures(prioritizeByCategory(hits, input.categoria)) };
      },
      model: async req => deps.modelCall ? deps.modelCall(req, deadline) : (await callWithRouting(deps.adapter, req, deadline)).result,
      linkCodes: deps.linkCodes,
      revalidate: deps.revalidate,
    }, {
      autorizada: !!conversation,
      aclaracionPendiente: conversation?.clarificationPending ?? false,
      avisoPii: q.tipos.length ? TEXTO_AVISO_PII : undefined,
    });
  } catch (error) {
    if (error instanceof ModelsUnavailableError) deps.onModelsUnavailable?.();
    if (error instanceof ChatFailure || error instanceof ModelsUnavailableError || isDeadlineError(error) || deadline.expired) {
      // Evento técnico mínimo + aviso (sin texto): qué componente no pudo atender y en qué modo.
      const modo = conversation ? "conversación" : "anónima";
      const component = isDeadlineError(error) || deadline.expired ? "plazo"
        : error instanceof ChatFailure && (error.kind === "busqueda_fallida" || error.kind === "datos_fuente" || error.kind === "contactos_no_disponibles")
          ? "busqueda" : "modelos";
      reportUnavailable(component, modo);
      return { status: 503, error: { codigo: "SERVICIO_NO_DISPONIBLE" } };
    }
    console.error("[chat]", safeErrorCode(error));
    return { status: 500, error: { codigo: "ERROR_INTERNO" } };
  }

  const usage = outcome.interno
    ? { modelId: outcome.interno.model.effectiveModel, inputTokens: outcome.interno.model.usage.inputTokens, outputTokens: outcome.interno.model.usage.outputTokens }
    : { modelId: "none" as const, inputTokens: 0, outputTokens: 0 };
  const hooks: WriteHooks = { onNewFailureEpisode: deps.onRegistryFailureEpisode, onRegistryNormal: deps.onRegistryNormal };
  const elapsed = (): number => (now ? now().getTime() - receivedAt.getTime() : deadline.elapsedMs());

  if (!conversation) {
    // Anónima: solo fecha, modo, modelo, tokens y costo; nada de texto, hash, UUID ni IP.
    await deps.saveAnonymousUsage({ receivedAt, usage }, hooks, budget);
    return publicResult({ modo: "anónima", tipo: outcome.tipo, respuesta: outcome.respuesta, fuentes: outcome.fuentes });
  }

  // La aclaración pendiente es lo único que se guarda del turno en la conversación.
  try { await deps.saveClarification(conversation.conversationId, outcome.aclaracionPendiente, budget); } catch { /* el estado se recompone con la siguiente consulta */ }
  const responseId = await deps.saveInteraction({
    conversationId: conversation.conversationId, receivedAt, categoria: input.categoria,
    pregunta: q.texto, respuesta: sanitizeForRecord(outcome.respuesta, outcome.valoresOficiales), tipo: outcome.tipo, fuentes: outcome.fuentes,
    durationMs: elapsed(), visibleTokens: outcome.visibleTokens, usage,
  }, hooks, budget);
  return publicResult({
    modo: "conversación", conversationId: conversation.conversationId, ...(responseId ? { responseId } : {}),
    tipo: outcome.tipo, respuesta: outcome.respuesta, fuentes: outcome.fuentes,
  });
}

/** Última defensa: un cuerpo fuera de contrato no sale como 200; se informa como error interno. */
function publicResult(body: RespuestaPublica): ChatResult {
  try {
    assertPublicResponse(body);
    return { status: 200, body };
  } catch {
    console.error("[chat] respuesta_publica_invalida");
    return { status: 500, error: { codigo: "ERROR_INTERNO" } };
  }
}

