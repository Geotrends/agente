/**
 * Utilidades de la medición de rendimiento del panel (SPEC007 T087, RNF-C3-AD-08).
 * p95 por «rango más cercano» (nearest-rank): con n = 20 es la 19.ª muestra ordenada.
 */

export function percentil95(muestrasMs: number[]): number {
  if (!muestrasMs.length) throw new Error("sin muestras");
  const orden = [...muestrasMs].sort((a, b) => a - b);
  const rango = Math.ceil(0.95 * orden.length);
  return orden[rango - 1];
}

export type ResumenPantalla = {
  pantalla: string; muestras: number; errores: number; p95Ms: number; maxMs: number; cumple: boolean;
};

export const UMBRAL_MS = 3_000;
export const PANTALLAS = [
  { id: "bandeja", ruta: "/pending?limit=25" },
  { id: "matriz", ruta: "/documents?limit=25" },
  { id: "notificaciones", ruta: "/notifications?limit=25" },
  { id: "auditoria", ruta: "/audit?limit=25" },
  { id: "tablero-uso", ruta: "/metrics/usage" },
  { id: "tablero-documentos", ruta: "/metrics/documents" },
  { id: "tablero-valoraciones", ruta: "/metrics/ratings" },
  { id: "tablero-consumo", ruta: "/metrics/consumption" },
] as const;

/** Resume una pantalla: los errores cuentan y un error nunca se omite del p95 ni se trata como rápido. */
export function resumir(pantalla: string, tiemposMs: number[], errores: number): ResumenPantalla {
  const total = tiemposMs.length + errores;
  // Cada error cuenta como una muestra fallida con el peor tiempo observado (más el umbral).
  const peor = tiemposMs.length ? Math.max(...tiemposMs) : UMBRAL_MS;
  const todas = [...tiemposMs, ...Array.from({ length: errores }, () => Math.max(peor, UMBRAL_MS + 1))];
  const p95 = percentil95(todas);
  return { pantalla, muestras: total, errores, p95Ms: p95, maxMs: Math.max(...todas), cumple: errores === 0 && p95 <= UMBRAL_MS };
}

export type VolumenRequerido = { documentos: number; interacciones: number; auditorias: number };
export const VOLUMEN_CONTRACTUAL: VolumenRequerido = { documentos: 1000, interacciones: 100_000, auditorias: 10_000 };

export function volumenCumple(real: VolumenRequerido, req: VolumenRequerido = VOLUMEN_CONTRACTUAL): string[] {
  const faltas: string[] = [];
  if (real.documentos < req.documentos) faltas.push(`documentos ${real.documentos} < ${req.documentos}`);
  if (real.interacciones < req.interacciones) faltas.push(`interacciones ${real.interacciones} < ${req.interacciones}`);
  if (real.auditorias < req.auditorias) faltas.push(`auditorías ${real.auditorias} < ${req.auditorias}`);
  return faltas;
}
