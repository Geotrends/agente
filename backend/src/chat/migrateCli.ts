/**
 * Aplica las migraciones de chat/admin. Uso (ver quickstart):
 *   CHAT_MIGRATOR_URL=postgres://… CHAT_DB_PASSWORD=… ADMIN_DB_PASSWORD=… MAINT_DB_PASSWORD=… \
 *     node --import tsx scripts/migrate-chat-admin.ts
 * Las contraseñas llegan por entorno, nunca por argumentos ni salen en los logs.
 */
import pg from "pg";
import { applyChatAdminMigrations } from "./migrate.js";

const url = process.env.CHAT_MIGRATOR_URL;
if (!url) { console.error("Falta CHAT_MIGRATOR_URL."); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  const nuevas = await applyChatAdminMigrations(pool, {
    chatApp: process.env.CHAT_DB_PASSWORD ?? "",
    adminApp: process.env.ADMIN_DB_PASSWORD ?? "",
    chatMaint: process.env.MAINT_DB_PASSWORD ?? "",
  });
  console.log(nuevas.length ? `Migraciones aplicadas: ${nuevas.join(", ")}` : "Chat/admin ya estaba al día.");
} catch (error) {
  console.error("Migración fallida:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
