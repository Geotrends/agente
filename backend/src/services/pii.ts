/**
 * Enmascarado de datos personales antes de escribirlos al registro (hallazgo A-11).
 *
 * El prompt prohíbe SOLICITAR datos personales y lo cumple, pero los ciudadanos
 * los escriben igual: "mi cédula es 43.256.789", "el predio con matrícula
 * 001-234567", un correo, un teléfono. Bajo la Ley 1581 de 2012 y el Decreto
 * 1074 de 2015 eso convierte el CSV en una base de datos personales, con
 * deberes de finalidad, seguridad y supresión.
 *
 * EL RIESGO REAL DE ESTE MÓDULO NO ES QUEDARSE CORTO, ES PASARSE. El corpus es
 * normativo: está lleno de números que PARECEN documentos de identidad y no lo
 * son — "Ley 1581 de 2012", "Decreto 1074", "Acuerdo 034 de 2019",
 * "Resolución 40103", años, artículos, números de radicado públicos. Enmascarar
 * esos destruiría justo las preguntas que sirven para evaluar la recuperación
 * (A-12 saca de aquí el conjunto dorado), y lo haría en silencio.
 *
 * Por eso NINGUNA regla enmascara un número por el mero hecho de tener entre 6
 * y 10 dígitos. Cada regla exige una de dos anclas:
 *
 *   1. ANCLA LÉXICA — la palabra que nombra el dato va justo antes
 *      ("cédula", "CC", "NIT", "matrícula"…). Es lo que distingue
 *      "cédula 1234567" de "Ley 1234567".
 *   2. ANCLA DE FORMATO — la forma sola ya es inequívoca: un correo, o un
 *      teléfono móvil colombiano. Nada más: la regla de "número con
 *      separadores de miles" se probó, se midió contra el registro real y se
 *      retiró, porque enmascaraba cifras presupuestales (ver abajo).
 *
 * Las normas se escriben "Ley 1581 de 2012", sin puntos y sin la palabra
 * ancla, así que ninguna de las dos las alcanza. Hay pruebas que lo fijan.
 */

/** Etiqueta con la que se reemplaza cada dato, para que el registro siga siendo legible. */
const LABEL = {
  email: "[correo]",
  phone: "[teléfono]",
  id: "[documento]",
  nit: "[NIT]",
  property: "[matrícula]",
} as const;

/**
 * Palabras que anuncian un documento de identidad. Se aceptan con o sin tildes
 * porque la gente escribe "cedula" tanto como "cédula", y con los puntos de
 * "C.C." opcionales.
 */
const ID_KEYWORD = "(?:c[ée]dula|c\\.?\\s?c\\.?|documento(?:\\s+de\\s+identidad)?|identificaci[óo]n|tarjeta\\s+de\\s+identidad|t\\.?\\s?i\\.?|pasaporte)";
const NIT_KEYWORD = "(?:nit|n\\.?\\s?i\\.?\\s?t\\.?|rut)";
const PROPERTY_KEYWORD = "(?:matr[íi]cula(?:\\s+inmobiliaria)?|folio\\s+de\\s+matr[íi]cula)";

/** Separador entre la palabra ancla y el número: ":", "no.", "#", espacios. */
const GAP = "(?:\\s*(?:n[°ºo]\\.?|nro\\.?|num(?:ero)?\\.?|#|:|es|=)?\\s*)";

/**
 * `lexical` distingue las dos clases de regla, y no es cosmético: en una regla
 * léxica hay que CONSERVAR la palabra ancla y enmascarar solo el número
 * ("cédula [documento]"), mientras que en una de formato se sustituye la
 * coincidencia entera. Tratarlas igual rompía los correos —que no tienen
 * ningún dígito, así que "conservar todo lo anterior al primer dígito"
 * conservaba el correo completo y añadía la etiqueta al final.
 */
type Rule = { name: keyof typeof LABEL; pattern: RegExp; lexical?: true };

/**
 * El orden importa: lo más específico primero. El correo va antes que el
 * teléfono porque un correo puede contener dígitos que parecen un número.
 */
