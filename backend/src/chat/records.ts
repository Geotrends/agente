/**
 * Registro de consumo (RF-C3-DI-16, RF-C3-IN-03/05/07/08).
 *
 * Una fila por consulta autorizada, escrita y CONFIRMADA antes de emitir el `responseId`.
 * Un fallo de escritura nunca bloquea la respuesta: se entrega sin `responseId`, no se
 * retiene el texto para reintentar y se informa UNA vez por episodio de fallos. Las
 * consultas anónimas solo dejan seis campos; sin texto, hash, UUID, IP ni token.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Categoria, FuenteCitada, TipoRespuesta } from "./contracts.js";
import { runBounded, type Budget } from "./boundedDb.js";
import { chatPool } from "./db.js";
import type { PersistenceState } from "./requestContext.js";
import { EpisodeTracker, writeEpisodes, type RegistryEpisode, type RegistryMode, type SuccessInfo } from "./registryEpisode.js";
import { computeCost, currentTariff, MODEL_LABEL, type Queryable } from "./tariffs.js";

/** Presupuesto por defecto para llamadores que no pasan uno (equivale al statement_timeout del pool). */
const DEFAULT_BUDGET: Budget = { remainingMs: () => 10_000 };

export type Usage = { modelId: string | "none"; inputTokens: number; outputTokens: number };

export type AuthorizedRecord = {
  conversationId: string;
  receivedAt: Date;
  categoria?: Categoria;
  pregunta: string;
  respuesta: string;
  tipo: TipoRespuesta;
  fuentes: FuenteCitada[];
  durationMs: number;
  visibleTokens: number;
  usage: Usage;
};

/**
 * Fuentes tal como se persisten: solo `{id, nombre, enlace, fecha}`, copiadas del catálogo publicado.
 * Una allowlist explícita impide que un campo adicional (de la salida del modelo o de un fragmento)
 * llegue a la tabla y sobreviva a la depuración.
 */
export function persistableSources(fuentes: FuenteCitada[]): FuenteCitada[] {
  return fuentes.map(f => ({ id: f.id, nombre: f.nombre, enlace: f.enlace, fecha: f.fecha }));
}

export { EpisodeTracker, writeEpisodes };

export type WriteHooks = {
  /** Primera escritura fallida de un episodio: fecha, hora y modo (sin texto). */
  onNewFailureEpisode?: (episode: RegistryEpisode) => void;
  /** El registro volvió a normal (primer éxito del proceso o cierre de un episodio). */
  onRegistryNormal?: (info: SuccessInfo & { at: Date }) => void;
};

function noteFailure(mode: RegistryMode, hooks: WriteHooks): void {
  if (writeEpisodes.failure(mode)) hooks.onNewFailureEpisode?.(writeEpisodes.current!);
}

function noteSuccess(hooks: WriteHooks): void {
  const at = new Date();
  const info = writeEpisodes.success(at);
  if (info.becameNormal) hooks.onRegistryNormal?.({ ...info, at });
}

async function costFor(usage: Usage, at: Date, db: Queryable): Promise<{ model: string; tariffVersion: number | null; cost: string | null }> {
  if (usage.modelId === "none") return { model: "none", tariffVersion: null, cost: "0.000000000000" };
  const tariff = await currentTariff(usage.modelId, at, db);
  const model = MODEL_LABEL[usage.modelId];
  if (!model) throw new Error("modelo_sin_etiqueta");
  // Sin tarifa vigente no se inventa un cero: costo y versión quedan vacíos.
  return { model, tariffVersion: tariff?.version ?? null, cost: tariff ? computeCost(usage.inputTokens, usage.outputTokens, tariff) : null };
}

export type SaveInteractionResult = {
  state: PersistenceState;
  /** Solo con commit confirmado; nunca con un resultado indeterminado. */
  responseId?: string;
  /** Intentos de escritura realizados: siempre 1 (el texto nunca se reenvía). */
  attempts: 1;
};

/**
 * Escribe la interacción dentro del presupuesto restante. El `responseId` público solo existe tras
 * un COMMIT confirmado; un fallo, una cancelación o un resultado indeterminado no lo emiten y no
 * se reintentan ni se retiene el texto.
 */
export async function saveInteractionDetailed(
  rec: AuthorizedRecord, hooks: WriteHooks = {}, db: pg.Pool = chatPool(), budget: Budget = DEFAULT_BUDGET,
): Promise<SaveInteractionResult> {
  const responseId = randomUUID();
  const outcome = await runBounded(db, budget, async client => {
    const { model, tariffVersion, cost } = await costFor(rec.usage, rec.receivedAt, client);
    await client.query(
      `INSERT INTO chat.interaction (conversation_id, response_id, received_at, category, question_text, answer_text, result_type,
         cited_documents, duration_ms, visible_output_tokens, model, input_tokens, output_tokens, tariff_version, estimated_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)`,
      [rec.conversationId, responseId, rec.receivedAt, rec.categoria ?? null, rec.pregunta, rec.respuesta, rec.tipo,
        JSON.stringify(persistableSources(rec.fuentes)), Math.max(0, Math.round(rec.durationMs)), rec.visibleTokens, model,
        rec.usage.inputTokens, rec.usage.outputTokens, tariffVersion, cost]);
  });
  if (outcome.state === "confirmada") {
    noteSuccess(hooks);
    return { state: "confirmada", responseId, attempts: 1 };
  }
  // Solo el código: el mensaje podría citar valores de la fila.
  console.error(`[registro] no se pudo escribir la interacción: ${outcome.state}/${outcome.reason}${outcome.code ? `/${outcome.code}` : ""}`);
  noteFailure("conversación", hooks);
  return { state: outcome.state, attempts: 1 };
}

/** Devuelve el responseId solo si la fila quedó confirmada; null si la escritura falló. */
export async function saveInteraction(
  rec: AuthorizedRecord, hooks: WriteHooks = {}, db: pg.Pool = chatPool(), budget?: Budget,
): Promise<string | null> {
  return (await saveInteractionDetailed(rec, hooks, db, budget)).responseId ?? null;
}

export type AnonymousRecord = { receivedAt: Date; usage: Usage };

/** Solo fecha, modo, modelo, tokens y costo. Devuelve si quedó escrito. */
export async function saveAnonymousUsage(
  rec: AnonymousRecord, hooks: WriteHooks = {}, db: pg.Pool = chatPool(), budget: Budget = DEFAULT_BUDGET,
): Promise<boolean> {
  const outcome = await runBounded(db, budget, async client => {
    const { model, cost } = await costFor(rec.usage, rec.receivedAt, client);
    await client.query(
      "INSERT INTO chat.anonymous_usage (received_at, model, input_tokens, output_tokens, estimated_cost) VALUES ($1,$2,$3,$4,$5)",
      [rec.receivedAt, model, rec.usage.inputTokens, rec.usage.outputTokens, cost]);
  });
  if (outcome.state === "confirmada") { noteSuccess(hooks); return true; }
  console.error(`[registro] no se pudo escribir el consumo anónimo: ${outcome.state}/${outcome.reason}${outcome.code ? `/${outcome.code}` : ""}`);
  noteFailure("anónima", hooks);
  return false;
}
