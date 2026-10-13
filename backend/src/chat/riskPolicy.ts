/**
 * Afectación en curso (RF-C3-DI-19). Detección local y determinista: cuando la persona
 * describe un daño que está ocurriendo, los canales de atención inmediata van ANTES de la
 * orientación. Los nombres, valores y orden salen siempre del snapshot vigente; no se
 * genera ni se infiere ningún contacto.
 */
import type { ContactSnapshot } from "./contracts.js";
import { TEXTO_RIESGO_INTRO } from "../prompts/institutionalTexts.js";

const EN_CURSO = [
  /\b(est[aá]n?|est[aá]s)\s+(maltratando|golpeando|envenenando|quemando|ahogando|matando|talando|botando|vertiendo|contaminando|abandonando|atacando)\b/i,
  /\b(acaban?\s+de|acabo\s+de)\s+(atropellar|envenenar|golpear|encontrar|ver|talar|quemar)/i,
  /\b(ahora\s+mismo|en\s+este\s+momento|en\s+este\s+instante|ya\s+mismo)\b.*\b(herid|sangr|maltrat|incendi|quem|envenen|tal|derram|ataca|muriendo|agoniz)/i,
  /\b(hay|tengo|veo|encontr[eé]|encontramos)\s+(un|una|unos|unas)?\s*(animal|perro|gato|ave|caballo|fauna)\w*\s+(herid|sangrando|atropellad|envenenad|atrapad|agoniz|abandonad)/i,
  /\b(hay|se\s+est[aá])\s+(un\s+)?(incendio|quema|derrame|tala)\b/i,
  /\b(se\s+est[aá]|est[aá]n)\s+(muriendo|agonizando|sufriendo)\b/i,
];

export function afectacionEnCurso(pregunta: string): boolean {
  return EN_CURSO.some(re => re.test(pregunta));
}

/** Bloque de canales inmediatos en el orden del registro, con nombre, descripción y valor oficiales. */
export function bloqueCanalesInmediatos(c: ContactSnapshot): string {
  const items = [...c.inmediatos].sort((a, b) => a.position - b.position)
    .map(i => `- **${i.name}** — ${i.description}: ${i.type === "url" ? `[${i.value}](${i.value})` : i.value}`);
  return `${TEXTO_RIESGO_INTRO}\n\n${items.join("\n")}`;
}
