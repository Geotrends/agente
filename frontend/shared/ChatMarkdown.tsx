"use client";

import { Fragment, useMemo, type ReactNode } from "react";

type Block =
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

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

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].trim();
        if (/^\d+[.)]\s+/.test(item)) {
          items.push(item.replace(/^\d+[.)]\s+/, ""));
          i += 1;
          continue;
        }

        if (!item) {
          let next = i + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (next < lines.length && /^\d+[.)]\s+/.test(lines[next].trim())) {
            i = next;
            continue;
          }
        }

        break;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        next.includes("|") ||
        /^[-*•]\s+/.test(next) ||
        /^\d+[.)]\s+/.test(next)
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

        if (block.type === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inlineFormat(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inlineFormat(item)}</li>
              ))}
            </ol>
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
