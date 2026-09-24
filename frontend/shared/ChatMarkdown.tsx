"use client";

import { Fragment, useMemo, type ReactNode } from "react";

type NestedList = { ordered: boolean; items: string[] };
type ListItem = { text: string; nested: NestedList[]; paragraphs: string[][] };

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "hr" }
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: ListItem[] }
  | { type: "ol"; items: ListItem[] }
  | { type: "table"; headers: string[]; rows: string[][] };

const BULLET_RE = /^[-*•]\s+/;
const ORDERED_RE = /^\d+[.)]\s+/;
// "## Título" (con los "#" de cierre opcionales de CommonMark). Exige el
// espacio tras los "#" para no confundir un "#5" suelto con un título.
const HEADING_RE = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/;
// "---", "***" o "___" solos en la línea. Se evalúa antes que BULLET_RE,
// que de otro modo leería "* * *" como un ítem de lista.
const HR_RE = /^(?:-\s*){3,}$|^(?:\*\s*){3,}$|^(?:_\s*){3,}$/;

/** Líneas que abren un bloque propio y por tanto cortan un párrafo o una lista. */
function startsBlock(line: string): boolean {
  return HEADING_RE.test(line) || HR_RE.test(line);
}

/**
 * Lee una lista (ordenada o no) permitiendo que items del marcador opuesto
 * queden anidados bajo el último ítem en vez de cortar la lista en bloques
 * separados. Sin esto, un <ol> con bullets intercalados se partía en varios
 * <ol> de HTML, cada uno reiniciando la numeración en 1.
 */
function readList(lines: string[], start: number, ordered: boolean): { items: ListItem[]; next: number } {
  const marker = ordered ? ORDERED_RE : BULLET_RE;
  const items: ListItem[] = [];
  let i = start;

  const peekContinues = (test: RegExp): boolean => {
    let next = i + 1;
    while (next < lines.length && !lines[next].trim()) next += 1;
    return next < lines.length && test.test(lines[next].trim());
  };

  const peekContinuesPlainText = (): boolean => {
    let next = i + 1;
    while (next < lines.length && !lines[next].trim()) next += 1;
    if (next >= lines.length) return false;
    const candidate = lines[next].trim();
    return !ORDERED_RE.test(candidate) && !BULLET_RE.test(candidate) && !candidate.includes("|") && !startsBlock(candidate);
  };

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (startsBlock(trimmed)) break;

    if (marker.test(trimmed)) {
      items.push({ text: trimmed.replace(marker, ""), nested: [], paragraphs: [] });
      i += 1;
      continue;
    }

    const lastItem = items.length > 0 ? items[items.length - 1] : null;
    // Solo el primer párrafo suelto tras el marcador se considera parte del
    // ítem. Un segundo párrafo más abajo (separado por otra línea en blanco)
    // ya no es continuación del ítem: suele ser una nota o cierre posterior
    // a la lista, y absorberlo lo dejaba mal indentado dentro del último <li>.
    const canAttachLoose = !!lastItem && lastItem.paragraphs.length === 0 && lastItem.nested.length === 0;

    if (!trimmed) {
      // Un ítem "suelto" (loose list item): el marcador va seguido de un
      // párrafo explicativo en blanco. Sin este caso, ese párrafo cortaba el
      // bloque <ol>/<ul> en dos, y el siguiente reiniciaba la numeración en 1.
      if (peekContinues(ORDERED_RE) || peekContinues(BULLET_RE) || (canAttachLoose && peekContinuesPlainText())) {
        i += 1;
        continue;
      }
      break;
    }

    const nestedOrdered = ORDERED_RE.test(trimmed);
    const nestedBullet = BULLET_RE.test(trimmed);
    if ((nestedOrdered || nestedBullet) && items.length > 0) {
      const nestedMarker = nestedOrdered ? ORDERED_RE : BULLET_RE;
      const nestedItems: string[] = [];
      while (i < lines.length) {
        const line = lines[i].trim();
        if (nestedMarker.test(line)) {
          nestedItems.push(line.replace(nestedMarker, ""));
          i += 1;
          continue;
        }
        if (!line) {
          let next = i + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (next < lines.length && nestedMarker.test(lines[next].trim())) {
            i = next;
            continue;
          }
        }
        break;
      }
      items[items.length - 1].nested.push({ ordered: nestedOrdered, items: nestedItems });
      continue;
    }

    if (canAttachLoose) {
      const paraLines: string[] = [];
      while (i < lines.length) {
        const line = lines[i].trim();
        if (!line || ORDERED_RE.test(line) || BULLET_RE.test(line) || line.includes("|") || startsBlock(line)) break;
        paraLines.push(line);
        i += 1;
      }
      if (paraLines.length > 0) {
        items[items.length - 1].paragraphs.push(paraLines);
        continue;
      }
    }

    break;
  }

  return { items, next: i };
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (HR_RE.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(lines[i + 1].trim())
    ) {
      const headers = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitTableRow(lines[i].trim()));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (BULLET_RE.test(trimmed)) {
      const { items, next } = readList(lines, i, false);
      blocks.push({ type: "ul", items });
      i = next;
      continue;
    }

    if (ORDERED_RE.test(trimmed)) {
      const { items, next } = readList(lines, i, true);
      blocks.push({ type: "ol", items });
      i = next;
      continue;
    }

    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        next.includes("|") ||
        BULLET_RE.test(next) ||
        ORDERED_RE.test(next) ||
        startsBlock(next)
      ) {
        break;
      }
      paraLines.push(next);
      i += 1;
    }
    blocks.push({ type: "paragraph", lines: paraLines });
  }

  return blocks;
}

