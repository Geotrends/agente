/**
 * Registro de contactos oficiales: validadores y snapshot transaccional
 * (RF-C3-DI-19/20/24, RF-C3-AD-35/36/37, RF-C3-IN-10).
 *
 * Nunca hay valores por defecto ni contactos escritos en el código. El snapshot se
 * lee en una sola transacción de lectura y SIN caché: una edición guardada aparece
 * en la consulta siguiente.
 */
import type pg from "pg";
import { runBounded, type Budget } from "../chat/boundedDb.js";
import type { CanalInmediato, ContactSnapshot } from "../chat/contracts.js";
import { writeAudit } from "./audit.js";
import { adminTx } from "./db.js";

export const MAX_DESCRIPTION = 120;
const PHONE = /^[0-9 +()-]*[0-9][0-9 +()-]*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HTTPS = /^https:\/\/\S+$/;

export const isPhone = (v: unknown): v is string => typeof v === "string" && PHONE.test(v);
export const isEmail = (v: unknown): v is string => typeof v === "string" && EMAIL.test(v);
export const isHttpsUrl = (v: unknown): v is string => {
  if (typeof v !== "string" || !HTTPS.test(v)) return false;
  try { return new URL(v).protocol === "https:"; } catch { return false; }
};

export type FieldError = { campo: string; mensaje: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; error: FieldError };

const fail = (campo: string, mensaje: string): { ok: false; error: FieldError } => ({ ok: false, error: { campo, mensaje } });

export type Reception = ContactSnapshot["recepcion"];
export type General = ContactSnapshot["general"];
export type ImmediateInput = Omit<CanalInmediato, "id" | "position">;

export function validateReception(body: unknown): Validated<Reception> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isHttpsUrl(b.pqrsd)) return fail("pqrsd", "Indique una URL https válida para PQRSD.");
  if (!isPhone(b.whatsapp)) return fail("whatsapp", "Use solo dígitos, espacios y los símbolos + - ( ), con al menos un dígito.");
  if (!isEmail(b.email)) return fail("email", "Indique un correo electrónico válido.");
  return { ok: true, value: { pqrsd: b.pqrsd, whatsapp: b.whatsapp, email: b.email } };
}

export function validateGeneral(body: unknown): Validated<General> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isPhone(b.phone)) return fail("phone", "Use solo dígitos, espacios y los símbolos + - ( ), con al menos un dígito.");
  if (!isEmail(b.email)) return fail("email", "Indique un correo electrónico válido.");
  if (!isHttpsUrl(b.url)) return fail("url", "Indique una URL https válida.");
  return { ok: true, value: { phone: b.phone, email: b.email, url: b.url } };
}

export function validateImmediate(body: unknown): Validated<ImmediateInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return fail("name", "El nombre es obligatorio.");
  if (typeof b.description !== "string" || !b.description.trim()) return fail("description", "La descripción es obligatoria.");
  if ([...b.description.trim()].length > MAX_DESCRIPTION) return fail("description", `Máximo ${MAX_DESCRIPTION} caracteres.`);
  if (b.type !== "teléfono" && b.type !== "correo" && b.type !== "url") return fail("type", "El tipo debe ser teléfono, correo o url.");
  const ok = b.type === "teléfono" ? isPhone(b.value) : b.type === "correo" ? isEmail(b.value) : isHttpsUrl(b.value);
  if (!ok) return fail("value", `El valor no es un ${b.type} válido.`);
  return { ok: true, value: { name: b.name.trim(), description: b.description.trim(), type: b.type, value: b.value as string } };
}

/** Lista de IDs completa, sin duplicados y que coincida con la existente. */
export function validateOrder(body: unknown, existing: string[]): Validated<string[]> {
  const ids = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || ids.some(i => typeof i !== "string")) return fail("ids", "Envíe la lista completa de identificadores.");
  if (new Set(ids).size !== ids.length) return fail("ids", "La lista tiene identificadores repetidos.");
  if (ids.length !== existing.length || !existing.every(id => ids.includes(id))) {
    return fail("ids", "La lista debe contener exactamente los canales existentes.");
  }
  return { ok: true, value: ids as string[] };
}

/**
 * Lee el registro completo en una transacción REPEATABLE READ de solo lectura.
 * Devuelve `null` si falta algún valor oficial (servicio no preparado): nunca inventa.
 */
type Reader = { query(text: string, values?: unknown[]): Promise<pg.QueryResult> };

