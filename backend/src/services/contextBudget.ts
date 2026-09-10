import type { ChatTurn } from "../shared/chatHistory.js";

/**
 * Quita tildes/diacríticos y pasa a minúsculas, para no tener que
 * duplicar cada patrón en su versión acentuada y sin acentuar.
 * "según", "segun", "SEGÚN" -> "segun"
 */
function normalizeSpanish(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Grupos de palabras clave con su peso relativo. El peso refleja cuanto
 * contexto documental suele requerir ese tipo de pregunta, no solo si
 * "suena compleja" en abstracto. Todos los patrones asumen texto ya
 * normalizado (sin tildes, en minusculas).
 */
const KEYWORD_GROUPS: Array<{ label: string; pattern: RegExp; weight: number }> = [
  {
    label: "referencia_legal",
    pattern: /\b(articulo|inciso|clausula|parrafo|numeral)\b/,
    weight: 3,
  },
  {
    label: "fuente_normativa",
    pattern: /\b(ley|decreto|reglamento|normativa|norma|resolucion|estatuto)\b/,
    weight: 3,
  },
  {
    label: "sancion",
    pattern: /\b(sancion(es)?|multa(s)?|penalidad(es)?|incumplimiento)\b/,
    weight: 3,
  },
  {
    label: "comparacion",
    pattern: /\b(compar\w*|diferencia(s)?\s+entre|versus|vs\.?|cual\s+es\s+mejor)\b/,
    weight: 3,
  },
  {
    label: "explicacion_detallada",
    pattern: /\b(explica\w*\s+en\s+detalle|detalla\w*|fundamenta\w*|amplia\w*|profundiza\w*)\b/,
    weight: 2,
  },
  {
    label: "procedimiento",
    pattern: /\b(procedimiento(s)?|requisito(s)?|paso\s+a\s+paso|como\s+se\s+hace|que\s+debo\s+hacer|como\s+tramito)\b/,
    weight: 2,
  },
  {
    label: "calculo",
    pattern: /\b(calcula\w*|cuanto\s+(es|cuesta|debo|pagar)|monto(s)?|total\s+a\s+pagar|porcentaje)\b/,
    weight: 2,
  },
  {
    label: "plazo",
    pattern: /\b(plazo(s)?|fecha\s+limite|vence(n)?|vencimiento|cuanto\s+tiempo)\b/,
    weight: 2,
  },
  {
    label: "referencia_previa",
    pattern: /\b(segun\s+(lo|el|la|los|las)|lo\s+anterior|(dicho|dicha|ese|esa|este|esta)\s+(articulo|clausula|documento)|arriba\s+mencionado)\b/,
    weight: 2,
  },
  {
    label: "tabla",
    pattern: /\b(tabla|cuadro\s+comparativo|resumen\s+comparativo|list(a|ado)\s+de)\b/,
    weight: 2,
  },
  {
    label: "causal",
    pattern: /\b(por\s*que|razon|motivo)\b/,
    weight: 1,
  },
];

/** Bonus por señales estructurales fuera del set de keywords. */
function structuralScore(normalized: string): { score: number; hits: string[] } {
  const hits: string[] = [];
  let score = 0;

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 40) {
    score += 2;
    hits.push("mensaje_largo");
  } else if (wordCount > 20) {
    score += 1;
    hits.push("mensaje_medio");
  }

  const questionMarks = (normalized.match(/\?/g) || []).length;
  if (questionMarks >= 2) {
    score += 2;
    hits.push("multiples_preguntas");
  }

  if (/\b(y\s+tambien|ademas|asi\s+como)\b|;/.test(normalized)) {
    score += 1;
    hits.push("clausulas_encadenadas");
  }

  // Referencia numerica explicita a un articulo/ley (ej. "articulo 45")
  if (/\b(articulo|ley|decreto)\.?\s*n?\s*\d+/.test(normalized)) {
    score += 2;
    hits.push("referencia_numerada");
  }

  return { score, hits };
}

export type QuestionComplexity = "simple" | "medium" | "complex";

const RESPONSE_TOKEN_LIMITS: Record<QuestionComplexity, number> = {
  simple: 400,
  medium: 800,
  complex: 1500,
};

export function getResponseTokenLimit(message: string, historyLength: number): number {
  return RESPONSE_TOKEN_LIMITS[scoreQuestionComplexity(message, historyLength).level];
}

export interface ComplexityResult {
  score: number;
  level: QuestionComplexity;
  /** Categorias que dispararon puntaje — util para loguear y ajustar umbrales. */
  matched: string[];
}

const MEDIUM_THRESHOLD = 3;
const COMPLEX_THRESHOLD = 6;

/**
 * Calcula un score de complejidad ponderado (keywords + señales
 * estructurales + historial) y lo clasifica en simple/medium/complex.
 * 100% deterministico y local — no llama a ningun modelo.
 */
export function scoreQuestionComplexity(
  message: string,
  historyLength: number
): ComplexityResult {
  if (historyLength >= 10) {
    // Igual que el comportamiento original: un hilo largo siempre se
    // trata como complejo, sin importar el contenido del mensaje.
    return { score: Infinity, level: "complex", matched: ["historial_largo"] };
  }

  const normalized = normalizeSpanish(message);
  const matched: string[] = [];
  let score = 0;

  for (const { label, pattern, weight } of KEYWORD_GROUPS) {
    if (pattern.test(normalized)) {
      score += weight;
      matched.push(label);
    }
  }

  const structural = structuralScore(normalized);
  score += structural.score;
  matched.push(...structural.hits);

  if (historyLength >= 5) {
    score += 1;
    matched.push("historial_moderado");
  }

  const level: QuestionComplexity =
    score >= COMPLEX_THRESHOLD ? "complex" : score >= MEDIUM_THRESHOLD ? "medium" : "simple";

  return { score, level, matched };
}

/**
 * Compatibilidad con el uso anterior: booleano estricto, true solo para
 * el nivel mas alto (para no cambiar de golpe los presupuestos que
 * dependen de este valor en budgetDocumentContext).
 */
export function isComplexQuestion(message: string, historyLength: number): boolean {
  return scoreQuestionComplexity(message, historyLength).level === "complex";
}

export function trimDocumentContext(context: string, maxChars: number): string {
  if (context.length <= maxChars) return context;
  return (
    context.slice(0, maxChars) +
    `\n\n[Documento truncado a ${maxChars} caracteres para ajustar el limite del modelo.]`
  );
}

/** Ajusta el texto del documento segun proveedor e historial. */
export function budgetDocumentContext(
  context: string,
  provider: "gemini" | "groq" | "deepseek" | "ollama",
  message: string,
  history: ChatTurn[]
): string {
  const hasHistory = history.length > 0;
  const complex = isComplexQuestion(message, history.length);

  if (provider === "gemini") {
    return trimDocumentContext(context, 180_000);
  }

  if (provider === "deepseek") {
    return trimDocumentContext(context, complex ? 48_000 : 32_000);
  }

  // groq: recorte agresivo; en seguimiento corto prioriza inicio del doc (titulos)
  if (hasHistory && !complex && message.length < 140) {
    return trimDocumentContext(context, 12_000);
  }
  return trimDocumentContext(context, 18_000);
}
