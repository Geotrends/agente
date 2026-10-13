/**
 * Enlaces de descarga para los códigos de formato citados en una respuesta.
 *
 * El modelo menciona formatos y procedimientos por su código ("diligencie el
 * GT-F-0076", "según el GT-P-011") pero rara vez copia una URL válida. Peor:
 * las páginas de GMAS del corpus traen el código dentro de enlaces que solo
 * funcionan en el sitio original —relativos (`VisualizacionDocumento.public?…`)
 * o `javascript:downloadFile(…)`— y el modelo los copia tal cual, así que el
 * frontend, que solo acepta http(s), los mostraba como texto.
 *
 * La matriz documental sí tiene URLs absolutas. El índice código → URL sale de
 * la vista `kb.v_codigos_publicados` (research R17): solo códigos PUBLICADOS,
 * con el archivo descargable cuando lo hay. El chat la lee con el rol de solo
 * lectura `app_reader` (principio VII), y se reescribe la respuesta para que
 * cada código lleve su enlace.
 */
import pg from "pg";
import type { SourceMetadataCatalog } from "./sourceMetadata.js";
import { safeErrorCode } from "./safeLog.js";

// Guiones que se aceptan dentro de un código. gpt-oss escribe "GT‑F‑058" con
// el guion no separable (U+2011), no con "-": con solo "-" ningún código de
// esas respuestas se enlazaba. También ‐ (U+2010), ‒ (U+2012), – (U+2013) y
// − (U+2212), que los modelos y los procesadores de texto intercambian.
const DASH = "[-‐‑‒–−]";
// Códigos del sistema de gestión: "GT-F-0076", "GT-P-011", "GA-PR-12".
// El prefijo de 2-3 letras excluye falsos positivos como "MAYO-DE-2023".
const CODE = String.raw`[A-Z]{2,3}${DASH}[A-Z]{1,2}${DASH}\d{1,5}`;
// En nombres de archivo el scraper separa con "_" ("gt-f-0076_solicitud…"),
// así que aquí "_" cierra el código; basta con que no siga una letra o dígito.
const LEADING_CODE = new RegExp(`^(${CODE})(?![A-Za-z0-9])`, "i");
const CODE_IN_TEXT = new RegExp(`(?<!\\w|${DASH})(${CODE})(?!\\w|${DASH})`, "gi");