const RULES: Rule[] = [
  {
    name: "email",
    // Ancla de formato: nada legítimo del corpus tiene forma de correo.
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    name: "nit",
    lexical: true,
    pattern: new RegExp(`\\b${NIT_KEYWORD}${GAP}[\\d][\\d.,\\s-]{6,}\\d(?:\\s*-\\s*\\d)?`, "gi"),
  },
  {
    name: "property",
    lexical: true,
    pattern: new RegExp(`\\b${PROPERTY_KEYWORD}${GAP}[\\dA-Z]{1,4}\\s*-\\s*\\d{3,}`, "gi"),
  },
  {
    name: "id",
    lexical: true,
    pattern: new RegExp(`\\b${ID_KEYWORD}${GAP}\\d[\\d.\\s]{4,}\\d`, "gi"),
  },
  {
    name: "phone",
    // Ancla de formato: indicativo de país, o móvil colombiano de 10 dígitos
    // que empieza por 3 — rango que no colisiona con la numeración normativa.
    pattern: /(?:\+\s?57[\s-]?)?\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  },
  // NO HAY regla de "número con separadores de miles". La hubo, y se quitó
  // tras medirla contra las 1.105 interacciones reales del registro: de los 15
  // campos que enmascaraba, 14 eran CIFRAS PRESUPUESTALES, no documentos —
  // "| Recursos propios | 43.109.692.812 |", "$1.865.000" de asignación
  // básica, "600.000.000 para Adecuación de la sección hidráulica". En un
  // corpus municipal el dinero está en todas partes y se escribe igual que una
  // cédula.
  //
  // Se probó acotar por longitud (la cédula colombiana tiene 6-10 dígitos) y
  // no alcanza: "30.000.000" y "363.089.224" caen de lleno en ese rango y son
  // partidas presupuestales. Por formato solo, un peso y una cédula son
  // indistinguibles.
  //
  // Queda entonces como límite conocido y deliberado: una cédula escrita a
  // secas, sin la palabra que la nombra, no se enmascara. Es el mismo criterio
  // que ya se aplica al radicado — preferir un falso negativo a destruir
  // contenido legítimo, porque lo segundo ocurre en silencio y a gran escala.
];

/**
 * Devuelve el texto con los datos personales reconocibles sustituidos por una
 * etiqueta. No pretende ser exhaustivo —ningún enmascarado lo es— sino quitar
 * de en medio lo que aparece de forma rutinaria en un canal de atención.
 */
export function maskPersonalData(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, match => {
      // Se conserva la palabra ancla y se enmascara solo el número: quien lea
      // el registro necesita saber QUÉ se preguntó ("cédula [documento]"),
      // no cuál era el número.
      if (!rule.lexical) return LABEL[rule.name];
      const anchor = /^[^\d]*/.exec(match)?.[0] ?? "";
      return `${anchor}${LABEL[rule.name]}`;
    });
  }
  return out;
}

/** true si el enmascarado cambiaría el texto. Útil para métricas y pruebas. */
export function containsPersonalData(text: string): boolean {
  return maskPersonalData(text) !== text;
}

// ── Saneamiento hacia el proveedor (RF-C3-DI-23, RNF-C3-DI-01) ──────────────
//
// Lo anterior enmascara para el REGISTRO con etiquetas minúsculas. Aquí las etiquetas
// son las del contrato de salida a Bedrock y se aplican a la pregunta, al historial y a
// los fragmentos recuperados antes de salir. Mismo criterio de ancla: nunca se enmascara
// un número solo por su longitud, para no destruir normas, códigos ni fechas.

export type PiiKind = "cédula" | "teléfono" | "correo" | "dirección" | "nombre de tercero";

export type Sanitized = { texto: string; tipos: PiiKind[] };

const PROVIDER_LABEL = { cédula: "[CÉDULA]", teléfono: "[TELÉFONO]", correo: "[CORREO]", dirección: "[DIRECCIÓN]", nombre: "[NOMBRE]" } as const;

