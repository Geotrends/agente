/**
 * Inicio de sesión y cambio de contraseña del panel (RF-C3-AD-08/09/10, RNF-C3-AD-04/06).
 *
 * Reglas: 5 fallos consecutivos de una cuenta la bloquean 15 min y generan un aviso de sistema;
 * 20 fallos de una IP en 15 min la bloquean 15 min y se rechaza ANTES de verificar la contraseña;
 * un éxito reinicia los contadores. El 401 es idéntico para cuenta inexistente, contraseña
 * errónea, cuenta desactivada o bloqueada.
 *
 * Los contadores viven en PostgreSQL y se actualizan bajo candados de fila en orden IP → cuenta:
 * sobreviven a un reinicio y no pierden incrementos ante intentos concurrentes. La IP solo se
 * guarda como HMAC con un secreto estable de la instalación.
 */
import { createHmac, randomBytes } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";
import type pg from "pg";
import { adminPool } from "./db.js";
import { writeAudit } from "./audit.js";
import { emitNotification } from "./notificationEvents.js";
import { checkNewPassword, decoyHash, hashPassword, verifyPassword } from "./passwords.js";
import { adminClock, createSession, revokeAccountSessions } from "./sessions.js";

export const ACCOUNT_MAX_FAILURES = 5;
export const ACCOUNT_LOCK_MS = 15 * 60_000;
export const IP_MAX_FAILURES = 20;
export const IP_WINDOW_MS = 15 * 60_000;
export const IP_LOCK_MS = 15 * 60_000;

/** El estado de los bloqueos ya no vive en memoria; se conserva por compatibilidad de las pruebas. */
export function resetIpThrottle(): void { /* sin estado en memoria */ }

export type LoginResult =
  | { ok: true; token: string; csrf: string; accountId: string; perfil: string; displayName: string; mustChangePassword: boolean }
  | { ok: false; status: 401 }
  | { ok: false; status: 429; retryAfterSeconds: number };

let ephemeralSecret: string | undefined;

/**
 * Secreto estable de la instalación para derivar la clave de bloqueo por IP. En producción es
 * obligatorio ADMIN_IP_HMAC_SECRET y NO se reutiliza AUTH_JWT_SECRET (SPEC008, FR-018): una clave de
 * firma de sesiones anónimas no debe servir además de pepper de las IP del panel. Fuera de
 * producción se admite AUTH_JWT_SECRET, o uno efímero por proceso en desarrollo sin ninguno.
 */
function ipHmacSecret(): string {
  const configured = process.env.ADMIN_IP_HMAC_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("Falta ADMIN_IP_HMAC_SECRET.");
  if (process.env.AUTH_JWT_SECRET) return process.env.AUTH_JWT_SECRET;
  return (ephemeralSecret ??= randomBytes(32).toString("hex"));
}

/**
 * La clave de bloqueo agrupa IPv6 por /64: un cliente con un /64 propio dispone de 2⁶⁴ direcciones y
 * rotarlas no debe reiniciar el contador. IPv4 no cambia.
 */
function ipKey(ip: string): string {
  const secret = ipHmacSecret();
  const normalizada = ipKeyGenerator(ip || "desconocida", 64);
  return createHmac("sha256", secret).update(`admin-ip:${normalizada}`).digest("hex");
}

const UNIFORM: LoginResult = { ok: false, status: 401 };

async function recordIpFailure(c: pg.PoolClient, key: string, failures: Date[], now: number): Promise<void> {
  const recent = failures.filter(t => now - t.getTime() < IP_WINDOW_MS);
  recent.push(new Date(now));
  const block = recent.length >= IP_MAX_FAILURES;
  await c.query(
    "UPDATE admin.login_ip_guard SET failures = $2, blocked_until = $3, updated_at = $4 WHERE ip_key = $1",
    [key, block ? [] : recent, block ? new Date(now + IP_LOCK_MS) : null, new Date(now)]);
}

