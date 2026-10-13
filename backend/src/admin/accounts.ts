/**
 * Cuentas del panel (RF-C3-AD-05..11): alta, cambio de perfil/actividad y contraseña temporal.
 *
 * Todo cambio es una transacción con revisión optimista (CAS), revoca sesiones cuando cambia
 * algo sensible y deja auditoría atómica. La invariante «siempre ≥ 1 administrador técnico
 * activo» la sostiene un disparador de base con candado, también ante cambios concurrentes.
 * Nunca se devuelve ni registra PHC ni contraseña.
 */
import type pg from "pg";
import { adminPool, adminTx } from "./db.js";
import { writeAudit } from "./audit.js";
import { ApiError, DEFAULT_PAGE_SIZE, encodeCursor, decodeCursor, type Page } from "./contracts.js";
import { checkNewPassword, hashPassword } from "./passwords.js";
import { adminClock, revokeAccountSessions } from "./sessions.js";
import {
  parseBoolean, parseEmail, parseEnum, parseRevision, parseUuid, PERFILES, requiredText, strictObject, ValidationError,
  type Perfil,
} from "./validation.js";

export type AccountDto = {
  id: string;
  nombre: string;
  email: string;
  perfil: Perfil;
  activa: boolean;
  cambioObligatorio: boolean;
  revision: string;
  creadaEn: string;
};

type Row = {
  id: string; display_name: string; email: string; profile: Perfil; active: boolean;
  must_change_password: boolean; revision: string; created_at: Date;
};

const toDto = (r: Row): AccountDto => ({
  id: r.id, nombre: r.display_name, email: r.email, perfil: r.profile, activa: r.active,
  cambioObligatorio: r.must_change_password, revision: String(r.revision), creadaEn: new Date(r.created_at).toISOString(),
});

const COLUMNS = "id, display_name, email, profile, active, must_change_password, revision, created_at";

export async function listAccounts(query: { limit: number; cursor?: unknown }, db: pg.Pool = adminPool()): Promise<Page<AccountDto>> {
  const cur = decodeCursor(query.cursor);
  const limit = query.limit || DEFAULT_PAGE_SIZE;
  const total = Number((await db.query("SELECT count(*) FROM admin.account")).rows[0].count);
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM admin.account
      WHERE ($1::timestamptz IS NULL OR (created_at, id) > ($1::timestamptz, $2::uuid))
      ORDER BY created_at, id LIMIT $3`,
    [cur ? cur[0] : null, cur ? cur[1] : null, limit + 1]);
  const items = rows.slice(0, limit).map(toDto);
  const last = rows[limit - 1];
  return { items, total, nextCursor: rows.length > limit ? encodeCursor([new Date(last.created_at).toISOString(), last.id]) : null };
}

const PG_UNIQUE = "23505";
const PG_CHECK = "23514";

function isLastTechnical(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return e.code === PG_CHECK && /al menos un administrador/i.test(e.message ?? "");
}

function checkPassword(password: unknown, campo = "password"): string {
  if (typeof password !== "string") throw new ValidationError(campo, "La contraseña es obligatoria.");
  const c = checkNewPassword(password);
  if (!c.ok) throw new ValidationError(campo, c.mensaje);
  return password;
}

export async function createAccount(actor: string, body: unknown, db: pg.Pool = adminPool()): Promise<AccountDto> {
  const b = strictObject(body, ["nombre", "email", "perfil", "password"], ["nombre", "email", "perfil", "password"]);
  const nombre = requiredText(b.nombre, "nombre", 120);
  const email = parseEmail(b.email, "email");
  const perfil = parseEnum(b.perfil, PERFILES, "perfil");
  const password = checkPassword(b.password);
  const phc = await hashPassword(password);
  const at = new Date(adminClock.now());
  try {
    return await adminTx(async c => {
      const { rows } = await c.query<Row>(
        `INSERT INTO admin.account (email, display_name, profile, password_phc, must_change_password, created_at, updated_at)
         VALUES ($1,$2,$3,$4,true,$5,$5) RETURNING ${COLUMNS}`, [email, nombre, perfil, phc, at]);
      await writeAudit(c, { actor, action: "cuenta.crear", objectType: "cuenta", objectId: rows[0].id, result: "ok" }, at);
      return toDto(rows[0]);
    }, db);
  } catch (error) {
    if ((error as { code?: string }).code === PG_UNIQUE) {
      throw new ApiError(409, "CORREO_DUPLICADO", "Ya existe una cuenta con ese correo.", "email");
    }
    throw error;
  }
}

async function loadForUpdate(c: pg.PoolClient, id: string): Promise<Row> {
  const { rows } = await c.query<Row>(`SELECT ${COLUMNS} FROM admin.account WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows.length) throw new ApiError(404, "NO_ENCONTRADO", "La cuenta no existe.");
  return rows[0];
}

