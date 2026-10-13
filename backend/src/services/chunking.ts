/**
 * Fragmentación del documento publicado (RF-C3-DI-13, RNF-C3-IV-02).
 *
 * Reglas del contrato (contracts/retrieval.md):
 *
 *   - El texto REALMENTE embebido —contexto de título/encabezado incluido— mide ≤ 1000
 *     caracteres.
 *   - La prosa se corta solo entre palabras y los fragmentos contiguos del mismo flujo
 *     comparten 150 caracteres de solapamiento, con la tolerancia de una palabra: el
 *     solapamiento es el sufijo MÁS CORTO de palabras completas que llega a 150.
 *   - Una tabla Markdown es un bloque indivisible, aunque conviva con prosa: se emite íntegra
 *     en un solo fragmento. Una tabla o una palabra de más de 1000 caracteres hace NO
 *     publicable al documento (`ChunkingError`): el hallazgo es REAL y se resuelve en la
 *     fuente, no partiendo la tabla ni aceptando una excepción.
 *   - Las páginas ("-- N of M --") y los encabezados/artículos son metadata del fragmento;
 *     no inician flujos nuevos ni autorizan perder prosa o solapamiento.
 *
 * Se descartó dividir las tablas repitiendo su encabezado: producía varios fragmentos
 * por tabla, lo contrario de lo que exige el criterio de aceptación.
 */
/** Separador que `pdf-parse` intercala entre páginas. */
const PAGE_SEPARATOR = /--\s*(\d+)\s*of\s*(\d+)\s*--/g;

