/**
 * Prioridad por categoría (RF-C4-DC-03): la dirección elegida por el ciudadano ordena primero
 * sus fragmentos, pero NUNCA excluye los de otras direcciones. Con una categoría ausente
 * ("No estoy seguro") el orden de la recuperación queda intacto.
 */
import type { Categoria } from "./contracts.js";
import type { RetrievedHit } from "./sources.js";

export function prioritizeByCategory<T extends Pick<RetrievedHit, "category">>(hits: T[], categoria?: Categoria): T[] {
  if (!categoria) return hits;
  const propios = hits.filter(h => h.category === categoria);
  if (propios.length === 0 || propios.length === hits.length) return hits;
  return [...propios, ...hits.filter(h => h.category !== categoria)];
}

const ES_PROCEDIMIENTO = /\bGT-P-\d+/i;

/** Un fragmento es de un procedimiento institucional (GT-P) si su código, título o ruta lo nombran. */
export const esProcedimiento = (h: Pick<RetrievedHit, "codigo" | "title" | "path">): boolean =>
  ES_PROCEDIMIENTO.test(h.codigo ?? "") || ES_PROCEDIMIENTO.test(h.title ?? "") || ES_PROCEDIMIENTO.test(h.path ?? "");

/**
 * Los procedimientos (GT-P) van antes que cualquier otra fuente, incluidas las páginas web: son la
 * versión oficial del trámite y, si el contexto se recorta por presupuesto, lo último en salir debe
 * ser lo menos autorizado. Orden estable: dentro de cada grupo se respeta el de la recuperación y de
 * la categoría. No excluye nada.
 */
export function prioritizeProcedures<T extends Pick<RetrievedHit, "codigo" | "title" | "path">>(hits: T[]): T[] {
  const procedimientos = hits.filter(esProcedimiento);
  if (procedimientos.length === 0 || procedimientos.length === hits.length) return hits;
  return [...procedimientos, ...hits.filter(h => !esProcedimiento(h))];
}
