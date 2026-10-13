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