// Un enlace Markdown cualquiera. La URL admite `javascript:fn("a", "b")`, con
// paréntesis y espacios, porque así vienen los botones de descarga de GMAS.
const MARKDOWN_LINK = /\[([^\]]+)\]\((javascript:[\w.]+\([^)]*\)|[^)\s]*)\)/g;
// Tramos donde no se buscan códigos sueltos: enlaces (ya resueltos en el paso
// anterior), código en línea y URLs sueltas.
const PROTECTED = /(\[[^\]]*\]\([^)\s]*\)|`[^`]*`|https?:\/\/\S+)/g;

export type DocumentCodeIndex = Map<string, string>;

/**
 * "GT-F-076" y "GT-F-0076" son el mismo formato: la página de GMAS lo titula
 * con tres dígitos y el archivo descargado con cuatro. Se compara sin ceros
 * a la izquierda.
 */
export function normalizeCode(code: string): string {
  const [prefix, type, number] = code.toUpperCase().split(new RegExp(DASH));
  return `${prefix}-${type}-${Number(number)}`;
}

/**
 * Solo cuenta el código con el que EMPIEZA el título o el nombre de archivo:
 * "GT-F-0076 Solicitud…" es ese formato, mientras que un instructivo que dice
 * "cómo diligenciar el GT-F-0076" solo lo menciona y no debe quedarse con su
 * enlace.
 *
 * Gana el archivo descargable (filas de `documentos.csv`, las que traen
 * mimeType). Si no se descargó ninguno —caso de los procedimientos GT-P, que
 * solo existen como página del visor de GMAS— se usa la URL de la página.
 */
export function buildDocumentCodeIndex(catalog: SourceMetadataCatalog): DocumentCodeIndex {
  const files: DocumentCodeIndex = new Map();
  const pages: DocumentCodeIndex = new Map();
  for (const [localPath, metadata] of catalog.byPath) {
    if (!metadata.sourceUrl) continue;
    const target = metadata.mimeType ? files : pages;
    const fileName = localPath.split("/").pop() ?? "";
    for (const candidate of [metadata.title ?? "", fileName]) {
      const code = LEADING_CODE.exec(candidate.trim())?.[1];
      if (!code) continue;
      const key = normalizeCode(code);
      // El primero gana: filas duplicadas del mismo formato apuntan al mismo archivo.
      if (!target.has(key)) target.set(key, metadata.sourceUrl);
    }
  }
  return new Map([...pages, ...files]);
}

function urlForCodeIn(text: string, index: DocumentCodeIndex): string | undefined {
  for (const [code] of text.matchAll(CODE_IN_TEXT)) {
    const url = index.get(normalizeCode(code));
    if (url) return url;
  }
  return undefined;
}

/**
 * 1. Enlaces que el navegador no puede abrir (relativos, `javascript:`): si su
 *    texto nombra un código conocido, se apuntan a la URL del catálogo; si no,
 *    se deja solo el texto. Los http(s) se respetan.
 * 2. Códigos sueltos conocidos: se convierten en enlace.
 */
export function linkDocumentCodes(answer: string, index: DocumentCodeIndex): string {
  const withFixedLinks = answer.replace(MARKDOWN_LINK, (whole: string, text: string, url: string) => {
    if (/^https?:\/\//i.test(url)) return whole;
    const resolved = urlForCodeIn(text, index);
    return resolved ? `[${text}](${resolved})` : text;
  });
  if (index.size === 0) return withFixedLinks;

  return withFixedLinks
    .split(PROTECTED)
    .map((segment, i) => {
      // split con grupo de captura: los índices impares son los tramos protegidos.
      if (i % 2 === 1) return segment;
      return segment.replace(CODE_IN_TEXT, (code: string) => {
        const url = index.get(normalizeCode(code));
        return url ? `[${code}](${url})` : code;
      });
    })
    .join("");
}

/** Índice desde las filas de la vista: el primer código normalizado gana. */
export function indiceDesdeFilas(filas: Array<{ codigo: string; url: string }>): DocumentCodeIndex {
  const index: DocumentCodeIndex = new Map();
  for (const { codigo, url } of filas) {
    if (!codigo || !/^https:\/\//i.test(url)) continue;
    const match = LEADING_CODE.exec(codigo.trim())?.[1];
    if (!match) continue;
    const key = normalizeCode(match);
    if (!index.has(key)) index.set(key, url);
  }
  return index;
}

/** Cada cuánto se relee la vista: un retiro o vencimiento deja de enlazarse en segundos. */
const TTL_MS = 30 * 1000;
let memoized: { at: number; index: DocumentCodeIndex } | undefined;
let pool: pg.Pool | undefined;
let avisoSinBase = false;

function poolLectura(): pg.Pool | undefined {
  const connectionString = process.env.APP_DATABASE_URL;
  if (!connectionString) {
    if (!avisoSinBase) {
      console.warn("[documentLinks] Sin APP_DATABASE_URL: los códigos GT-F/GT-P quedan como texto, sin enlace.");
      avisoSinBase = true;
    }
    return undefined;
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3_000 });
    pool.on("error", error => console.warn(`[documentLinks] Conexión de lectura perdida: ${safeErrorCode(error)}`));
  }
  return pool;
}

/**
 * Índice de códigos publicados. Si PostgreSQL falla se conserva el último
 * índice; sin índice, un mapa vacío: los códigos quedan como texto, pero la
 * respuesta al ciudadano nunca falla por esto.
 */
export async function loadDocumentCodeIndex(): Promise<DocumentCodeIndex> {
  if (memoized && Date.now() - memoized.at < TTL_MS) return memoized.index;
  const db = poolLectura();
  if (!db) return memoized?.index ?? new Map();
  try {
    const { rows } = await db.query<{ codigo: string; url: string }>("SELECT codigo, url FROM kb.v_codigos_publicados");
    memoized = { at: Date.now(), index: indiceDesdeFilas(rows) };
  } catch (error) {
    console.warn(`[documentLinks] No se pudo leer la vista de códigos: ${safeErrorCode(error)}`);
    if (memoized) memoized.at = Date.now();   // no reintentar en cada respuesta
  }
  return memoized?.index ?? new Map();
}

/** Solo para pruebas: olvida el índice memoizado y cierra el pool. */
export async function reiniciarIndiceCodigos(): Promise<void> {
  memoized = undefined;
  await pool?.end();
  pool = undefined;
}
