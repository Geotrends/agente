/**
 * Contraseñas del panel: argon2id con sal única por hash (RF-C3-AD-09/10, RNF-C3-AD-02).
 *
 * Parámetros de ingeniería documentados en research.md: 65536 KiB, 3 pasadas, 1 hilo.
 * Largo mínimo 12 y ninguna regla de composición. La contraseña nunca se registra.
 */
import argon2 from "argon2";

export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;
export const MIN_PASSWORD_LENGTH = 12;

export type PasswordCheck = { ok: true } | { ok: false; mensaje: string };

export function checkNewPassword(password: unknown, temporal?: string): PasswordCheck {
  if (typeof password !== "string") return { ok: false, mensaje: "La contraseña es obligatoria." };
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return { ok: false, mensaje: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }
  if (temporal !== undefined && password === temporal) {
    return { ok: false, mensaje: "La nueva contraseña debe ser distinta de la temporal." };
  }
  return { ok: true };
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try { return await argon2.verify(phc, password); } catch { return false; }
}

/** PHC ficticio válido para igualar el tiempo cuando la cuenta no existe. */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
  return (decoy ??= hashPassword("contraseña-señuelo-no-usada"));
}
