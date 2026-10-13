/**
 * Conversaciones autorizadas (RF-C3-IN-01/02/07). El UUID lo emite SOLO el backend,
 * con la decisión «Autorizo» y la versión de política mostrada, ligado a la credencial
 * técnica vigente. Un identificador desconocido o ajeno nunca habilita historial ni
 * registro. No se crea nada para consultas anónimas.
 */
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { runBounded, type Budget } from "./boundedDb.js";
import { chatPool } from "./db.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuidV4 = (v: unknown): v is string => typeof v === "string" && UUID_V4.test(v);

export const bindingHash = (subject: string): string => createHash("sha256").update(`conv:${subject}`).digest("hex");

/**
 * Crea la conversación autorizada. El UUID solo se entrega tras el commit confirmado; con `budget`
 * la escritura respeta el tiempo restante y, si no se confirma, lanza `ConversationStoreError`
 * (el cliente nunca recibe un identificador sin respaldo).
 */
export async function createConversation(
  subject: string, policyVersion: string, db: pg.Pool = chatPool(), at = new Date(), budget?: Budget,
): Promise<string> {
  const id = randomUUID();
  const sql = `INSERT INTO chat.conversation (conversation_id, authorized_at, policy_version, transport_binding_hash, created_at, last_active_at)
     VALUES ($1, $2, $3, $4, $2, $2)`;
  const params = [id, at, policyVersion, bindingHash(subject)];
  if (budget) {
    const out = await runBounded(db, budget, c => c.query(sql, params));
    if (out.state !== "confirmada") throw new ConversationStoreError(out.reason);
    return id;
  }
  await db.query(sql, params);
  return id;
}

export type ConversationState = { conversationId: string; clarificationPending: boolean };

/** La base de conversaciones no respondió a tiempo: nunca se degrada en silencio a modo anónimo. */
export class ConversationStoreError extends Error {
  constructor(readonly reason: string) { super("conversaciones_no_disponibles"); this.name = "ConversationStoreError"; }
}

/**
 * Estado de la conversación solo si existe Y pertenece a esta credencial técnica. Con `budget` la
 * lectura respeta el tiempo restante; si no puede completarse lanza `ConversationStoreError`.
 */
export async function loadConversation(id: string, subject: string, db: pg.Pool = chatPool(), budget?: Budget): Promise<ConversationState | null> {
  if (!isUuidV4(id)) return null;
  const sql = "SELECT clarification_pending FROM chat.conversation WHERE conversation_id = $1 AND transport_binding_hash = $2";
  const params = [id, bindingHash(subject)];
  let rows: Array<{ clarification_pending: boolean }>;
  if (budget) {
    const out = await runBounded(db, budget, async c => (await c.query(sql, params)).rows);
    if (out.state !== "confirmada") throw new ConversationStoreError(out.reason);
    rows = out.value;
  } else {
    rows = (await db.query(sql, params)).rows;
  }
  return rows.length ? { conversationId: id, clarificationPending: rows[0].clarification_pending } : null;
}

export async function saveClarification(id: string, pending: boolean, db: pg.Pool = chatPool(), at = new Date(), budget?: Budget): Promise<void> {
  const sql = "UPDATE chat.conversation SET clarification_pending = $2, last_active_at = $3 WHERE conversation_id = $1";
  if (budget) {
    const out = await runBounded(db, budget, c => c.query(sql, [id, pending, at]));
    if (out.state !== "confirmada") throw new ConversationStoreError(out.reason);
    return;
  }
  await db.query(sql, [id, pending, at]);
}
