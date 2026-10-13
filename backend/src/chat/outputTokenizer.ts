/**
 * Contador de tokens de salida (RNF-C3-DI-03). Offline y determinista.
 *
 * Los dos modelos usan la codificación oficial `o200k_harmony`, cuyos tokens ORDINARIOS son
 * los de `o200k_base`; lo único que cambia son los tokens especiales, que aquí se tratan como
 * texto (equivale a `tiktoken.encode_ordinary`) y no se añaden marcadores estructurales.
 * La paridad de IDs con el oráculo oficial en Python (`scripts/tokenizer-oracle.py`) es el
 * gate: `npm run eval:tokenizer`. Ninguna aproximación por palabras o caracteres, ni
 * CountTokens (no soportado por estos modelos). No hay tráfico de red: los rangos viajan en
 * el paquete fijado.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";

/** Artefacto fijado: paquete exacto y huella del archivo de rangos. */
export const TOKENIZER_PIN = {
  encoding: "o200k_harmony",
  package: "js-tiktoken@1.0.21",
  ranksSha256: "a9e8a0c1f332c58f1a9cef2f8d7be59b31bb4b42531a3a0a64d9ad3b3d19033b",
} as const;

let encoder: Tiktoken | undefined;
const enc = (): Tiktoken => (encoder ??= new Tiktoken(o200kBase));

/** IDs de los tokens ordinarios del texto (especiales como texto literal). */
export function encodeIds(text: string): number[] {
  return enc().encode(text, [], []);
}

export function countTokens(text: string): number {
  return encodeIds(text).length;
}

/** true si el archivo de rangos cargado coincide con la huella fijada (readiness). */
export function tokenizerArtifactMatchesPin(): boolean {
  try {
    const file = fileURLToPath(import.meta.resolve("js-tiktoken/ranks/o200k_base"));
    return createHash("sha256").update(readFileSync(file)).digest("hex") === TOKENIZER_PIN.ranksSha256;
  } catch {
    return false;
  }
}
