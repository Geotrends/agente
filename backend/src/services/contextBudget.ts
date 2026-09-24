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

/**
 * Patrones que delatan una pregunta que no se sostiene sola (hallazgo M-2).
 *
 * Se aplican sobre el texto normalizado (sin tildes), porque la gente escribe
 * «segun» tanto como «según».
 */
const FOLLOW_UP_PATTERNS: RegExp[] = [
  // El mismo patrón que ya usaba `referencia_previa` más abajo.
  /\b(segun\s+(lo|el|la|los|las)|lo\s+anterior|arriba\s+mencionado)\b/,
  // Pronombres que apuntan fuera de la propia pregunta.
  /\b(eso|esto|aquello|lo\s+mismo|el\s+anterior|la\s+anterior)\b/,
  // Pregunta elíptica encadenada: «¿y el plazo?», «y cuánto cuesta».
  /^[¿\s]*y\s+/,
];

/**
 * Demostrativo seguido de un sustantivo con contenido: «ese trámite», «dicha
 * resolución». Va sobre el texto CON tildes a propósito: normalizarlo
 * convertiría «está» en «esta» y «¿dónde está el documento?» pasaría por una
 * pregunta de seguimiento. Además se exige que la palabra siguiente no sea un
 * artículo o preposición, para que «esta en la página 3» tampoco cuente.
 */
const DEMONSTRATIVE = /\b(ese|esa|esos|esas|este|esta|estos|estas|dicho|dicha|dichos|dichas|aquel|aquella)\s+([\p{L}]+)/u;
const FUNCTION_WORDS = new Set(["el", "la", "los", "las", "un", "una", "en", "de", "del", "al", "es", "son", "y", "o", "que", "se"]);

/**
 * ¿Esta pregunta necesita la anterior para entenderse?
 *
 * Reemplaza al umbral mágico de `message.length < 160` que decidía esto antes:
 * la longitud no dice nada sobre si la pregunta se sostiene sola —«¿cuál es el
 * horario de atención de la Secretaría de Movilidad?» es corta y autocontenida,
 * y «¿y el plazo?» es cortísima y no lo es—.
 */
export function needsPreviousContext(message: string): boolean {
  const normalized = normalizeSpanish(message);
  if (FOLLOW_UP_PATTERNS.some(pattern => pattern.test(normalized))) return true;
  const demonstrative = DEMONSTRATIVE.exec(message.toLowerCase());
  return Boolean(demonstrative && !FUNCTION_WORDS.has(demonstrative[2]));
}

/**
 * Últimos `maxChars` caracteres, sin partir una palabra por la mitad.
 *
 * El `slice(-500)` anterior cortaba donde cayera: la primera palabra del
 * contexto llegaba mutilada al tokenizador, que la contaba como un término
 * inexistente. Mismo criterio que usa `chunkText` al fragmentar documentos —
 * retroceder al límite de palabra— y solo se aplica si de verdad hay que
 * recortar.
 */
export function tailAtWordBoundary(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const tail = trimmed.slice(-maxChars);
  const boundary = tail.search(/\s/);
  // Si no hay ningún espacio, es una sola palabra larguísima: se devuelve tal
  // cual antes que devolver una cadena vacía.
  return boundary === -1 ? tail : tail.slice(boundary + 1);
}

export type QuestionComplexity = "simple" | "medium" | "complex";

/**
 * Tope duro compartido por todos los proveedores para evitar respuestas descontroladas.
 *
 * En los modelos de razonamiento (gpt-oss, gpt-5) el razonamiento cuenta
 * contra este mismo tope. Con 2.200 no quedaba margen: el prompt pide
 * respuestas de hasta ~1.800 tokens, y gpt-oss llegó a gastar 2.198 solo
 * razonando. 3.000 da ese margen; el control principal del razonamiento es
 * `reasoning_effort` en askGroq.ts.
 */
export function getResponseTokenLimit(): number {
  return 3000;
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
 * Aqui vivian `isComplexQuestion`, `trimDocumentContext` y
 * `budgetDocumentContext`: unas 90 lineas de presupuesto de contexto que no
 * podian recortar nada (hallazgo M-6). Sus topes iban de 12.000 a 180.000
 * caracteres y el contexto real son 8 fragmentos de ~1.000 caracteres, asi que
 * ninguna rama truncaba jamas.
 *
 * Tenian ademas una inconsistencia real: el presupuesto solo se aplicaba en la
 * ruta de enrutamiento automatico; la seleccion manual de proveedor llamaba a
 * `askTutor` sin presupuesto alguno. Al borrarlo, las dos rutas quedan iguales
 * por construccion, que es mas seguro que dos caminos que divergen el dia en
 * que alguien suba el top-k.
 */
