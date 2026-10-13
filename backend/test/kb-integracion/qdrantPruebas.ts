/**
 * Utilidades de Qdrant para las pruebas de integración: alias propio por
 * archivo (en un Qdrant compartido) y un embedder sintético determinista.
 */
import { createHash, randomBytes } from "node:crypto";
import { QDRANT_URL_PRUEBAS } from "./helpers.js";

/** Apunta el cliente al Qdrant de pruebas y reserva un alias único. Devuelve el alias. */
export function prepararQdrantDePrueba(): string {
  process.env.QDRANT_URL = QDRANT_URL_PRUEBAS;
  const alias = `kbprueba_${randomBytes(4).toString("hex")}`;
  process.env.KB_QDRANT_ALIAS = alias;
  return alias;
}

/**
 * Vector de 384 dimensiones derivado del hash del texto, normalizado. No tiene
 * semántica: sirve para probar la mecánica de indexación sin cargar el modelo.
 */
export async function embedderSintetico(textos: string[]): Promise<number[][]> {
  return textos.map(texto => {
    const semilla = createHash("sha256").update(texto).digest();
    const v = Array.from({ length: 384 }, (_, i) => (semilla[i % 32] - 128) / 128 + Math.sin(i));
    const norma = Math.hypot(...v);
    return v.map(x => x / norma);
  });
}
