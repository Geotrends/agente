/**
 * Base PostgreSQL de prueba con esquemas chat/admin y roles limitados (T007).
 * Usa el mismo migrador que producción; cada llamada crea su propia base.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { applyChatAdminMigrations } from "../../src/chat/migrate.js";

// El bloqueo por IP del panel guarda solo un HMAC con un secreto estable de la instalación (SPEC007).
process.env.ADMIN_IP_HMAC_SECRET ??= "secreto-hmac-de-pruebas-0123456789abcdef";

export const ADMIN_URL = process.env.KB_TEST_ADMIN_URL || "postgres://geobot_admin:dev-admin@localhost:55432/geobot_test";
export const PASS = { chatApp: "chat-app-pruebas-123", adminApp: "admin-app-pruebas-123", chatMaint: "chat-maint-pruebas-123" };

function withDb(url: string, db: string, user?: string, pass?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) { u.username = user; u.password = pass ?? ""; }
  return u.toString();
}

export type ChatAdminDb = {
  name: string;
  migratorUrl: string;
  migrator: pg.Pool;
  chat: pg.Pool;
  admin: pg.Pool;
  maint: pg.Pool;
  close: () => Promise<void>;
};

export async function createChatAdminDb(opts: { migrate?: boolean; existingDb?: string } = {}): Promise<ChatAdminDb> {
  const name = opts.existingDb ?? `chat_prueba_${randomBytes(4).toString("hex")}`;
  if (!opts.existingDb) {
    const root = new pg.Client({ connectionString: ADMIN_URL });
    await root.connect();
    try {
      await root.query(`CREATE DATABASE ${name}`);
    } finally { await root.end(); }
  }
  const migratorUrl = withDb(ADMIN_URL, name);
  const migrator = new pg.Pool({ connectionString: migratorUrl, max: 2 });
  await migrator.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
  if (opts.migrate !== false) await applyChatAdminMigrations(migrator, PASS);
  const chat = new pg.Pool({ connectionString: withDb(ADMIN_URL, name, "chat_app", PASS.chatApp), max: 4 });
  const admin = new pg.Pool({ connectionString: withDb(ADMIN_URL, name, "admin_app", PASS.adminApp), max: 8 });
  const maint = new pg.Pool({ connectionString: withDb(ADMIN_URL, name, "chat_maint", PASS.chatMaint), max: 2 });
  return {
    name, migratorUrl, migrator, chat, admin, maint,
    close: async () => {
      await Promise.all([chat.end(), admin.end(), maint.end(), migrator.end()]);
      const r = new pg.Client({ connectionString: ADMIN_URL });
      await r.connect();
      try { await r.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } finally { await r.end(); }
    },
  };
}

/** Base con el esquema `kb` real (migraciones de la KB) más chat/admin: prueba los permisos del panel sobre la KB. */
export async function createChatAdminDbWithKb(): Promise<ChatAdminDb & { kb: import("../../src/kb/db.js").Pool }> {
  const { crearBaseDePrueba } = await import("../kb-integracion/helpers.js");
  const base = await crearBaseDePrueba();
  const db = await createChatAdminDb({ existingDb: base.nombre });
  const close = db.close;
  return {
    ...db, kb: base.kb,
    close: async () => {
      await Promise.all([db.chat.end(), db.admin.end(), db.maint.end(), db.migrator.end()]);
      await base.borrar();
      void close;
    },
  };
}
