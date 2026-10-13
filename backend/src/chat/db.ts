/** Pool del runtime de chat (rol `chat_app`): sin DDL ni escritura sobre la KB. */
import pg from "pg";
import { setting } from "../services/settings.js";
import { safeErrorCode } from "../services/safeLog.js";

let pool: pg.Pool | undefined;

export function chatPool(): pg.Pool {
  if (!pool) {
    const url = process.env.CHAT_DATABASE_URL;
    if (!url) throw new Error("Falta CHAT_DATABASE_URL.");
    pool = new pg.Pool({ connectionString: url, max: setting("chatPoolMax"), idleTimeoutMillis: 30_000,
      statement_timeout: 10_000 });
    pool.on("error", e => console.warn(`[chat-db] conexión inactiva perdida: ${safeErrorCode(e)}`));
  }
  return pool;
}

export function setChatPoolForTests(p: pg.Pool | undefined): void { pool = p; }

export async function closeChatPool(): Promise<void> { await pool?.end(); pool = undefined; }
