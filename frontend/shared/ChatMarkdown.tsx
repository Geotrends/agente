"use client";

import { Fragment, useMemo, type ReactNode } from "react";

type NestedList = { ordered: boolean; items: string[] };
type ListItem = { text: string; nested: NestedList[]; paragraphs: string[][] };

type Block =
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: ListItem[] }
  | { type: "ol"; items: ListItem[] }
  | { type: "table"; headers: string[]; rows: string[][] };

const BULLET_RE = /^[-*•]\s+/;
const ORDERED_RE = /^\d+[.)]\s+/;

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
    return !ORDERED_RE.test(candidate) && !BULLET_RE.test(candidate) && !candidate.includes("|");
  };

  while (i < lines.length) {
    const trimmed = lines[i].trim();

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
        if (!line || ORDERED_RE.test(line) || BULLET_RE.test(line) || line.includes("|")) break;
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
        ORDERED_RE.test(next)
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

function inlineFormat(text: string): ReactNode[] {
  const parts = text.split(INLINE_TOKEN);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
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
    return <Fragment key={index}>{part}</Fragment>;
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
