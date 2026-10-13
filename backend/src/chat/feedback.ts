/**
 * Valoración de respuestas (RF-C3-IN-09, RF-C4-IN-05). Validación estricta del cuerpo y registro
 * atómico mediante `chat.register_rating`. Cualquier causa de rechazo (ID inexistente, ajeno,
 * depurado o anónimo, segunda valoración, motivo indebido) produce la MISMA respuesta uniforme.
 */
import type pg from "pg";
import { runBounded, type Budget } from "./boundedDb.js";
import { chatPool } from "./db.js";
import { bindingHash, isUuidV4 } from "./conversations.js";

export const VALORACIONES = ["Útil", "No útil"] as const;
export const MOTIVOS = [
  "Información incorrecta", "Información desactualizada", "No responde mi pregunta", "Difícil de entender", "Otro",
] as const;

export type RatingRequest = { responseId: string; valoracion: (typeof VALORACIONES)[number]; motivo: (typeof MOTIVOS)[number] | null };
export type RatingValidation = { ok: true; value: RatingRequest } | { ok: false };

const PERMITIDOS = new Set(["responseId", "valoracion", "motivo"]);

/** Solo `responseId`, `valoracion` y `motivo`; cualquier otra propiedad (texto libre incluido) se rechaza. */
export function validateRatingRequest(body: unknown): RatingValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!PERMITIDOS.has(k)) return { ok: false };
  if (!isUuidV4(b.responseId)) return { ok: false };
  if (b.valoracion !== "Útil" && b.valoracion !== "No útil") return { ok: false };
  if (b.valoracion === "Útil") {
    // «Útil» exige motivo OMITIDO; incluso `null` es inválido.
    if ("motivo" in b) return { ok: false };
    return { ok: true, value: { responseId: b.responseId, valoracion: "Útil", motivo: null } };
  }
  if (typeof b.motivo !== "string" || !(MOTIVOS as readonly string[]).includes(b.motivo)) return { ok: false };
  return { ok: true, value: { responseId: b.responseId, valoracion: "No útil", motivo: b.motivo as RatingRequest["motivo"] } };
}

export class RatingStoreError extends Error {
  constructor(readonly reason: string) { super("valoracion_no_confirmada"); this.name = "RatingStoreError"; }
}

/**
 * Registra la valoración; devuelve true solo si se escribió y el commit quedó CONFIRMADO. Con
 * `budget`, un resultado no confirmado a tiempo (pool, bloqueo de purga, commit) lanza
 * `RatingStoreError`: el 201 nunca sale tarde ni sin confirmación.
 */
export async function registerRating(subject: string, r: RatingRequest, db: pg.Pool = chatPool(), budget?: Budget): Promise<boolean> {
  const sql = "SELECT chat.register_rating($1::uuid, $2, $3, $4) AS ok";
  const params = [r.responseId, bindingHash(subject), r.valoracion, r.motivo];
  if (!budget) {
    const { rows } = await db.query<{ ok: boolean }>(sql, params);
    return rows[0]?.ok === true;
  }
  const out = await runBounded(db, budget, async c => (await c.query<{ ok: boolean }>(sql, params)).rows);
  if (out.state !== "confirmada") throw new RatingStoreError(out.reason);
  return out.value[0]?.ok === true;
}
