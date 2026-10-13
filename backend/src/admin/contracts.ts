/**
 * Contratos comunes del panel (T006): forma de errores, paginación y tipos de salida compartidos.
 * Los DTO específicos de cada historia viven junto a su servicio.
 */
export type { Perfil } from "./validation.js";

/** Cuerpo de error uniforme; nunca lleva SQL, trazas, secretos ni texto ciudadano. */
export type AdminErrorBody = { error: { codigo: string; mensaje: string; campo?: string } };

export const adminError = (codigo: string, mensaje: string, campo?: string): AdminErrorBody =>
  ({ error: { codigo, mensaje, ...(campo ? { campo } : {}) } });

/** Error de dominio con estado HTTP y código de catálogo; nunca lleva detalle interno. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly codigo: string, readonly mensaje: string, readonly campo?: string) {
    super(`${codigo}: ${mensaje}`);
    this.name = "ApiError";
  }
}

export type Page<T> = { items: T[]; total: number; nextCursor: string | null };

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function pageSize(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,3}$/.test(raw) ? Number(raw) : DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(n, 1), MAX_PAGE_SIZE);
}

/** Cursor opaco base64url de un par (marca de tiempo ISO, id). */
export function encodeCursor(parts: Array<string | number>): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

export function decodeCursor(raw: unknown): Array<string | number> | null {
  if (typeof raw !== "string" || !raw || raw.length > 512) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(v) && v.every(x => typeof x === "string" || typeof x === "number") ? v : null;
  } catch { return null; }
}

/** Estados visibles del documento (data-model T029). */
export const ESTADOS_DOCUMENTO = ["Pendiente de aprobación", "Publicado", "Vencido", "Derogado"] as const;
export type EstadoDocumento = typeof ESTADOS_DOCUMENTO[number];
