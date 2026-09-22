/**
 * Responder una pregunta: recuperación, contexto, proveedor y registro (M-1).
 *
 * Todo esto vivía dentro del handler HTTP de `routes/chat.ts`, que hacía siete
 * cosas en 111 líneas: validar entrada, reescribir la consulta, recuperar,
 * construir el contexto, decidir el enrutamiento, registrar y formatear.
 *
 * La consecuencia práctica no era estética. **El formato del encabezado de
 * fragmento —el contrato real entre la recuperación y el prompt— estaba
 * escrito en línea dentro del handler**, así que la única forma de probarlo
 * era levantar un servidor HTTP completo con embeddings reales, que es
 * exactamente lo que `http-smoke.ts` tiene que hacer. Aquí dentro se prueba
 * con una llamada a función.
 *
 * Lo que NO entra aquí es la traducción a HTTP: qué código de estado
 * corresponde a cada desenlace es decisión del handler. Por eso esto devuelve
 * un `AnswerOutcome` discriminado y no toca `res` en ningún punto.
 */
import path from "node:path";
import { performance } from "node:perf_hooks";
import { logChatInteraction } from "./chatLog.js";
import { askSmartTutor, askTutor } from "./llm.js";
import type { RoutedProvider } from "./providerRouter.js";
import { search } from "./retrievalClient.js";
import { getProviderModel } from "../shared/providerModel.js";
import { normalizeHistory, type ChatTurn } from "../shared/chatHistory.js";
import { needsPreviousContext, tailAtWordBoundary } from "./contextBudget.js";
import type { ProviderResult } from "../shared/llmTypes.js";

export type AnswerRequest = {
  message: string;
  /** Historial tal como llega del cliente; se normaliza aquí dentro (A-9). */
  history?: unknown;
  /** Ausente = enrutamiento automático. */
  provider?: RoutedProvider;
  model?: string;
};

type RetrievalMeta = { method: string; documents: number; chunks: number };

export type AnswerMeta = {
  provider: string;
  model: string;
  providerLabel: string;
  routingReason: string | null;
  autoRoute: boolean;
  contextChars: number;
  retrieval: RetrievalMeta;
  sources: unknown[];
  abstained?: boolean;
};

export type AnswerOutcome =
  | { kind: "answer"; answer: string; meta: AnswerMeta }
  | { kind: "abstained"; answer: string; meta: AnswerMeta }
  | {
      kind: "provider_failed";
      failure: { kind: string; retryable: boolean; message: string; detail: string };
      meta: Omit<AnswerMeta, "contextChars" | "retrieval" | "sources">;
    };

const ABSTENTION_ANSWER =
  "No encontré información suficiente en los documentos disponibles para responder esta pregunta.";

/**
 * Encabezado que precede a cada fragmento en el contexto del modelo.
 *
 * Es el contrato entre recuperación y prompt: la regla 7 del prompt cita a
 * partir de estos campos, así que cambiarlos cambia las citas. Extraído a una
 * función propia justamente para que se pueda probar sin servidor.
 */
export function formatContextEntry(hit: {
  path: string; snippet: string; title?: string; page?: number;
  sourceUrl?: string; sourcePageUrl?: string; category?: string;
}): string {
  const details = [
    `Fuente: ${hit.title || path.basename(hit.path)}`,
    // M-4: la página hace la cita verificable. Sin ella, la mejor cita posible
    // era "este PDF de 180 páginas".
    hit.page ? `Pagina: ${hit.page}` : "",
    `Archivo local: ${hit.path}`,
    hit.sourceUrl ? `URL original: ${hit.sourceUrl}` : "",
    hit.sourcePageUrl ? `Pagina de origen: ${hit.sourcePageUrl}` : "",
    hit.category ? `Categoria: ${hit.category}` : "",
  ].filter(Boolean).join(" | ");
  return `--- ${details} ---\n${hit.snippet}`;
}

/**
 * Agrupa los fragmentos por documento para la lista de fuentes de la interfaz.
 *
 * Conserva TODAS las páginas citadas de un mismo documento: quedarse con la
 * primera pierde justo lo que hace verificable la cita cuando la respuesta se
 * apoya en dos pasajes distantes del mismo PDF (M-4).
 */
export function groupSources<T extends { path: string; page?: number; snippet: string }>(
  hits: T[],
): Array<Omit<T, "snippet" | "page"> & { pages?: number[] }> {
  type Source = Omit<T, "snippet" | "page">;
  const byPath = new Map<string, { source: Source; pages: Set<number> }>();
  for (const hit of hits) {
    const { snippet, page, ...source } = hit;
    const existing = byPath.get(hit.path);
    if (!existing) byPath.set(hit.path, { source: source as Source, pages: new Set(page ? [page] : []) });
    else if (page) existing.pages.add(page);
  }
  return [...byPath.values()].map(({ source, pages }) => ({
    ...source,
    ...(pages.size ? { pages: [...pages].sort((a, b) => a - b) } : {}),
  }));
}

const USED_SOURCES_MARKER = /<!--\s*FUENTES_USADAS:\s*([^>]*?)\s*-->\s*$/i;