/** Encabezados que abren una sección: solo al inicio de línea. */
const HEADING = /^(?:#{1,6}\s+.+|(?:ART[ÍI]CULO|Art[íi]culo)\s+(?:\d+|[IVXLCDM]+)\.?(?:\s*[°º])?.*|CAP[ÍI]TULO\s+(?:\d+|[IVXLCDM]+).*|T[ÍI]TULO\s+(?:\d+|[IVXLCDM]+).*)$/;

/** Una línea de tabla Markdown. */
const TABLE_ROW = /^\s*\|.*\|\s*$/;

/** Contexto máximo que se antepone a un fragmento; más largo se omite para no comerse el límite. */
const MAX_CONTEXT = 200;

export type DocumentChunk = {
  text: string;
  /** Página del PDF donde EMPIEZA el fragmento. Ausente si el formato no las tiene. */
  page?: number;
  /** Encabezado o artículo vigente donde empieza el fragmento. */
  heading?: string;
};

export type ChunkingFinding = { kind: "tabla_excede" | "palabra_excede"; length: number; limit: number; excerpt: string };

/** El documento no se puede publicar tal cual: tabla o palabra indivisible mayor que el límite. */
export class ChunkingError extends Error {
  constructor(readonly finding: ChunkingFinding) {
    super(`${finding.kind}: ${finding.length} > ${finding.limit} caracteres`);
    this.name = "ChunkingError";
  }
}

/**
 * Quita el frontmatter YAML y devuelve el título si lo trae. Lo único aprovechable es el
 * título, que sí sirve como contexto de los fragmentos.
 */
export function stripFrontmatter(text: string): { body: string; title?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { body: text };
  const title = /^title:\s*(.+)$/m.exec(match[1])?.[1]?.trim().replace(/^["']|["']$/g, "");
  return { body: text.slice(match[0].length), title: title || undefined };
}

/** Quita los separadores de página y devuelve, por desplazamiento, la página que empieza allí. */
function flatten(text: string): { flow: string; pageAt: Array<{ offset: number; page: number }> } {
  let flow = "";
  let last = 0;
  const pageAt: Array<{ offset: number; page: number }> = [];
  for (const match of text.matchAll(PAGE_SEPARATOR)) {
    flow += text.slice(last, match.index);
    // El separador "-- 3 of 20 --" PRECEDE al contenido de la página 3.
    pageAt.push({ offset: flow.length, page: Number(match[1]) });
    last = match.index + match[0].length;
  }
  flow += text.slice(last);
  return { flow, pageAt };
}

type Block = { kind: "prose" | "table"; start: number; end: number };

/** Parte el flujo en prosa y tablas (bloques contiguos de filas `| … |`), con sus desplazamientos. */
function blocksOf(flow: string): Block[] {
  const blocks: Block[] = [];
  let offset = 0;
  let current: Block | undefined;
  for (const line of flow.split("\n")) {
    const kind = TABLE_ROW.test(line) ? "table" : "prose";
    const lineEnd = offset + line.length;
    // Las líneas en blanco no cortan una tabla ni una prosa: solo las filas de tabla definen el bloque.
    if (!line.trim() && current) { current.end = lineEnd; }
    else if (current && current.kind === kind) current.end = lineEnd;
    else { current = { kind, start: offset, end: lineEnd }; blocks.push(current); }
    offset = lineEnd + 1;
  }
  return blocks;
}

function lookup<T extends { offset: number }>(list: T[], offset: number): T | undefined {
  let found: T | undefined;
  for (const item of list) { if (item.offset <= offset) found = item; else break; }
  return found;
}

/**
 * Fragmenta un documento. `size` es el tope del texto final (contexto incluido) y `overlap` el
 * solapamiento objetivo entre fragmentos de prosa contiguos.
 */
export function chunkDocument(text: string, size = 1000, overlap = 150): DocumentChunk[] {
  if (overlap < 0 || overlap >= size / 2) throw new Error("Invalid chunk size: overlap debe estar entre 0 y size/2");
  const { body, title } = stripFrontmatter(text);
  const { flow, pageAt } = flatten(body);

  const headings: Array<{ offset: number; text: string }> = [];
  let offset = 0;
  for (const line of flow.split("\n")) {
    const t = line.trim();
    if (HEADING.test(t)) {
      // En normas, "ARTÍCULO 2. Ámbito. Aplica…" ocupa una sola línea larga: el encabezado es solo su inicio.
      const label = t.length <= 200 ? t : (/^(.{1,100}?[.:])\s/.exec(t)?.[1] ?? t.slice(0, 100).replace(/\s\S*$/, ""));
      headings.push({ offset, text: label.replace(/^#{1,6}\s+/, "") });
    }
    offset += line.length + 1;
  }

  const chunks: DocumentChunk[] = [];
  const emit = (pieceStart: number, piece: string): void => {
    const heading = lookup(headings, pieceStart)?.text;
    const page = lookup(pageAt, pieceStart)?.page;
    const context = [title, heading].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" — ");
    // El contexto cuenta dentro del límite; si no cabe, se omite en vez de partir el contenido.
    const useContext = context && context.length <= MAX_CONTEXT
      && !piece.trimStart().startsWith(context.split(" — ").at(-1) ?? "")
      && context.length + 1 + piece.length <= size;
    chunks.push({
      text: useContext ? `${context}\n${piece}` : piece,
      ...(page === undefined ? {} : { page }),
      ...(heading ? { heading } : {}),
    });
  };

  for (const block of blocksOf(flow)) {
    const raw = flow.slice(block.start, block.end);
    const content = raw.trim();
    if (!content) continue;
    const start = block.start + raw.indexOf(content);

    if (block.kind === "table") {
      if (content.length > size) {
        throw new ChunkingError({ kind: "tabla_excede", length: content.length, limit: size, excerpt: content.slice(0, 80) });
      }
      emit(start, content);
      continue;
    }

    // Prosa: palabras con sus desplazamientos; los cortes caen siempre entre palabras.
    const words = [...content.matchAll(/\S+/g)].map(m => ({ s: m.index!, e: m.index! + m[0].length }));
    for (const w of words) {
      if (w.e - w.s > size) {
        throw new ChunkingError({ kind: "palabra_excede", length: w.e - w.s, limit: size, excerpt: content.slice(w.s, w.s + 80) });
      }
    }
    const heading0 = (i: number) => lookup(headings, start + words[i].s)?.text;
    const contextLen = (i: number) => {
      const c = [title, heading0(i)].filter(Boolean).filter((v, k, a) => a.indexOf(v) === k).join(" — ");
      return c && c.length <= MAX_CONTEXT ? c.length + 1 : 0;
    };

    let i = 0;
    while (i < words.length) {
      const budget = size - contextLen(i);
      let j = i;
      while (j + 1 < words.length && words[j + 1].e - words[i].s <= budget) j++;
      // La primera palabra siempre cabe sin contexto (≤ size); con contexto puede no caber: se omite el contexto.
      if (words[j].e - words[i].s > budget && contextLen(i)) { j = i; while (j + 1 < words.length && words[j + 1].e - words[i].s <= size) j++; }
      emit(start + words[i].s, content.slice(words[i].s, words[j].e));
      if (j === words.length - 1) break;
      // Siguiente inicio: el sufijo más corto de palabras completas que alcanza el solapamiento.
      let k = j;
      while (k > i && words[j].e - words[k].s < overlap) k--;
      i = k > i ? k : i + 1;
    }
  }
  return chunks.length ? chunks : [{ text: text.trim() }];
}