/** Lee las cuatro tablas de contactos con la conexión dada; devuelve null si falta un valor oficial. */
async function readTables(c: Reader): Promise<ContactSnapshot | null> {
  const meta = await c.query("SELECT revision FROM admin.contact_meta WHERE id = 1");
  const rec = await c.query("SELECT pqrsd_url, whatsapp, email FROM admin.contact_reception");
  const gen = await c.query("SELECT phone, email, contact_url FROM admin.contact_general");
  const imm = await c.query(
    "SELECT id, name, description, type, value, position FROM admin.contact_immediate ORDER BY position");
  if (!meta.rowCount || !rec.rowCount || !gen.rowCount || !imm.rowCount) return null;
  return {
    revision: Number(meta.rows[0].revision),
    recepcion: { pqrsd: rec.rows[0].pqrsd_url, whatsapp: rec.rows[0].whatsapp, email: rec.rows[0].email },
    general: { phone: gen.rows[0].phone, email: gen.rows[0].email, url: gen.rows[0].contact_url },
    inmediatos: imm.rows.map(r => ({ id: r.id, name: r.name, description: r.description, type: r.type, value: r.value, position: r.position })),
  };
}

export class ContactReadError extends Error {
  constructor(readonly state: string, readonly reason: string) { super("contactos_no_disponibles"); this.name = "ContactReadError"; }
}

/**
 * Lee el snapshot transaccional vigente. Con `budget` la adquisición, las sentencias y el cierre
 * respetan el tiempo restante (la lectura de contactos no puede retrasar un error ni la config).
 * Un fallo lanza `ContactReadError`; un valor oficial faltante devuelve `null`: nunca inventa.
 */