const CEDULA_ANCLADA = new RegExp(`\\b(?:${ID_KEYWORD}|identificad[oa]\\s+con)${GAP}\\d[\\d.\\s]{4,}\\d`, "gi");
const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TELEFONO = /(?:\+\s?57[\s-]?)?\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b|\(\s?60\d\s?\)\s?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b|\+\s?57[\s-]?\(?60\d\)?[\s-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
const DIRECCION = /\b(?:calle|carrera|cra\.?|kra\.?|cr\.?|diagonal|diag\.?|transversal|trans\.?|tv\.?|avenida|av\.?|circular|autopista)\s+\d+\s?[A-Za-z]{0,2}(?:\s+(?:bis|sur|norte|este|oeste))?\s*(?:#|n[°ºo]\.?|no\.?|nro\.?)?\s*\d+\s?[A-Za-z]{0,2}(?:\s+(?:bis|sur|norte|este|oeste))?\s*[-–]\s*\d+\b/gi;
const NOMBRE_TERCERO = /\b((?:se\s+llama|llamad[oa]|a\s+nombre\s+de|de\s+nombre|el\s+se[ñn]or|la\s+se[ñn]ora|se[ñn]or|se[ñn]ora|don|do[ñn]a|vecin[oa]|propietari[oa]|due[ñn][oa]|esposo|esposa|hermano|hermana)\s+)((?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)(?:\s+(?:de\s+|del\s+|la\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})/g;

function apply(text: string, re: RegExp, kind: PiiKind, label: string, found: Set<PiiKind>, keepAnchor = false): string {
  return text.replace(re, (match: string, ...groups: unknown[]) => {
    found.add(kind);
    if (!keepAnchor) return label;
    const anchor = /^[^\d]*/.exec(match)?.[0] ?? (typeof groups[0] === "string" ? groups[0] : "");
    return `${anchor}${label}`;
  });
}

/**
 * Contexto que delata un dato de una PERSONA (no de la entidad) dentro de un documento: se mira solo
 * la misma línea, antes del dato. Sin esta palabra, un teléfono o un correo `.gov.co` de un documento
 * oficial es un canal de atención y debe llegar intacto al modelo.
 */
const CONTEXTO_PERSONAL = /(solicitante|ciudadan[oa]|usuari[oa]|propietari[oa]|denunciante|titular|tercero|vecin[oa]|particular|personal|peticionari[oa])/i;
const esDePersona = (texto: string, desde: number): boolean => {
  const inicioLinea = texto.lastIndexOf("\n", desde) + 1;
  return CONTEXTO_PERSONAL.test(texto.slice(Math.max(inicioLinea, desde - 80), desde));
};

function sanitize(text: string, kinds: { direccion: boolean; nombre: boolean; institucional?: boolean }): Sanitized {
  const found = new Set<PiiKind>();
  let out = text;
  if (kinds.institucional) {
    // Documentos oficiales: los canales de la entidad (teléfonos y correos .gov.co) se conservan.
    const marcar = (kind: PiiKind, label: string, oficial: (m: string) => boolean) => (m: string, offset: number, whole: string) => {
      if (oficial(m) && !esDePersona(whole, offset)) return m;
      found.add(kind);
      return label;
    };
    out = out.replace(CORREO, marcar("correo", PROVIDER_LABEL.correo, m => /\.gov\.co$/i.test(m)));
    out = apply(out, CEDULA_ANCLADA, "cédula", PROVIDER_LABEL.cédula, found, true);
    out = out.replace(TELEFONO, marcar("teléfono", PROVIDER_LABEL.teléfono, () => true));
  } else {
    out = apply(out, CORREO, "correo", PROVIDER_LABEL.correo, found);
    out = apply(out, CEDULA_ANCLADA, "cédula", PROVIDER_LABEL.cédula, found, true);
    out = apply(out, TELEFONO, "teléfono", PROVIDER_LABEL.teléfono, found);
  }
  if (kinds.direccion) out = apply(out, DIRECCION, "dirección", PROVIDER_LABEL.dirección, found);
  if (kinds.nombre) {
    out = out.replace(NOMBRE_TERCERO, (_m: string, anchor: string) => { found.add("nombre de tercero"); return `${anchor}${PROVIDER_LABEL.nombre}`; });
  }
  return { texto: out, tipos: [...found] };
}

/** Pregunta o pregunta del historial: los cinco tipos de dato. */
export function sanitizeCitizenText(text: string): Sanitized {
  return sanitize(text, { direccion: true, nombre: true });
}

/**
 * Fragmentos y respuestas previas: cédulas, correos personales y teléfonos o correos de personas.
 * Las direcciones de oficinas públicas, los nombres de funcionarios y los canales de la propia
 * entidad (teléfonos y correos `.gov.co` que no vienen precedidos de «solicitante», «ciudadano»,
 * «propietario»…) son contenido legítimo y se conservan: sin ellos el chat no puede dar el
 * teléfono de atención de una dependencia.
 */
export function sanitizeFragment(text: string): Sanitized {
  return sanitize(text, { direccion: false, nombre: false, institucional: true });
}

/**
 * Copia saneada para el REGISTRO (RF-C3-IN-06): cédulas, teléfonos y correos del texto pasan a
 * `[CÉDULA]`, `[TELÉFONO]` y `[CORREO]`. Los valores oficiales de contacto (canales de recepción
 * y atención inmediata) NO son datos ciudadanos y se conservan tal cual. Lo que se entrega al
 * ChatBot nunca pasa por aquí.
 */
export function sanitizeForRecord(text: string, preserve: readonly string[] = []): string {
  const protegidos = preserve.filter(v => v.length > 0 && text.includes(v)).sort((a, b) => b.length - a.length);
  const guardados: string[] = [];
  let out = text;
  for (const v of protegidos) out = out.split(v).join(`\u0000${guardados.push(v) - 1}\u0000`);
  out = sanitizeFragment(out).texto;
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => guardados[Number(i)] ?? "");
}
