/** Pool del panel (rol `admin_app`): identidad, contactos, auditoría. */
import pg from "pg";
import { setting } from "../services/settings.js";
import { safeErrorCode } from "../services/safeLog.js";

let pool: pg.Pool | undefined;

export function adminPool(): pg.Pool {
  if (!pool) {
    const url = process.env.ADMIN_DATABASE_URL;
    if (!url) throw new Error("Falta ADMIN_DATABASE_URL.");
    pool = new pg.Pool({ connectionString: url, max: setting("adminPoolMax"), idleTimeoutMillis: 30_000,
      statement_timeout: 10_000 });
    pool.on("error", e => console.warn(`[admin-db] conexión inactiva perdida: ${safeErrorCode(e)}`));
  }
  return pool;
}

export function setAdminPoolForTests(p: pg.Pool | undefined): void { pool = p; }

export async function closeAdminPool(): Promise<void> { await pool?.end(); pool = undefined; }

/** Transacción acotada del panel; revierte ante cualquier error. */
export async function adminTx<T>(fn: (c: pg.PoolClient) => Promise<T>, db: pg.Pool = adminPool()): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}