export async function readContactSnapshot(db: pg.Pool, budget?: Budget): Promise<ContactSnapshot | null> {
  if (budget) {
    const out = await runBounded(db, budget, async client => {
      // Una sola vista consistente aunque el panel edite durante la lectura.
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return readTables(client);
    });
    if (out.state !== "confirmada") throw new ContactReadError(out.state, out.reason);
    return out.value;
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = await readTables(client);
    await client.query("COMMIT");
    return snapshot;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

// ── Mutaciones con control de revisión y auditoría atómica (T035) ───────────

export class RevisionConflictError extends Error {
  constructor() { super("revision_obsoleta"); this.name = "RevisionConflictError"; }
}
export class ContactValidationError extends Error {
  constructor(readonly campo: string, readonly mensaje: string) { super(mensaje); this.name = "ContactValidationError"; }
}
export class ContactNotFoundError extends Error {
  constructor() { super("no_encontrado"); this.name = "ContactNotFoundError"; }
}

function unwrap<T>(v: Validated<T>): T {
  if (!v.ok) throw new ContactValidationError(v.error.campo, v.error.mensaje);
  return v.value;
}

function parseRevision(raw: unknown): number {
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new ContactValidationError("revision", "Indique la revisión que está editando.");
  return n;
}

/** Compare-and-swap de la revisión: si otra edición se adelantó, no cambia nada. */
async function bump(c: pg.PoolClient, revision: number, actor: string): Promise<number> {
  const r = await c.query(
    "UPDATE admin.contact_meta SET revision = revision + 1, updated_at = now(), updated_by = $2 WHERE id = 1 AND revision = $1 RETURNING revision",
    [revision, actor]);
  if (!r.rowCount) throw new RevisionConflictError();
  return Number(r.rows[0].revision);
}

/** Traduce violaciones de restricciones de la BD a un error de campo en vez de un 500. */
async function mutate<T>(fn: (c: pg.PoolClient) => Promise<T>, db?: pg.Pool): Promise<T> {
  try {
    return await adminTx(fn, db);
  } catch (e) {
    const code = (e as { code?: string }).code;
    // Solo restricciones del propio registro; un fallo de la auditoría debe abortar como error interno.
    if (code === "23514" && (e as { table?: string }).table?.startsWith("contact_")) throw new ContactValidationError("valor", (e as Error).message.includes("vacía") ? "La lista de canales inmediatos no puede quedar vacía." : "El valor no cumple el formato permitido.");
    throw e;
  }
}

export async function saveReception(actor: string, body: unknown, db?: pg.Pool): Promise<number> {
  const b = (body ?? {}) as Record<string, unknown>;
  const revision = parseRevision(b.revision);
  const v = unwrap(validateReception(b));
  return mutate(async c => {
    const rev = await bump(c, revision, actor);
    await c.query(
      `INSERT INTO admin.contact_reception (id, pqrsd_url, whatsapp, email) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET pqrsd_url = EXCLUDED.pqrsd_url, whatsapp = EXCLUDED.whatsapp, email = EXCLUDED.email`,
      [v.pqrsd, v.whatsapp, v.email]);
    await writeAudit(c, { actor, action: "contactos.recepcion.editar", objectType: "contactos", objectId: "recepcion", result: "ok" });
    return rev;
  }, db);
}

export async function saveGeneral(actor: string, body: unknown, db?: pg.Pool): Promise<number> {
  const b = (body ?? {}) as Record<string, unknown>;
  const revision = parseRevision(b.revision);
  const v = unwrap(validateGeneral(b));
  return mutate(async c => {
    const rev = await bump(c, revision, actor);
    await c.query(
      `INSERT INTO admin.contact_general (id, phone, email, contact_url) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone, email = EXCLUDED.email, contact_url = EXCLUDED.contact_url`,
      [v.phone, v.email, v.url]);
    await writeAudit(c, { actor, action: "contactos.general.editar", objectType: "contactos", objectId: "general", result: "ok" });
    return rev;
  }, db);
}

export async function addImmediate(actor: string, body: unknown, db?: pg.Pool): Promise<{ revision: number; id: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const revision = parseRevision(b.revision);
  const v = unwrap(validateImmediate(b));
  return mutate(async c => {
    const rev = await bump(c, revision, actor);
    const r = await c.query(
      `INSERT INTO admin.contact_immediate (name, description, type, value, position)
       VALUES ($1, $2, $3, $4, COALESCE((SELECT max(position) FROM admin.contact_immediate), 0) + 1) RETURNING id`,
      [v.name, v.description, v.type, v.value]);
    await writeAudit(c, { actor, action: "contactos.inmediato.crear", objectType: "contacto_inmediato", objectId: r.rows[0].id, result: "ok" });
    return { revision: rev, id: r.rows[0].id as string };
  }, db);
}

export async function updateImmediate(actor: string, id: string, body: unknown, db?: pg.Pool): Promise<number> {
  const b = (body ?? {}) as Record<string, unknown>;
  const revision = parseRevision(b.revision);
  const v = unwrap(validateImmediate(b));
  return mutate(async c => {
    const rev = await bump(c, revision, actor);
    const r = await c.query(
      "UPDATE admin.contact_immediate SET name = $2, description = $3, type = $4, value = $5 WHERE id = $1",
      [id, v.name, v.description, v.type, v.value]);
    if (!r.rowCount) throw new ContactNotFoundError();
    await writeAudit(c, { actor, action: "contactos.inmediato.editar", objectType: "contacto_inmediato", objectId: id, result: "ok" });
    return rev;
  }, db);
}

export async function deleteImmediate(actor: string, id: string, revisionRaw: unknown, db?: pg.Pool): Promise<number> {
  const revision = parseRevision(revisionRaw);
  return mutate(async c => {
    const rev = await bump(c, revision, actor);
    const r = await c.query("DELETE FROM admin.contact_immediate WHERE id = $1", [id]);
    if (!r.rowCount) throw new ContactNotFoundError();
    // Reasigna posiciones consecutivas; la restricción única es diferida.
    await c.query(`UPDATE admin.contact_immediate t SET position = n.pos
                     FROM (SELECT id, row_number() OVER (ORDER BY position) AS pos FROM admin.contact_immediate) n WHERE t.id = n.id`);
    await writeAudit(c, { actor, action: "contactos.inmediato.eliminar", objectType: "contacto_inmediato", objectId: id, result: "ok" });
    return rev;
  }, db);
}

export async function reorderImmediate(actor: string, body: unknown, db?: pg.Pool): Promise<number> {
  const b = (body ?? {}) as Record<string, unknown>;
  const revision = parseRevision(b.revision);
  return mutate(async c => {
    const existing = (await c.query("SELECT id FROM admin.contact_immediate")).rows.map(r => r.id as string);
    const ids = unwrap(validateOrder(b, existing));
    const rev = await bump(c, revision, actor);
    for (const [i, id] of ids.entries()) await c.query("UPDATE admin.contact_immediate SET position = $2 WHERE id = $1", [id, i + 1]);
    await writeAudit(c, { actor, action: "contactos.inmediato.ordenar", objectType: "contactos", objectId: "inmediatos", result: "ok" });
    return rev;
  }, db);
}
