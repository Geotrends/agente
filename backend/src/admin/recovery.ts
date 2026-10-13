/**
 * Recuperación reservada de contraseña (RF-C3-AD-12/13).
 *
 * La utilidad privada (`scripts/recover-admin.ts`) llama a esta función con un pool que usa el rol
 * operativo `contractor_recovery`. El PHC argon2id se calcula localmente, el correo y el PHC
 * viajan como parámetros y NADA se registra. Si el procedimiento falla (correo inexistente),
 * PostgreSQL revierte y una segunda llamada, en sentencia aparte, deja una fila segura de error
 * en la auditoría: no se promete persistencia dentro de la transacción abortada.
 */
import type pg from "pg";
import { checkNewPassword, hashPassword } from "./passwords.js";

export type RecoveryResult =
  | { ok: true }
  | { ok: false; reason: "contrasena_no_valida" | "cuenta_inexistente" | "error" };

export async function recoverPassword(pool: pg.Pool, email: string, temporaryPassword: string): Promise<RecoveryResult> {
  const check = checkNewPassword(temporaryPassword);
  if (!check.ok) return { ok: false, reason: "contrasena_no_valida" };
  const phc = await hashPassword(temporaryPassword);
  const client = await pool.connect();
  try {
    try {
      await client.query("CALL admin.recover_password($1, $2)", [email, phc]);
      return { ok: true };
    } catch (error) {
      const code = (error as { code?: string }).code;
      const reason = code === "P0002" ? "cuenta_inexistente" : "error";
      // Sentencia aparte tras la reversión: auditoría segura del intento fallido.
      await client.query("CALL admin.record_recovery_failure($1)", [reason]);
      return { ok: false, reason };
    }
  } finally {
    client.release();
  }
}