function splitTableRow(row: string): string[] {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// Hallazgo A-8: el prompt (tutorPrompt.ts) exige citar con "[Título](URL)",
// pero esto solo reconocía negrita — el enlace se veía como texto crudo con
// corchetes y paréntesis. Se agregan enlaces y código en línea, sin adoptar
// una librería de Markdown completa: mantener el renderer propio es la razón
// por la que hoy no hay superficie de XSS, y la allowlist de protocolo abajo
// la conserva (bloquea "javascript:" y "data:", entre otros).
const INLINE_TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`)/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

// El modelo a veces mezcla HTML en el Markdown, sobre todo "<br>" dentro de
// celdas de tabla, donde Markdown no admite saltos de línea. No se interpreta
// HTML (eso reabriría la superficie de XSS): solo se reconocen estas etiquetas
// por nombre. "<br>" pasa a salto de línea, "<b>"/"<strong>" a negrita y las
// demás de formato se quitan conservando su texto. Cualquier otra etiqueta
// sigue viéndose como texto.
const HTML_BREAK = /<br\s*\/?>/gi;
const HTML_BOLD = /<(b|strong)(?:\s[^<>]*)?>([\s\S]*?)<\/\1\s*>/gi;
const HTML_FORMATTING = /<\/?(?:b|strong|i|em|u|p|span|div|small|sup|sub|font)(?:\s[^<>]*)?\/?>/gi;

function normalizeInlineHtml(text: string): string {
  return text
    // Si el contenido ya viene en negrita Markdown, no se vuelve a envolver:
    // "****x****" dejaría asteriscos sueltos.
    .replace(HTML_BOLD, (_match: string, _tag: string, inner: string) => /^\*\*[\s\S]*\*\*$/.test(inner) ? inner : `**${inner}**`)
    .replace(HTML_FORMATTING, "");
}

function inlineFormat(text: string): ReactNode[] {
  return formatTokens(normalizeInlineHtml(text));
}

// URL http(s) suelta en el texto. El prompt pide escribir los enlaces como
// [nombre](URL), pero si el modelo deja la URL desnuda también debe poder
// abrirse. La puntuación final ("…pqrds-consulta.") queda fuera del enlace.
const BARE_URL = /(https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?¿¡"'])/i;

function withLinks(text: string): ReactNode[] {
  return text.split(BARE_URL).map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} href={part} target="_blank" rel="noreferrer noopener">
        {part}
      </a>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/** Texto plano: "<br>" a saltos de línea reales y URLs sueltas a enlaces. */
function withBreaks(text: string, key: number): ReactNode {
  const lines = text.split(HTML_BREAK);
  return (
    <Fragment key={key}>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 && <br />}
          {withLinks(line)}
        </Fragment>
      ))}
    </Fragment>
  );
}

function formatTokens(text: string): ReactNode[] {
  const parts = text.split(INLINE_TOKEN);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      // Recursivo: el backend enlaza códigos de formulario que a menudo el
      // modelo ya escribió en negrita ("**Formulario GT-F-0076**").
      return <strong key={index}>{formatTokens(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    const link = LINK.exec(part);
    if (link) {
      if (/^https?:\/\//i.test(link[2])) {
        return (
          <a key={index} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>
        );
      }
      // Protocolo no reconocido (javascript:, data:, mailto: sin validar, etc.):
      // se muestra solo el texto, nunca se convierte en un enlace navegable.
      return <Fragment key={index}>{link[1]}</Fragment>;
    }
    return withBreaks(part, index);
  });
}

type Props = {
  content: string;
  className?: string;
};

export default function ChatMarkdown({ content, className = "" }: Props) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className={`chat-markdown ${className}`.trim()}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const HeadingTag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          return <HeadingTag key={index}>{inlineFormat(block.text)}</HeadingTag>;
        }

        if (block.type === "hr") {
          return <hr key={index} />;
        }

        if (block.type === "paragraph") {
          return (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex > 0 && <br />}
                  {inlineFormat(line)}
                </Fragment>
              ))}
            </p>
          );
        }

        if (block.type === "ul" || block.type === "ol") {
          const ListTag = block.type;
          return (
            <ListTag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {inlineFormat(item.text)}
                  {item.paragraphs.map((paraLines, paraIndex) => (
                    <p key={paraIndex}>
                      {paraLines.map((line, lineIndex) => (
                        <Fragment key={lineIndex}>
                          {lineIndex > 0 && <br />}
                          {inlineFormat(line)}
                        </Fragment>
                      ))}
                    </p>
                  ))}
                  {item.nested.map((sub, subIndex) => {
                    const SubTag = sub.ordered ? "ol" : "ul";
                    return (
                      <SubTag key={subIndex}>
                        {sub.items.map((subItem, subItemIndex) => (
                          <li key={subItemIndex}>{inlineFormat(subItem)}</li>
                        ))}
                      </SubTag>
                    );
                  })}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <div key={index} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th key={headerIndex}>{inlineFormat(header)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{inlineFormat(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
