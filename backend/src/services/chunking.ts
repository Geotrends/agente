/**
 * Fragmentación consciente de la estructura del documento (hallazgos M-3 y M-4).
 *
 * `chunkText` corta cada 1.000 caracteres sobre un flujo plano, retrocediendo
 * al espacio más cercano. Funciona, pero tira TODA la estructura que el
 * preprocesador ya se había tomado el trabajo de producir:
 *
 *   - `documentPreprocessor` genera `## Hoja: <nombre>` y tablas Markdown para
 *     las hojas de cálculo. Cortar a mitad de tabla deja filas huérfanas sin
 *     encabezado: ilegibles para el modelo y para el ciudadano que lee la cita.
 *   - El scraper escribe frontmatter YAML más encabezados `#`. El frontmatter
 *     acababa siendo el fragmento nº 1 de cada página scrapeada — puro ruido
 *     con su propio vector de 384 dimensiones compitiendo en la búsqueda.
 *   - El corpus es normativo: leyes, decretos, acuerdos y resoluciones se leen
 *     por ARTÍCULO. Cortar a mitad de inciso parte justo la unidad de sentido
 *     que la gente pregunta y que la respuesta tiene que citar.
 *
 * Y de paso resuelve M-4: `pdf-parse` une las páginas con "-- N of M --", que
 * hasta ahora solo se borraba. Ese separador dice en qué página empieza cada
 * fragmento, y con eso la cita pasa de "este PDF de 180 páginas" a "Acuerdo
 * 034 de 2019, p. 12" — la diferencia entre una cita verificable y una nominal.
 */
import { chunkText } from "./retrievalMath.js";

export type DocumentChunk = {
  text: string;
  /** Página del PDF donde EMPIEZA el fragmento. Ausente si el formato no las tiene. */
  page?: number;
  /** Encabezado o artículo bajo el que cae, para dar contexto al fragmento. */
  heading?: string;
};

/** Separador que `pdf-parse` intercala entre páginas. */
const PAGE_SEPARATOR = /--\s*(\d+)\s*of\s*(\d+)\s*--/g;

/**
 * Encabezados que abren una sección. El orden de alternativas importa poco
 * porque son mutuamente excluyentes en la práctica, pero sí importa exigir
 * inicio de línea: "el artículo 5 dice" en mitad de un párrafo no abre nada.
 */
const HEADING = /^(?:#{1,6}\s+.+|(?:ART[ÍI]CULO|Art[íi]culo)\s+(?:\d+|[IVXLCDM]+)\.?(?:\s*[°º])?.*|CAP[ÍI]TULO\s+(?:\d+|[IVXLCDM]+).*|T[ÍI]TULO\s+(?:\d+|[IVXLCDM]+).*)$/;

/** Una línea de tabla Markdown. */
const TABLE_ROW = /^\s*\|.*\|\s*$/;

/**
 * Quita el frontmatter YAML y devuelve el título si lo trae.
 *
 * El frontmatter no es contenido buscable: es metadata que ya vive en
 * `sourceMetadata`. Lo único aprovechable es el título, que sí sirve como
 * contexto de los fragmentos.
 */
export function stripFrontmatter(text: string): { body: string; title?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { body: text };
  const title = /^title:\s*(.+)$/m.exec(match[1])?.[1]?.trim().replace(/^["']|["']$/g, "");
  return { body: text.slice(match[0].length), title: title || undefined };
}

/** Parte el texto por los separadores de página, conservando el número. */
function splitPages(text: string): Array<{ text: string; page?: number }> {
  const parts: Array<{ text: string; page?: number }> = [];
  let last = 0;
  let page: number | undefined;
  for (const match of text.matchAll(PAGE_SEPARATOR)) {
    const slice = text.slice(last, match.index);
    if (slice.trim()) parts.push({ text: slice, page });
    // El separador "-- 3 of 20 --" PRECEDE al contenido de la página 3.
    page = Number(match[1]);
    last = match.index + match[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim()) parts.push({ text: tail, page });
  return parts.length ? parts : [{ text, page: undefined }];
}

/** Parte por encabezados/artículos, conservando el encabezado con su sección. */
function splitSections(text: string): Array<{ text: string; heading?: string }> {
  const lines = text.split("\n");
  const sections: Array<{ text: string; heading?: string }> = [];
  let current: string[] = [];
  let heading: string | undefined;
  const flush = () => {
    if (current.join("\n").trim()) sections.push({ text: current.join("\n"), heading });
    current = [];
  };
  for (const line of lines) {
    if (HEADING.test(line.trim()) && line.trim().length <= 200) {
      flush();
      heading = line.trim().replace(/^#{1,6}\s+/, "");
      current = [line];
    } else {
      current.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ text }];
}

/**
 * Fragmenta una tabla Markdown repitiendo su encabezado en cada trozo.
 *
 * Sin esto, el segundo trozo de una tabla de presupuesto son filas de cifras
 * sin nombres de columna: el modelo no puede decir qué significa cada número,
 * y el reranker tampoco. Con el encabezado repetido, cada fragmento se
 * sostiene solo.
 */
function chunkTable(lines: string[], size: number): string[] {
  const header = lines.slice(0, 2).join("\n");   // fila de títulos + separador
  const body = lines.slice(2);
  if (!body.length) return [lines.join("\n")];
  const out: string[] = [];
  let buffer: string[] = [];
  for (const row of body) {
    // +1 por el salto de línea que unirá las filas.
    const projected = header.length + buffer.join("\n").length + row.length + 1;
    if (buffer.length && projected > size) {
      out.push(`${header}\n${buffer.join("\n")}`);
      buffer = [];
    }
    buffer.push(row);
  }
  if (buffer.length) out.push(`${header}\n${buffer.join("\n")}`);
  return out;
}

/** ¿La sección es mayoritariamente una tabla Markdown? */
function isTable(text: string): boolean {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 3) return false;
  return lines.filter(l => TABLE_ROW.test(l)).length >= lines.length * 0.8;
}

/**
 * Fragmenta un documento respetando su estructura.
 *
 * `size` y `overlap` siguen acotando el tamaño: la estructura decide DÓNDE
 * cortar, no elimina el límite. Una sección más larga que `size` se sigue
 * partiendo por caracteres, que es lo correcto — un artículo de diez páginas
 * no cabe en un fragmento.
 */
export function chunkDocument(text: string, size = 1000, overlap = 150): DocumentChunk[] {
  const { body, title } = stripFrontmatter(text);
  const chunks: DocumentChunk[] = [];
  for (const { text: pageText, page } of splitPages(body)) {
    for (const { text: sectionText, heading } of splitSections(pageText)) {
      const trimmed = sectionText.trim();
      if (!trimmed) continue;
      // El encabezado de contexto se antepone al fragmento, pero NO se cuenta
      // dentro del límite de la sección: es contexto añadido, no contenido.
      const context = [title, heading].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" — ");
      const lines = trimmed.split("\n");
      const pieces = isTable(trimmed)
        ? chunkTable(lines, size)
        : trimmed.length <= size ? [trimmed] : chunkText(trimmed, size, overlap);
      for (const piece of pieces) {
        // Si el trozo ya empieza por su propio encabezado, no se repite.
        const needsContext = context && !piece.trimStart().startsWith(context.split(" — ").at(-1) ?? "");
        chunks.push({
          text: needsContext ? `${context}\n${piece}` : piece,
          ...(page === undefined ? {} : { page }),
          ...(heading ? { heading } : {}),
        });
      }
    }
  }
  return chunks.length ? chunks : [{ text: text.trim() }];
}
