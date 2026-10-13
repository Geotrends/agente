/**
 * T062 · concurrencia, permisos mínimos, purga y migración de `chat.valoracion` (RF-C3-IN-09,
 * RNF-C3-IN-01, constitución VII) sobre PostgreSQL real.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, authorizedAnswer, countRows, post, queueAnswers, sessionToken, startUiApp } from "./app.js";
import { createChatAdminDb, PASS } from "../di-integracion/chatAdminDb.js";
import { applyChatAdminMigrations } from "../../src/chat/migrate.js";
import { purgeChat } from "../../src/chat/retention.js";

test("dos envíos simultáneos de la misma respuesta: una fila, un 201 y un VALIDACION", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 1);
    const tk = await sessionToken(c);
    const rid = await authorizedAnswer(c, tk, await authorize(c, tk));
    for (let ronda = 0; ronda < 3; ronda++) {
      const body = { responseId: rid, valoracion: "No útil", motivo: "Otro" };
      const rs = await Promise.all([post(c, "/ratings", tk, body), post(c, "/ratings", tk, body)]);
      const estados = rs.map(r => r.status).sort();
      if (ronda === 0) assert.deepEqual(estados, [201, 400]);
      else assert.deepEqual(estados, [400, 400], "las rondas siguientes ya son duplicado");
    }
    assert.equal(await countRows(c, "valoracion"), 1);
  } finally { await c.close(); }
});

test("el runtime no tiene INSERT directo, UPDATE, DELETE ni DDL sobre valoración; tampoco lee interacciones", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 1);
    const tk = await sessionToken(c);
    const rid = await authorizedAnswer(c, tk, await authorize(c, tk));
    assert.equal((await post(c, "/ratings", tk, { responseId: rid, valoracion: "Útil" })).status, 201);
    const denegado = async (sql: string, pool = c.db.chat) => {
      await assert.rejects(() => pool.query(sql), /permission denied|must be owner/i, sql);
    };
    await denegado("INSERT INTO chat.valoracion (interaction_row_id, valoracion) VALUES (1, 'Útil')");
    await denegado("UPDATE chat.valoracion SET valoracion = 'No útil', motivo = 'Otro'");
    await denegado("DELETE FROM chat.valoracion");
    await denegado("SELECT * FROM chat.valoracion");
    await denegado("TRUNCATE chat.valoracion");
    await denegado("ALTER TABLE chat.valoracion ADD COLUMN comentario text");
    await denegado("CREATE TABLE chat.otra (x int)");
    await denegado("SELECT response_id FROM chat.interaction");
    // La función es la única vía; admin_app y mantenimiento solo leen la estadística, sin modificarla.
    await denegado("UPDATE chat.valoracion SET motivo = NULL", c.db.admin);
    await denegado("DELETE FROM chat.valoracion", c.db.maint);
    assert.equal((await c.db.admin.query("SELECT count(*)::int n FROM chat.valoracion")).rows[0].n, 1);
  } finally { await c.close(); }
});

test("la purga de 12 meses no la bloquea la FK: textos e IDs se vacían y la estadística de valoración permanece", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 2);
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    const r1 = await authorizedAnswer(c, tk, conv, "uno");
    const r2 = await authorizedAnswer(c, tk, conv, "dos");
    assert.equal((await post(c, "/ratings", tk, { responseId: r1, valoracion: "No útil", motivo: "Difícil de entender" })).status, 201);
    const en13Meses = new Date(Date.now() + 13 * 30 * 86_400_000);
    const res = await purgeChat(c.db.maint, en13Meses);
    assert.equal(res.rowsPurged, 2);
    // Estadística conservada sin identificadores públicos ni texto.
    const v = await c.db.migrator.query(
      `SELECT v.valoracion, v.motivo, i.response_id, i.question_text, i.conversation_id FROM chat.valoracion v JOIN chat.interaction i ON i.row_id = v.interaction_row_id`);
    assert.equal(v.rows.length, 1);
    assert.deepEqual(v.rows[0], { valoracion: "No útil", motivo: "Difícil de entender", response_id: null, question_text: null, conversation_id: null });
    // Sobre una respuesta depurada ya no se puede valorar.
    assert.equal((await post(c, "/ratings", tk, { responseId: r2, valoracion: "Útil" })).status, 400);
    // Segunda purga idempotente.
    assert.equal((await purgeChat(c.db.maint, en13Meses)).rowsPurged, 0);
  } finally { await c.close(); }
});

test("carrera purga/valoración: nunca queda una valoración sobre una fila con texto ya depurado y sin ID", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 6);
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await authorizedAnswer(c, tk, conv, `q${i}`));
    const en13 = new Date(Date.now() + 13 * 30 * 86_400_000);
    const [, ...rs] = await Promise.all([
      purgeChat(c.db.maint, en13),
      ...ids.map(id => post(c, "/ratings", tk, { responseId: id, valoracion: "Útil" })),
    ]);
    for (const r of rs) assert.ok([201, 400].includes(r.status));
    const incoherentes = await c.db.migrator.query(
      `SELECT count(*)::int n FROM chat.valoracion v JOIN chat.interaction i ON i.row_id = v.interaction_row_id
        WHERE i.purged_at IS NOT NULL AND i.response_id IS NOT NULL`);
    assert.equal(incoherentes.rows[0].n, 0);
  } finally { await c.close(); }
});

test("migraciones 007 y 008: base limpia, base existente con 001–006 y segunda ejecución idempotente", async () => {
  // Limpia: todo el catálogo en orden.
  const limpia = await createChatAdminDb();
  try {
    const nombres = (await limpia.migrator.query("SELECT nombre FROM chat.schema_migrations ORDER BY nombre")).rows.map(r => r.nombre);
    // 007 y 008 siguen aplicándose en orden; migraciones posteriores (SPEC007: 009…) se suman al final.
    assert.ok(nombres.indexOf("007_valoracion.sql") >= 0 && nombres.indexOf("007_valoracion.sql") + 1 === nombres.indexOf("008_eventos_servicio.sql"));
    assert.deepEqual(await applyChatAdminMigrations(limpia.migrator, PASS), [], "segunda ejecución sin cambios");
  } finally { await limpia.close(); }

  // Existente: base con 001–006 ya aplicadas y datos; 007 y 008 se añaden sin tocarlos.
  const db = await createChatAdminDb({ migrate: false });
  try {
    await db.migrator.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "../../migrations/chat");
    const tmp = await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "mig-"));
    for (const f of (await fs.readdir(dir)).filter(n => /^00[1-6]_/.test(n))) await fs.copyFile(path.join(dir, f), path.join(tmp, f));
    const previas = await applyChatAdminMigrations(db.migrator, PASS, tmp);
    assert.equal(previas.length, 6);
    await db.migrator.query(`INSERT INTO chat.conversation (conversation_id, authorized_at, policy_version, transport_binding_hash) VALUES (gen_random_uuid(), now(), 'v', 'h')`);
    const nuevas = await applyChatAdminMigrations(db.migrator, PASS);
    const esperadas = (await fs.readdir(dir)).filter(n => /^\d{3}_.+\.sql$/.test(n) && Number(n.slice(0, 3)) >= 7).sort();
    assert.deepEqual(nuevas, esperadas);
    assert.deepEqual(esperadas.slice(0, 2), ["007_valoracion.sql", "008_eventos_servicio.sql"]);
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.conversation")).rows[0].n, 1, "los datos previos siguen");
    assert.deepEqual(await applyChatAdminMigrations(db.migrator, PASS), []);
  } finally { await db.close(); }
});

// ── SPEC005 · C309 (T028) ────────────────────────────────────────────────────────────────────

test("bloqueo de purga más largo que el presupuesto: 503 sin 201 tardío ni fila al liberar el lock", async () => {
  const c = await startUiApp();
  const previo = process.env.CHAT_DEADLINE_MS;
  try {
    queueAnswers(c, 1);
    const tk = await sessionToken(c);
    const rid = await authorizedAnswer(c, tk, await authorize(c, tk));
    process.env.CHAT_DEADLINE_MS = "5000";
    // La purga tiene la fila bloqueada (FOR UPDATE): la valoración espera su FOR SHARE.
    const holder = await c.db.migrator.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM chat.interaction WHERE response_id = $1::uuid FOR UPDATE", [rid]);
    const t0 = Date.now();
    const r = await post(c, "/ratings", tk, { responseId: rid, valoracion: "Útil" });
    const ms = Date.now() - t0;
    assert.equal(r.status, 503);
    assert.match(r.headers.get("cache-control") ?? "", /no-store/);
    assert.ok(ms < 5_500, `respondió en ${ms} ms, dentro del plazo`);
    await holder.query("ROLLBACK");
    holder.release();
    await new Promise(res => setTimeout(res, 200));
    assert.equal(await countRows(c, "valoracion"), 0, "la espera cancelada no escribe después");
    // Con la fila libre, el reintento manual sí se registra.
    assert.equal((await post(c, "/ratings", tk, { responseId: rid, valoracion: "Útil" })).status, 201);
  } finally {
    if (previo === undefined) delete process.env.CHAT_DEADLINE_MS; else process.env.CHAT_DEADLINE_MS = previo;
    await c.close();
  }
});
