import test from "node:test";
import assert from "node:assert/strict";
import { createChatAdminDb } from "./chatAdminDb.js";
import { applyChatAdminMigrations } from "../../src/chat/migrate.js";
import { PASS } from "./chatAdminDb.js";

test("el migrador es idempotente y los roles del runtime no tienen DDL ni escritura sobre KB", async () => {
  const db = await createChatAdminDb();
  try {
    assert.deepEqual(await applyChatAdminMigrations(db.migrator, PASS), []);
    const { rows } = await db.migrator.query("SELECT nombre FROM chat.schema_migrations ORDER BY 1");
    assert.ok(rows.length >= 2);
    await assert.rejects(db.chat.query("CREATE TABLE chat.x (a int)"), /permission denied|no existe|denied/i);
    await assert.rejects(db.chat.query("CREATE TABLE public.x (a int)"), /permission denied/i);
    await assert.rejects(db.admin.query("DROP TABLE admin.audit"), /must be owner|permission denied/i);
    await assert.rejects(db.chat.query("UPDATE admin.contact_meta SET revision = 9"), /permission denied/i);
    const r = await db.chat.query("SELECT revision FROM admin.contact_meta");
    assert.equal(Number(r.rows[0].revision), 0);
  } finally { await db.close(); }
});

test("sobre una base existente con kb ya creado, las migraciones no tocan kb", async () => {
  const db = await createChatAdminDb({ migrate: false });
  try {
    await db.migrator.query("CREATE SCHEMA kb; CREATE TABLE kb.demo (a int); INSERT INTO kb.demo VALUES (1)");
    await applyChatAdminMigrations(db.migrator, PASS);
    const r = await db.migrator.query("SELECT a FROM kb.demo");
    assert.equal(r.rowCount, 1);
    await assert.rejects(db.chat.query("SELECT * FROM kb.demo"), /permission denied/i);
  } finally { await db.close(); }
});

test("contraseñas cortas se rechazan antes de crear roles", async () => {
  const db = await createChatAdminDb({ migrate: false });
  try {
    await assert.rejects(applyChatAdminMigrations(db.migrator, { ...PASS, chatApp: "corta" }), /contraseña/);
  } finally { await db.close(); }
});
