/**
 * Correcciones de ortografía sobre la respuesta final. Las fuentes oficiales escriben "carne"
 * por "carné" y el modelo lo copiaba; aquí se corrige solo donde el contexto indica documento.
 */
// "carne" sin tilde por "carné": el procedimiento oficial GT-P-011 lo escribe
// así ("entregara el carne de la mascota") y el modelo lo copiaba, a veces con
// artículo femenino ("la carne de la mascota"), que se lee como comida. Solo
// se corrige donde el contexto indica documento: tras un artículo masculino
// ("el carne" nunca es comida) o antes de "de vacunación", "de la mascota",
// "municipal", etc. "Consumo de carne" y similares no se tocan.
const CARNET_CONTEXT = String.raw`(?=["”»]?\s+(?:municipal|del\s+animal|de\s+(?:la\s+|el\s+|las\s+|los\s+)?(?:vacun\w*|mascota\w*|animal\w*|identificaci\w*|registro|rum)\b))`;
// Sin \b al final: en JavaScript la "é" no cuenta como letra para \b.
const CARNET_AFTER_ARTICLE = /\b(el|un|del|al)(\s+["“«]?)carn[eé](?![\wáéíóúñ])/gi;
const CARNET_BEFORE_CONTEXT = new RegExp(`\\b(?:(la|una|el|un)(\\s+["“«]?))?carn[eé](?![\\wáéíóúñ])${CARNET_CONTEXT}`, "gi");
const MASCULINE: Record<string, string> = { la: "el", una: "un", el: "el", un: "un" };

function matchCase(original: string, replacement: string): string {
  return original[0] === original[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

/** Corrige "carne"/"carné" de documento a "carnet", con artículo masculino. */
export function fixCarnet(answer: string): string {
  return answer
    .replace(CARNET_BEFORE_CONTEXT, (whole: string, article?: string, gap = "") => {
      const word = whole.slice(article ? article.length + gap.length : 0);
      const fixed = matchCase(word, "carnet");
      return article ? `${matchCase(article, MASCULINE[article.toLowerCase()])}${gap}${fixed}` : fixed;
    })
    .replace(CARNET_AFTER_ARTICLE, (whole: string, article: string, gap: string) =>
      `${article}${gap}${matchCase(whole.slice(article.length + gap.length), "carnet")}`);
}