export async function login(email: unknown, password: unknown, ip: string, db: pg.Pool = adminPool()): Promise<LoginResult> {
  const key = ipKey(ip);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const now = adminClock.now();
    await client.query("INSERT INTO admin.login_ip_guard (ip_key, updated_at) VALUES ($1, $2) ON CONFLICT DO NOTHING", [key, new Date(now)]);
    const guard = (await client.query<{ failures: Date[]; blocked_until: Date | null }>(
      "SELECT failures, blocked_until FROM admin.login_ip_guard WHERE ip_key = $1 FOR UPDATE", [key])).rows[0];
    if (guard.blocked_until && new Date(guard.blocked_until).getTime() > now) {
      await client.query("COMMIT");
      return { ok: false, status: 429, retryAfterSeconds: Math.max(1, Math.ceil((new Date(guard.blocked_until).getTime() - now) / 1000)) };
    }
    const failures = (guard.failures ?? []).map(t => new Date(t));

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      await recordIpFailure(client, key, failures, now);
      await client.query("COMMIT");
      return UNIFORM;
    }
    const acc = (await client.query(
      `SELECT id, email, display_name, profile, active, password_phc, must_change_password, failed_attempts, locked_until
         FROM admin.account WHERE email = lower(btrim($1)) FOR UPDATE`, [email])).rows[0];
    const locked = acc?.locked_until && new Date(acc.locked_until).getTime() > now;
    if (!acc || !acc.active || locked) {
      // Se verifica igualmente para igualar el tiempo de respuesta.
      await verifyPassword(acc && acc.active ? acc.password_phc : await decoyHash(), password);
      await recordIpFailure(client, key, failures, now);
      await client.query("COMMIT");
      return UNIFORM;
    }
    if (!(await verifyPassword(acc.password_phc, password))) {
      const count = acc.failed_attempts + 1;
      const lock = count >= ACCOUNT_MAX_FAILURES;
      await client.query(
        "UPDATE admin.account SET failed_attempts = $2, locked_until = $3, updated_at = $4 WHERE id = $1",
        [acc.id, lock ? 0 : count, lock ? new Date(now + ACCOUNT_LOCK_MS) : null, new Date(now)]);
      if (lock) {
        await emitNotification(client, {
          type: "cuenta_bloqueada", objectType: "cuenta", objectId: acc.id, at: new Date(now),
          description: `Cuenta ${acc.email} bloqueada 15 minutos por cinco intentos fallidos de ingreso.`,
        });
        await writeAudit(client, { actor: acc.id, action: "cuenta.bloqueo", objectType: "cuenta", objectId: acc.id, result: "rechazado" }, new Date(now));
      }
      await recordIpFailure(client, key, failures, now);
      await client.query("COMMIT");
      return UNIFORM;
    }
    await client.query("UPDATE admin.account SET failed_attempts = 0, locked_until = NULL, updated_at = $2 WHERE id = $1",
      [acc.id, new Date(now)]);
    await client.query("UPDATE admin.login_ip_guard SET failures = '{}', blocked_until = NULL, updated_at = $2 WHERE ip_key = $1",
      [key, new Date(now)]);
    const { token, csrf } = await createSession(acc.id, client);
    await writeAudit(client, { actor: acc.id, action: "sesion.inicio", objectType: "cuenta", objectId: acc.id, result: "ok" }, new Date(now));
    await client.query("COMMIT");
    // Limpieza oportunista: filas sin ventana ni bloqueo vigentes.
    void db.query(
      "DELETE FROM admin.login_ip_guard WHERE updated_at < $1 AND (blocked_until IS NULL OR blocked_until < $2)",
      [new Date(now - IP_WINDOW_MS), new Date(now)]).catch(() => {});
    return { ok: true, token, csrf, accountId: acc.id, perfil: acc.profile, displayName: acc.display_name,
      mustChangePassword: acc.must_change_password };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export type ChangePasswordResult = { ok: true } | { ok: false; campo: string; mensaje: string };

export async function changePassword(
  accountId: string, currentToken: string, current: unknown, next: unknown, db: pg.Pool = adminPool(),
): Promise<ChangePasswordResult> {
  if (typeof current !== "string" || !current) return { ok: false, campo: "currentPassword", mensaje: "La contraseña actual es obligatoria." };
  const { rows } = await db.query(
    "SELECT password_phc, must_change_password, email, failed_attempts, locked_until FROM admin.account WHERE id = $1", [accountId]);
  // Quien tiene una sesión robada no puede adivinar la contraseña actual sin límite (SPEC008): los
  // fallos cuentan con el mismo contador y bloqueo de cuenta que el ingreso.
  const ahora = adminClock.now();
  if (rows.length && rows[0].locked_until && new Date(rows[0].locked_until).getTime() > ahora) {
    return { ok: false, campo: "currentPassword", mensaje: "Demasiados intentos fallidos. Intente de nuevo en unos minutos." };
  }
  if (!rows.length || !(await verifyPassword(rows[0].password_phc, current))) {
    if (rows.length) {
      const cuenta = rows[0].failed_attempts + 1;
      const bloqueo = cuenta >= ACCOUNT_MAX_FAILURES;
      await db.query("UPDATE admin.account SET failed_attempts = $2, locked_until = $3, updated_at = $4 WHERE id = $1",
        [accountId, bloqueo ? 0 : cuenta, bloqueo ? new Date(ahora + ACCOUNT_LOCK_MS) : null, new Date(ahora)]);
      if (bloqueo) {
        await emitNotification(db, {
          type: "cuenta_bloqueada", objectType: "cuenta", objectId: accountId, at: new Date(ahora),
          description: `Cuenta ${rows[0].email} bloqueada 15 minutos por cinco intentos fallidos al cambiar la contraseña.`,
        });
        await writeAudit(db, { actor: accountId, action: "cuenta.bloqueo", objectType: "cuenta", objectId: accountId, result: "rechazado" }, new Date(ahora));
      }
    }
    return { ok: false, campo: "currentPassword", mensaje: "La contraseña actual no es correcta." };
  }
  const check = checkNewPassword(next, rows[0].must_change_password ? current : undefined);
  if (!check.ok) return { ok: false, campo: "newPassword", mensaje: check.mensaje };
  if (next === current) return { ok: false, campo: "newPassword", mensaje: "La nueva contraseña debe ser distinta de la actual." };
  const phc = await hashPassword(next as string);
  const at = new Date(adminClock.now());
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE admin.account SET password_phc = $2, must_change_password = false, failed_attempts = 0, revision = revision + 1, updated_at = $3 WHERE id = $1",
      [accountId, phc, at]);
    await revokeAccountSessions(accountId, currentToken, client);
    await writeAudit(client, { actor: accountId, action: "cuenta.cambio_contrasena", objectType: "cuenta", objectId: accountId, result: "ok" }, at);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  return { ok: true };
}
