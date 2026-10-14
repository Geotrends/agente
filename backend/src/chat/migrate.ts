/**
 * Migrador del esquema de chat y administración (T007/T008).
 *
 * Corre con una cuenta administradora de PostgreSQL, NUNCA con los roles del
 * runtime. Crea (si faltan) el propietario sin login `chat_owner` y los roles
 * limitados `chat_app`, `admin_app` y `chat_maint`; cada migración se aplica con
 * `SET LOCAL ROLE chat_owner` dentro de su transacción y queda anotada en
 * `chat.schema_migrations`, registro separado del de la base de conocimiento.
 * Es idempotente y sirve igual sobre un volumen limpio que sobre uno existente.
 * No toca `kb.*` ni `public`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const CHAT_MIGRACIONES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations/chat");

export type RolePasswords = { chatApp: string; adminApp: string; chatMaint: string };

const IDENT = /^[a-z_][a-z0-9_]*$/;

async function ensureRole(db: pg.Pool, name: string, password: string | null): Promise<void> {
  if (!IDENT.test(name)) throw new Error(`rol inválido: ${name}`);
  const { rowCount } = await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
  if (!rowCount) await db.query(`CREATE ROLE ${name} ${password === null ? "NOLOGIN" : "LOGIN"}`);
  if (password !== null) {
    // Las contraseñas no admiten parámetros en CREATE/ALTER ROLE: se escapan como literal.
    const literal = (await db.query<{ q: string }>("SELECT quote_literal($1) AS q", [password])).rows[0].q;
    await db.query(`ALTER ROLE ${name} LOGIN PASSWORD ${literal}`);
  }
  // Roles del runtime nunca superusuario, sin DDL de base ni creación de roles.
  await db.query(`ALTER ROLE ${name} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
}

export async function applyChatAdminMigrations(
  db: pg.Pool,
  passwords: RolePasswords,
  dir: string = CHAT_MIGRACIONES_DIR,
): Promise<string[]> {
  for (const [key, value] of Object.entries(passwords)) {
    if (!value || value.length < 12) throw new Error(`Falta una contraseña de al menos 12 caracteres para ${key}`);
  }
  await ensureRole(db, "chat_owner", null);
  await ensureRole(db, "chat_app", passwords.chatApp);
  await ensureRole(db, "admin_app", passwords.adminApp);
  await ensureRole(db, "chat_maint", passwords.chatMaint);
  // Rol operativo reservado de la recuperación de cuentas (RF-C3-AD-12/13). Sin login hasta que el
  // operador lo habilite fuera del runtime; solo ejecuta el procedimiento admin.recover_password.
  await ensureRole(db, "contractor_recovery", null);

  // btree_gist permite la restricción de no solapamiento de tarifas; solo un superusuario la crea.
  await db.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
  for (const schema of ["chat", "admin"]) {
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema} AUTHORIZATION chat_owner`);
    // search_path de los roles limitados: solo sus esquemas, nunca `public`.
  }
  await db.query("ALTER ROLE chat_app SET search_path = chat, admin");
  await db.query("ALTER ROLE admin_app SET search_path = admin, chat");
  await db.query("ALTER ROLE chat_maint SET search_path = chat, admin");
  await db.query(`CREATE TABLE IF NOT EXISTS chat.schema_migrations (
    nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`);
  await db.query("ALTER TABLE chat.schema_migrations OWNER TO chat_owner");

  const archivos = (await fs.readdir(dir)).filter(n => /^\d{3}_.+\.sql$/.test(n)).sort();
  const { rows } = await db.query<{ nombre: string }>("SELECT nombre FROM chat.schema_migrations");
  const hechas = new Set(rows.map(r => r.nombre));
  const nuevas: string[] = [];
  for (const nombre of archivos) {
    if (hechas.has(nombre)) continue;
    const sql = await fs.readFile(path.join(dir, nombre), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE chat_owner");
      await client.query(sql);
      await client.query("INSERT INTO chat.schema_migrations (nombre) VALUES ($1)", [nombre]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    nuevas.push(nombre);
  }
  await grantKbAccessToPanel(db);
  return nuevas;
}

/**
 * El panel integra el estado del scraper y los avisos de la base de conocimiento. Los
 * permisos son exactos y se aplican en cada corrida (idempotente, con la cuenta
 * administradora): leer corridas y avisos, y marcar un aviso como revisado. Nada más de `kb`.
 */
async function grantKbAccessToPanel(db: pg.Pool): Promise<void> {
  const { rowCount } = await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'kb' AND table_name = 'kb_notificacion'");
  if (!rowCount) return;
  await db.query("GRANT USAGE ON SCHEMA kb TO admin_app");
  await db.query("GRANT SELECT ON kb.kb_corrida, kb.kb_notificacion TO admin_app");
  await db.query("GRANT UPDATE (estado, revisada_por, revisada_en) ON kb.kb_notificacion TO admin_app");
  // SPEC007 (migración KB 005): matriz administrativa, operaciones y carga manual. Se repite aquí
  // porque el migrador de chat puede correr antes o después de que el kb-worker aplique la 005.
  const nuevo = await db.query("SELECT to_regclass('kb.v_matriz_admin') AS v");
  if (nuevo.rows[0].v) {
    await db.query("GRANT SELECT ON kb.v_matriz_admin, kb.document_operation, kb.document_removal, kb.active_generation, kb.kb_auditoria, kb.document_identity TO admin_app");
    await db.query("GRANT UPDATE (revision) ON kb.kb_notificacion TO admin_app");
    await db.query(`GRANT INSERT (kind, actor_account_id, element_id, expected_revision, idempotency_key, payload_hash, payload)
                      ON kb.document_operation TO admin_app`);
    // SPEC008 (migración KB 007): objetivo de la publicación y reanudación de operaciones.
    const spec008 = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'kb' AND table_name = 'document_operation' AND column_name = 'target_version_id'");
    if (spec008.rowCount) {
      await db.query("GRANT INSERT (target_version_id) ON kb.document_operation TO admin_app");
      await db.query("GRANT EXECUTE ON FUNCTION kb.version_pendiente_de(uuid) TO admin_app");
      await db.query("GRANT UPDATE (cleanup_attempts, next_attempt_at, needs_attention) ON kb.document_operation TO admin_app");
    }
    await db.query(`GRANT EXECUTE ON FUNCTION kb.registrar_carga_manual(uuid, text, text, text, kb.tipo_elemento, kb.direccion,
                      text, text, date, date, text[], text, char, text, jsonb) TO admin_app`);
    await db.query("GRANT EXECUTE ON FUNCTION kb.editar_metadata_documento(uuid, bigint, text, jsonb, uuid) TO admin_app");
  }
  // SPEC007 (migración KB 006): propuestas y enlaces del scraper.
  const fuentes = await db.query("SELECT to_regclass('kb.scraper_link') AS v");
  if (fuentes.rows[0].v) {
    await db.query("GRANT SELECT ON kb.scraper_link, kb.scraper_link_list, kb.link_proposal TO admin_app");
    for (const f of [
      "kb.proponer_enlace(uuid, text, text, text, kb.direccion, text)", "kb.retirar_propuesta(uuid, uuid, bigint)",
      "kb.decidir_propuesta(uuid, uuid, text, bigint, boolean, text, text)",
      "kb.agregar_enlace_directo(uuid, text, text, text, kb.direccion, text, bigint)",
      "kb.quitar_enlace_directo(uuid, text, uuid, text, bigint, bigint)",
    ]) await db.query(`GRANT EXECUTE ON FUNCTION ${f} TO admin_app`);
  }
}
