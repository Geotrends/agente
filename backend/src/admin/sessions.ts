/**
 * Sesiones opacas del panel (RNF-C3-AD-01/05). El token vive solo en la cookie; en
 * PostgreSQL queda su hash. La inactividad se mide por solicitudes reales: cada
 * lectura válida renueva `last_request_at`. La base es la autoridad y no hay caché ni copia
 * en memoria: una revocación es efectiva en la solicitud siguiente y, si la base no permite
 * validar la sesión, el panel responde 503 sin datos (RNF-C3-AD-01, plan: sin overlay).
 */
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { adminPool } from "./db.js";

export const SESSION_IDLE_MS = 30 * 60_000;
/** Vigencia absoluta (SPEC008, FR-018): una sesión vence a las 8 h de su creación aunque tenga actividad. */
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60_000;
export const COOKIE_NAME = "geobot_admin";

export const adminClock: { now: () => number } = { now: () => Date.now() };

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** CSRF derivado del token de sesión: no hace falta guardarlo en claro y GET /session puede devolverlo. */
export const csrfFor = (token: string): string => createHash("sha256").update(`csrf:${token}`).digest("base64url");

export type Perfil = "administrador técnico" | "Gestor documental";

export type SessionInfo = {
  accountId: string;
  email: string;
  displayName: string;
  perfil: Perfil;
  mustChangePassword: boolean;
  tokenHash: string;
};

export async function createSession(accountId: string, db: pg.Pool | pg.PoolClient = adminPool()): Promise<{ token: string; csrf: string }> {
  const token = randomBytes(32).toString("base64url");
  const csrf = csrfFor(token);
  const at = new Date(adminClock.now());
  await db.query(
    `INSERT INTO admin.session (token_hash, account_id, csrf_token_hash, created_at, last_request_at, absolute_expires_at)
     VALUES ($1, $2, $3, $4, $4, $5)`,
    [sha256(token), accountId, sha256(csrf), at, new Date(at.getTime() + SESSION_ABSOLUTE_MS)]);
  return { token, csrf };
}

/** Devuelve la sesión vigente y renueva su actividad; null si no existe, expiró o fue revocada. */
export async function touchSession(token: string, db: pg.Pool = adminPool()): Promise<SessionInfo | null> {
  const now = new Date(adminClock.now());
  const cutoff = new Date(adminClock.now() - SESSION_IDLE_MS);
  const { rows } = await db.query(
    `UPDATE admin.session s SET last_request_at = $2
       FROM admin.account a
      WHERE s.token_hash = $1 AND a.id = s.account_id AND a.active
        AND s.revoked_at IS NULL AND s.last_request_at > $3 AND s.absolute_expires_at > $2
      RETURNING a.id, a.email, a.display_name, a.profile, a.must_change_password`,
    [sha256(token), now, cutoff]);
  if (!rows.length) return null;
  const r = rows[0];
  return { accountId: r.id, email: r.email, displayName: r.display_name, perfil: r.profile,
    mustChangePassword: r.must_change_password, tokenHash: sha256(token) };
}

export async function revokeSession(token: string, db: pg.Pool = adminPool()): Promise<void> {
  await db.query("UPDATE admin.session SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
    [sha256(token), new Date(adminClock.now())]);
}

export async function revokeAccountSessions(accountId: string, exceptToken?: string, db: pg.Pool | pg.PoolClient = adminPool()): Promise<void> {
  await db.query(
    "UPDATE admin.session SET revoked_at = $2 WHERE account_id = $1 AND revoked_at IS NULL AND token_hash <> COALESCE($3, '')",
    [accountId, new Date(adminClock.now()), exceptToken ? sha256(exceptToken) : null]);
}

/** ¿La sesión sigue vigente (no revocada ni vencida)? Lectura sin renovar actividad (cancela exportaciones). */
export async function sessionActive(token: string, db: pg.Pool = adminPool()): Promise<boolean> {
  const cutoff = new Date(adminClock.now() - SESSION_IDLE_MS);
  const { rowCount } = await db.query(
    `SELECT 1 FROM admin.session s JOIN admin.account a ON a.id = s.account_id
      WHERE s.token_hash = $1 AND a.active AND s.revoked_at IS NULL AND s.last_request_at > $2
        AND s.absolute_expires_at > $3`, [sha256(token), cutoff, new Date(adminClock.now())]);
  return !!rowCount;
}

export function csrfMatches(token: string, presented: string | undefined): boolean {
  return !!presented && presented === csrfFor(token);
}

export function readCookie(header: string | undefined, name = COOKIE_NAME): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || undefined;
  }
  return undefined;
}
