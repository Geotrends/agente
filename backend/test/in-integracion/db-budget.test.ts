/**
 * T008 — Presupuesto de base de datos (RF-C3-IN-04, RF-C3-IN-08).
 *
 * Pool ocupado, adquisición tardía, consulta/lock/commit lentos, cancelación con rollback y
 * commit indeterminado: la conexión se libera o se descarta, el identificador público solo sale
 * con commit confirmado y el texto nunca se reenvía. Base PostgreSQL real aislada; sin proveedor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createChatAdminDb, type ChatAdminDb } from "../di-integracion/chatAdminDb.js";
import { createConversation } from "../../src/chat/conversations.js";
import { saveInteractionDetailed, type AuthorizedRecord } from "../../src/chat/records.js";

const M20 = "openai.gpt-oss-20b-1:0";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Presupuesto controlable: plazo absoluto y señal de cancelación opcional. */
function budget(ms: number, signal?: AbortSignal) {
  const end = Date.now() + ms;
  return { remainingMs: () => Math.max(0, end - Date.now()), ...(signal ? { signal } : {}) };
}

async function setup(): Promise<{ db: ChatAdminDb; rec: AuthorizedRecord }> {
  const db = await createChatAdminDb();
  await db.admin.query(
    `INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url)
     VALUES ($1,'us-east-1','USD',0.07,0.3,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`, [M20]);
  const id = await createConversation("sub-presupuesto", "2026-10", db.chat);
  const rec: AuthorizedRecord = {
    conversationId: id, receivedAt: new Date(), pregunta: "pregunta sintética", respuesta: "respuesta sintética",
    tipo: "respondida", fuentes: [], durationMs: 10, visibleTokens: 5,
    usage: { modelId: M20, inputTokens: 10, outputTokens: 5 },
  };
  return { db, rec };
}

const rows = async (db: ChatAdminDb) => (await db.migrator.query("SELECT count(*)::int n FROM chat.interaction")).rows[0].n as number;
const settled = (db: ChatAdminDb) => db.chat.idleCount === db.chat.totalCount && db.chat.waitingCount === 0;

async function installSleepTrigger(db: ChatAdminDb, kind: "insert" | "commit", seconds: number): Promise<void> {
  await db.migrator.query(`CREATE FUNCTION public.demora_prueba() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(${seconds}); RETURN NEW; END $$`);
  if (kind === "insert") {
    await db.migrator.query("CREATE TRIGGER t_demora BEFORE INSERT ON chat.interaction FOR EACH ROW EXECUTE FUNCTION public.demora_prueba()");
  } else {
    await db.migrator.query(
      "CREATE CONSTRAINT TRIGGER t_demora AFTER INSERT ON chat.interaction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.demora_prueba()");
  }
}

