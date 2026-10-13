/**
 * Acceso a PostgreSQL del kb-worker y runner de migraciones (research R13).
 *
 * El kb-worker es el único escritor de la matriz: se conecta como `kb_writer`,
 * dueño del esquema `kb`. El backend del chat NO usa este módulo: tiene su
 * propio pool de solo lectura (`app_reader`) en services/documentLinks.ts.
 *
 * Las migraciones son archivos SQL numerados en `backend/migrations/`. Cada
 * una se aplica dentro de su propia transacción y queda registrada en
 * `kb.schema_migrations`; correr el runner dos veces no hace nada la segunda.
 * Sin framework de migraciones: para un esquema de una decena de tablas no
 * compensa la dependencia.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/** `src/kb/` y `dist/kb/` están ambos dos niveles por debajo de `backend/`. */
export const MIGRACIONES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

let pool: pg.Pool | undefined;

/** Pool compartido del kb-worker sobre `KB_DATABASE_URL`. */
export function kbPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.KB_DATABASE_URL;
    if (!connectionString) throw new Error("Falta KB_DATABASE_URL: el kb-worker no puede conectarse a PostgreSQL.");
    pool = crearPool(connectionString);
  }
  return pool;
}

export function crearPool(connectionString: string): pg.Pool {
  const nuevo = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  // Un error en un cliente inactivo (p. ej. PostgreSQL reiniciado) no debe
  // tumbar el proceso: el siguiente uso del pool abre una conexión nueva.
  nuevo.on("error", error => console.warn(`[kb] Conexión inactiva de PostgreSQL perdida: ${error.message}`));
  return nuevo;
}

export async function cerrarPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Ejecuta `fn` dentro de una transacción; revierte ante cualquier error. */
export async function enTransaccion<T>(db: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Aplica, en orden de nombre, las migraciones que falten. Devuelve los nombres
 * aplicados en esta llamada (vacío si ya estaba al día).
 */
export async function aplicarMigraciones(db: pg.Pool = kbPool(), dir = MIGRACIONES_DIR): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS kb.schema_migrations (
    nombre text PRIMARY KEY,
    aplicada_en timestamptz NOT NULL DEFAULT now()
  )`);
  const archivos = (await fs.readdir(dir)).filter(nombre => /^\d{3}_.+\.sql$/.test(nombre)).sort();
  const { rows } = await db.query<{ nombre: string }>("SELECT nombre FROM kb.schema_migrations");
  const aplicadas = new Set(rows.map(r => r.nombre));
  const nuevas: string[] = [];
  for (const nombre of archivos) {
    if (aplicadas.has(nombre)) continue;
    const sql = await fs.readFile(path.join(dir, nombre), "utf8");
    await enTransaccion(db, async client => {
      await client.query(sql);
      await client.query("INSERT INTO kb.schema_migrations (nombre) VALUES ($1)", [nombre]);
    });
    nuevas.push(nombre);
  }
  return nuevas;
}