export async function updateAccount(actor: string, idRaw: unknown, body: unknown, db: pg.Pool = adminPool()): Promise<AccountDto> {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["expectedRevision", "active", "perfil"], ["expectedRevision"]);
  const expected = parseRevision(b.expectedRevision);
  const active = b.active === undefined ? undefined : parseBoolean(b.active, "active");
  const perfil = b.perfil === undefined ? undefined : parseEnum(b.perfil, PERFILES, "perfil");
  if (active === undefined && perfil === undefined) throw new ValidationError("cuerpo", "Indique active o perfil.");
  const at = new Date(adminClock.now());
  try {
    return await adminTx(async c => {
      const cur = await loadForUpdate(c, id);
      if (String(cur.revision) !== expected) throw new ApiError(409, "REVISION_OBSOLETA", "La cuenta cambió. Recargue y vuelva a intentar.");
      const nextActive = active ?? cur.active;
      const nextPerfil = perfil ?? cur.profile;
      if (nextActive === cur.active && nextPerfil === cur.profile) return toDto(cur); // sin cambio efectivo
      const { rows } = await c.query<Row>(
        `UPDATE admin.account SET active = $2, profile = $3, revision = revision + 1, updated_at = $4
          WHERE id = $1 RETURNING ${COLUMNS}`, [id, nextActive, nextPerfil, at]);
      // Desactivar o cambiar de perfil termina las sesiones abiertas; reactivar no las revive.
      await revokeAccountSessions(id, undefined, c);
      const action = nextActive !== cur.active ? (nextActive ? "cuenta.reactivar" : "cuenta.desactivar") : "cuenta.cambiar_perfil";
      await writeAudit(c, { actor, action, objectType: "cuenta", objectId: id, result: "ok" }, at);
      return toDto(rows[0]);
    }, db);
  } catch (error) {
    if (isLastTechnical(error)) {
      throw new ApiError(409, "ULTIMO_TECNICO", "Debe quedar al menos un administrador técnico activo.");
    }
    throw error;
  }
}

/** Contraseña temporal para OTRA cuenta (la propia se cambia con /password). */
export async function setTemporaryPassword(actor: string, idRaw: unknown, body: unknown, db: pg.Pool = adminPool()): Promise<AccountDto> {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["expectedRevision", "password"], ["expectedRevision", "password"]);
  const expected = parseRevision(b.expectedRevision);
  const password = checkPassword(b.password);
  if (id === actor) throw new ApiError(422, "VALIDACION", "Use el cambio de contraseña propio para su cuenta.", "id");
  const phc = await hashPassword(password);
  const at = new Date(adminClock.now());
  return adminTx(async c => {
    const cur = await loadForUpdate(c, id);
    if (String(cur.revision) !== expected) throw new ApiError(409, "REVISION_OBSOLETA", "La cuenta cambió. Recargue y vuelva a intentar.");
    const { rows } = await c.query<Row>(
      `UPDATE admin.account SET password_phc = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL,
              revision = revision + 1, updated_at = $3 WHERE id = $1 RETURNING ${COLUMNS}`, [id, phc, at]);
    await revokeAccountSessions(id, undefined, c);
    await writeAudit(c, { actor, action: "cuenta.contrasena_temporal", objectType: "cuenta", objectId: id, result: "ok" }, at);
    return toDto(rows[0]);
  }, db);
}