test("camino normal: commit confirmado devuelve responseId, estado confirmada y una sola escritura", async () => {
  const { db, rec } = await setup();
  try {
    const r = await saveInteractionDetailed(rec, {}, db.chat, budget(5000));
    assert.equal(r.state, "confirmada");
    assert.match(r.responseId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(await rows(db), 1);
  } finally { await db.close(); }
});

test("pool ocupado: no hay ID, termina dentro del presupuesto y la conexión tardía se libera", async () => {
  const { db, rec } = await setup();
  try {
    const held = await Promise.all(Array.from({ length: 4 }, () => db.chat.connect()));
    const t0 = Date.now();
    const r = await saveInteractionDetailed(rec, {}, db.chat, budget(300));
    const elapsed = Date.now() - t0;
    assert.notEqual(r.state, "confirmada");
    assert.equal(r.responseId, undefined);
    assert.ok(elapsed < 800, `terminó en ${elapsed} ms`);
    held.forEach(c => c.release());
    await sleep(150);
    assert.ok(settled(db), `conexiones sin liberar: total=${db.chat.totalCount} idle=${db.chat.idleCount} waiting=${db.chat.waitingCount}`);
    assert.equal(await rows(db), 0, "no se escribió tarde");
  } finally { await db.close(); }
});

test("consulta lenta: cancelación efectiva en el servidor, rollback y conexión disponible", async () => {
  const { db, rec } = await setup();
  try {
    await installSleepTrigger(db, "insert", 3);
    const t0 = Date.now();
    const r = await saveInteractionDetailed(rec, {}, db.chat, budget(400));
    assert.notEqual(r.state, "confirmada");
    assert.ok(Date.now() - t0 < 1000);
    await sleep(150);
    const active = await db.migrator.query("SELECT count(*)::int n FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query ILIKE '%INSERT INTO chat.interaction%' AND state = 'active'");
    assert.equal(active.rows[0].n, 0, "la sentencia lenta ya no sigue viva en el servidor");
    assert.ok(settled(db));
    assert.equal(await rows(db), 0);
  } finally { await db.close(); }
});

test("lock lento: lock_timeout acotado por el presupuesto, sin escritura tardía", async () => {
  const { db, rec } = await setup();
  try {
    const holder = await db.migrator.connect();
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE chat.interaction IN ACCESS EXCLUSIVE MODE");
    const t0 = Date.now();
    const r = await saveInteractionDetailed(rec, {}, db.chat, budget(400));
    const elapsed = Date.now() - t0;
    assert.notEqual(r.state, "confirmada");
    assert.ok(elapsed < 1000, `terminó en ${elapsed} ms`);
    await holder.query("ROLLBACK");
    holder.release();
    await sleep(150);
    assert.equal(await rows(db), 0, "al liberar el lock no aparece una fila fantasma");
    assert.ok(settled(db));
  } finally { await db.close(); }
});

test("commit lento: statement_timeout no cubre el COMMIT, así que queda indeterminado: sin ID y sin reintento", async () => {
  const { db, rec } = await setup();
  try {
    await installSleepTrigger(db, "commit", 2);
    const t0 = Date.now();
    const r = await saveInteractionDetailed(rec, {}, db.chat, budget(500));
    // PostgreSQL desactiva statement_timeout antes de confirmar: solo el cliente puede acotar el COMMIT.
    assert.equal(r.state, "indeterminada");
    assert.equal(r.responseId, undefined);
    assert.equal(r.attempts, 1);
    assert.ok(Date.now() - t0 < 1200, `terminó en ${Date.now() - t0} ms`);
    await sleep(2500);
    // Resultado desconocido: la fila puede existir, pero nunca duplicada por un reenvío.
    assert.ok(await rows(db) <= 1);
    assert.ok(settled(db));
  } finally { await db.close(); }
});

test("commit indeterminado: sin ID, sin reintento, conexión descartada", async () => {
  const { db, rec } = await setup();
  try {
    await installSleepTrigger(db, "commit", 2);
    const pending = saveInteractionDetailed(rec, {}, db.chat, budget(8000));
    // Corta la conexión mientras el COMMIT está en curso: el cliente no puede saber el resultado.
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      const { rows: a } = await db.migrator.query(
        "SELECT pid FROM pg_stat_activity WHERE usename = 'chat_app' AND state = 'active' AND query ILIKE 'COMMIT%'");
      if (a.length) { await db.migrator.query("SELECT pg_terminate_backend($1)", [a[0].pid]); break; }
    }
    const r = await pending;
    assert.equal(r.state, "indeterminada");
    assert.equal(r.responseId, undefined);
    assert.equal(r.attempts, 1);
    await sleep(100);
    assert.equal(await rows(db), 0);
  } finally { await db.close(); }
});

test("cancelación por señal (cliente desconectado): rollback y no hay ID", async () => {
  const { db, rec } = await setup();
  try {
    await installSleepTrigger(db, "insert", 3);
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("client_disconnected")), 150);
    const t0 = Date.now();
    const r = await saveInteractionDetailed(rec, {}, db.chat, budget(8000, ac.signal));
    assert.equal(r.state, "cancelada");
    assert.equal(r.responseId, undefined);
    assert.ok(Date.now() - t0 < 1000);
    await sleep(150);
    assert.equal(await rows(db), 0);
    assert.ok(settled(db));
  } finally { await db.close(); }
});