// El prompt ya no pide esta sección (la arma la interfaz), pero el modelo
// puede seguir agregándola por hábito. Se recorta como red de seguridad para
// no duplicar la lista de fuentes dentro del propio mensaje.
const TRAILING_SOURCES_SECTION =
  /\n{1,2}(?:-{3,}\s*\n+)?(?:#{1,6}\s*|\*\*)?fuentes\s+consultadas(?:\*\*)?\s*:?\s*\n[\s\S]*$/i;

/**
 * Extrae el marcador `FUENTES_USADAS` que el modelo agrega al final de la
 * respuesta (regla de output_format) y lo retira del texto visible.
 *
 * El marcador identifica, por "Archivo local", cuáles de los fragmentos
 * recuperados sustentaron realmente la respuesta. Sin esto, el panel mostraba
 * siempre los 8 resultados del reranking aunque solo uno o dos se usaran.
 */
export function extractUsedSources(answer: string): { answer: string; usedPaths: string[] | null } {
  const match = answer.match(USED_SOURCES_MARKER);
  const withoutMarker = match ? answer.slice(0, match.index).trimEnd() : answer;
  const cleaned = withoutMarker.replace(TRAILING_SOURCES_SECTION, "").trimEnd();
  if (!match) return { answer: cleaned, usedPaths: null };
  const paths = match[1]
    .split("|")
    .map(p => p.trim())
    .filter(Boolean);
  return { answer: cleaned, usedPaths: paths };
}

/**
 * Decide qué contexto previo acompaña a la consulta (M-2).
 *
 * Se decide con una señal real —si la pregunta se sostiene sola— y no con los
 * dos números mágicos que había antes (160 y 500 caracteres).
 */
export function previousContextFor(message: string, history: ChatTurn[]): string | undefined {
  const previous = [...history].reverse().find(turn => turn.role === "user")?.content;
  return previous && needsPreviousContext(message) ? tailAtWordBoundary(previous, 500) : undefined;
}

export async function answerQuestion(request: AnswerRequest): Promise<AnswerOutcome> {
  const startedAt = performance.now();
  const autoRoute = !request.provider;
  const history = normalizeHistory(request.history);
  const context = previousContextFor(request.message, history);
  const retrieval = await search(request.message, context);
  const retrievalMeta: RetrievalMeta = {
    method: retrieval.method, documents: retrieval.documents, chunks: retrieval.chunks,
  };

  // Abstención (A-5): sin evidencia por encima del umbral de relevancia, se
  // responde sin llamar a ningún proveedor, en vez de fabricar una respuesta
  // con fragmentos que el reranker ya descartó.
  if (retrieval.hits.length === 0) {
    return {
      kind: "abstained",
      answer: ABSTENTION_ANSWER,
      meta: {
        provider: "none", model: "none", providerLabel: "sin proveedor (abstención)",
        routingReason: null, autoRoute, contextChars: 0,
        retrieval: retrievalMeta, sources: [], abstained: true,
      },
    };
  }

  const courseContext = retrieval.hits.map(formatContextEntry).join("\n\n");
  const payload = { message: request.message, courseContext, history };

  let result: ProviderResult;
  let provider: RoutedProvider;
  let model: string;
  let routingReason: string | null = null;
  if (autoRoute) {
    const smart = await askSmartTutor(payload);
    ({ result, provider, model, routingReason } = smart);
  } else {
    provider = request.provider!;
    model = request.model || getProviderModel(provider);
    result = await askTutor({ ...payload, provider, model: request.model });
  }

  const baseMeta = {
    provider, model, providerLabel: `${provider} · ${model}`, routingReason, autoRoute,
  };

  // Un fallo de proveedor deja de viajar como respuesta (A-4): no se registra
  // en el CSV y el handler lo traduce a 503.
  if (!result.ok) {
    console.error(`[chat] ${provider} (${result.kind}): ${result.detail}`);
    return {
      kind: "provider_failed",
      failure: { kind: result.kind, retryable: result.retryable, message: result.message, detail: result.detail },
      meta: baseMeta,
    };
  }

  const { answer, usedPaths } = extractUsedSources(result.answer);
  const allSources = groupSources(retrieval.hits);
  // Si el modelo no incluyó el marcador o no reportó ninguna fuente usada,
  // se conservan todas para no ocultarle evidencia al usuario (fallback seguro).
  const filteredSources = usedPaths && usedPaths.length > 0
    ? allSources.filter(s => usedPaths.includes(path.basename(s.path)) || usedPaths.includes(s.path))
    : [];
  // Si el filtrado no coincidió con nada (p.ej. el modelo citó un nombre que
  // no encaja exactamente), se prefiere mostrar todas antes que ocultar
  // evidencia real por un error de formato.
  const sources = filteredSources.length > 0 ? filteredSources : allSources;
  const responseTimeMs = Math.round(performance.now() - startedAt);
  // No se espera (M-7): la respuesta ya está lista y el registro es
  // diagnóstico, no parte del contrato con el usuario.
  void logChatInteraction({
    provider, model, question: request.message, answer,
    sources: sources as Array<{ path: string; title?: string; sourceUrl?: string }>,
    responseTimeMs,
  }).catch(error => console.error("[chatLog] No se pudo registrar la interacción:", error));

  return {
    kind: "answer",
    answer,
    meta: { ...baseMeta, contextChars: courseContext.length, retrieval: retrievalMeta, sources },
  };
}
