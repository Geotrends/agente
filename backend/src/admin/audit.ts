/**
 * Auditoría append-only del panel (RF-C3-AD-41). Nunca recibe contenido confidencial
 * (contraseñas, PHC, textos de documentos ni de ciudadanos): solo actor, acción, objeto y resultado.
 */
import type pg from "pg";
import { adminPool } from "./db.js";

export type AuditEntry = {
  /** Cuenta del panel; null solo cuando el actor es un rol operativo (`actorRole`). */
  actor: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  result: "ok" | "rechazado" | "error";
  /** Rol real de base de datos cuando no hay cuenta (recuperación reservada). */
  actorRole?: string | null;
};

/** Se escribe con el mismo cliente de la mutación, para que ambas sean atómicas. */
export async function writeAudit(db: pg.Pool | pg.PoolClient, e: AuditEntry, at?: Date): Promise<void> {
  await db.query(
    `INSERT INTO admin.audit (actor_account_id, actor_db_role, action, object_type, object_id, result, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))`,
    [e.actor, e.actorRole ?? null, e.action, e.objectType, e.objectId ?? null, e.result, at ?? null]);
}

/**
 * Rechazo ocurrido dentro de una transacción que se revirtió: la mutación no se aplica, pero el
 * intento queda auditado en una transacción propia y corta. Un fallo de la auditoría nunca oculta
 * el error original (de mejor esfuerzo, registra solo el código).
 */
export async function auditAfterRollback(e: AuditEntry, db: pg.Pool = adminPool()): Promise<void> {
  try {
    await writeAudit(db, { ...e, result: e.result === "ok" ? "rechazado" : e.result });
  } catch (error) {
    console.error("[admin-audit] no se pudo auditar el rechazo:", (error as { code?: string }).code ?? "error");
  }
}
