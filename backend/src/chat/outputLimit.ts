/**
 * Abreviación y límite de la salida visible (RF-C3-DI-18, RNF-C3-DI-03).
 *
 * Se cuenta TODO el Markdown que verá la persona (avisos, canales, cuerpo con citas,
 * leyenda y cierre) con el tokenizador oficial. Si excede el tope —o el modelo se cortó por
 * `max_tokens`— se quitan unidades COMPLETAS del final (oración, ítem, tabla), nunca se parte
 * una URL, un enlace ni una tabla, se recalculan las fuentes con las referencias que quedan
 * y se añade el aviso exacto. Si ni siquiera cabe un contenido respaldado, falla de forma
 * segura: nunca se sube `maxTokens` ni se entrega una respuesta sin sustento.
 */
import { composeAnswer, type ComposeInput, type ComposeOutput } from "./composeAnswer.js";
import type { StopReason } from "./contracts.js";
import { countTokens } from "./outputTokenizer.js";

/** Tope contractual de la respuesta visible (RNF-C3-DI-03). Es independiente del `maxTokens` que se pide al modelo. */
export const VISIBLE_TOKEN_LIMIT = 2200;

export class OutputLimitError extends Error {
  constructor() { super("nada_respaldado_cabe"); this.name = "OutputLimitError"; }
}

type Unit = { joiner: string; text: string };

const PROTECT = /\[[^\]\n]*\]\([^)\s]*\)|https?:\/\/[^\s)]+/g;
const SENTENCE_BREAK = /(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“(\[\d*])/;

function splitSentences(paragraph: string): string[] {
  const saved: string[] = [];
  const masked = paragraph.replace(PROTECT, m => `\u0000${saved.push(m) - 1}\u0000`);
  return masked.split(SENTENCE_BREAK).map(part => part.replace(/\u0000(\d+)\u0000/g, (_a, i: string) => saved[Number(i)]));
}

const isTableLine = (l: string): boolean => l.includes("|");
const isListLine = (l: string): boolean => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l);

/** Unidades completas del cuerpo: oraciones, ítems de lista y tablas enteras. */
export function splitUnits(body: string): Unit[] {
  const units: Unit[] = [];
  const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const joinerBlock = units.length ? "\n\n" : "";
    const lines = block.split("\n");
    if (lines.every(isTableLine)) { units.push({ joiner: joinerBlock, text: block }); continue; }
    if (lines.some(isListLine)) {
      lines.forEach((line, i) => units.push({ joiner: i === 0 ? joinerBlock : "\n", text: line }));
      continue;
    }
    splitSentences(lines.join(" ")).forEach((sentence, i) => units.push({ joiner: i === 0 ? joinerBlock : " ", text: sentence }));
  }
  return units;
}

const join = (units: Unit[]): string => units.map(u => u.joiner + u.text).join("");

/** Una unidad está completa si termina en puntuación de cierre (ignorando referencias, comillas y paréntesis). */
export function isCompleteUnit(text: string): boolean {
  if (isTableLine(text)) return /\|\s*$/.test(text) && text.trim().split("\n").length >= 1;
  const t = text.replace(/\s?\[D\d+\]/g, "").replace(/[)"”»*_\]]+$/g, "").trimEnd();
  return /[.!?…:]$/.test(t) || isListLine(text) && t.length > 0 && !/[,;:\-–]$/.test(t);
}

const REF = /\[(D\d{1,3})\]/g;

export type LimitInput = Omit<ComposeInput, "body" | "abreviada"> & { body: string; stopReason: StopReason };
export type LimitOutput = ComposeOutput & { abreviada: boolean; visibleTokens: number };

export function composeWithinLimit(
  input: LimitInput, count: (t: string) => number = countTokens, max: number = VISIBLE_TOKEN_LIMIT,
): LimitOutput {
  const units = splitUnits(input.body);
  const hadRefs = [...input.body.matchAll(REF)].length > 0;

  const build = (n: number, abreviada: boolean): ComposeOutput => {
    const body = join(units.slice(0, n));
    const refs = new Set([...body.matchAll(REF)].map(m => m[1]));
    // Fuentes: las referenciadas en lo que queda; sin referencias en el original, las declaradas.
    const used = hadRefs ? input.used.filter(e => refs.has(e.alias)) : input.used;
    return composeAnswer({ ...input, body, used, abreviada });
  };

  /** Mayor número de unidades (≤ hi) que cabe con aviso y conserva al menos una fuente. Monótono: búsqueda binaria. */
  const largestFit = (hi: number): LimitOutput => {
    let lo = 1;
    let best: LimitOutput | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const out = build(mid, true);
      const tokens = count(out.respuesta);
      if (tokens <= max && out.fuentes.length > 0) { best = { ...out, abreviada: true, visibleTokens: tokens }; lo = mid + 1; } else hi = mid - 1;
    }
    if (!best) throw new OutputLimitError();
    return best;
  };

  let n = units.length;
  if (input.stopReason === "max_tokens") {
    // Cortado por max_tokens: se descarta la última oración inconclusa y siempre lleva aviso.
    while (n > 0 && !isCompleteUnit(units[n - 1].text)) n--;
    return largestFit(n);
  }
  const full = build(n, false);
  const fullTokens = count(full.respuesta);
  if (fullTokens <= max) return { ...full, abreviada: false, visibleTokens: fullTokens };
  return largestFit(n);
}
