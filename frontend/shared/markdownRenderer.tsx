/**
 * Renderizador Markdown → React por lista blanca (RF-C4-UI-03, RNF-C4-UI-03).
 *
 * El texto se parsea a AST (unified + remark-parse + GFM) y se convierte a nodos React solo con:
 *   p br strong em ul ol li table thead tbody tr th td h3 h4 a
 * No hay `dangerouslySetInnerHTML`. El HTML bruto del modelo NO se interpreta: sus nodos se eliminan
 * (única excepción: la etiqueta literal `<br>`, muy usada por los modelos dentro de celdas, que el
 * renderer sustituye por su propio `<br>`). H1/H2 → h3, H5/H6 → h4; `code`/`pre` → texto; `hr` se
 * omite; imágenes → su texto alternativo. Atributos: `a` (href https validado, target, rel,
 * aria-label) y `th scope="col"`; ningún otro y jamás de la entrada.
 */
import { Fragment, type ReactNode } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { PhrasingContent, Root, RootContent, TableRow } from "mdast";
import { ExternalLink } from "./ExternalLink";
import { safeHttpsUrl } from "./safeUrl";

const processor = unified().use(remarkParse).use(remarkGfm);
const MAX_DEPTH = 24;
const BR_HTML = /^<br\s*\/?>$/i;

/** Texto plano de un nodo (para el nombre accesible de enlaces y para código/imagen). */
function plainText(node: RootContent | PhrasingContent | Root): string {
  if ("value" in node && typeof node.value === "string") return node.type === "html" ? "" : node.value;
  if (node.type === "image") return node.alt ?? "";
  if ("children" in node) return (node.children as Array<RootContent>).map(plainText).join("");
  return "";
}

/**
 * Texto que sobrevive de un bloque HTML bruto: se eliminan por completo comentarios y los elementos
 * activos o de incrustación (con su contenido) y luego todas las etiquetas. Nunca se interpreta marcado.
 */
function htmlText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript|title|textarea|select|form)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*$/gi, "")
    .replace(/<[^>]*>?/g, "")
    .trim();
}

let key = 0;
const k = () => `m${key++}`;

function inline(nodes: PhrasingContent[], depth: number): ReactNode[] {
  const out: ReactNode[] = [];
  for (const n of nodes) {
    if (depth > MAX_DEPTH) break;
    switch (n.type) {
      case "text": {
        // Los saltos simples del modelo se conservan como <br> (comportamiento heredado).
        const parts = n.value.split("\n");
        parts.forEach((p, i) => {
          if (i > 0) out.push(<br key={k()} />);
          if (p) out.push(p);
        });
        break;
      }
      case "strong": out.push(<strong key={k()}>{inline(n.children, depth + 1)}</strong>); break;
      case "emphasis": out.push(<em key={k()}>{inline(n.children, depth + 1)}</em>); break;
      case "delete": out.push(<Fragment key={k()}>{inline(n.children, depth + 1)}</Fragment>); break;
      case "inlineCode": out.push(n.value); break;
      case "break": out.push(<br key={k()} />); break;
      case "image": if (n.alt) out.push(n.alt); break;
      case "html":
        if (BR_HTML.test(n.value.trim())) out.push(<br key={k()} />);
        break; // cualquier otro HTML bruto se elimina
      case "link": {
        const href = safeHttpsUrl(n.url);
        const children = inline(n.children, depth + 1);
        // Enlace no https (http, mailto, tel, javascript, data): queda solo el texto.
        out.push(href
          ? <ExternalLink key={k()} href={href} label={plainText(n) || href} inResponse>{children}</ExternalLink>
          : <Fragment key={k()}>{children}</Fragment>);
        break;
      }
      case "linkReference":
      case "footnoteReference":
      case "imageReference":
        out.push(plainText(n));
        break;
      default:
        break;
    }
  }
  return out;
}

function tableRow(row: TableRow, header: boolean, depth: number): ReactNode {
  return (
    <tr key={k()}>
      {row.children.map(cell => header
        ? <th key={k()} scope="col">{inline(cell.children, depth + 1)}</th>
        : <td key={k()}>{inline(cell.children, depth + 1)}</td>)}
    </tr>
  );
}

function blocks(nodes: RootContent[], depth: number): ReactNode[] {
  const out: ReactNode[] = [];
  if (depth > MAX_DEPTH) return out;
  for (const n of nodes) {
    switch (n.type) {
      case "paragraph": out.push(<p key={k()}>{inline(n.children, depth + 1)}</p>); break;
      case "heading": {
        const Tag = n.depth <= 2 ? "h3" : n.depth === 3 ? "h3" : "h4";
        out.push(<Tag key={k()}>{inline(n.children, depth + 1)}</Tag>);
        break;
      }
      case "list": {
        const items = n.children.map(item => {
          // Lista compacta: el párrafo único se desenvuelve; el resto conserva sus bloques.
          const kids = item.children;
          const content = kids.length === 1 && kids[0].type === "paragraph" && !item.spread
            ? inline(kids[0].children, depth + 2)
            : blocks(kids as RootContent[], depth + 2);
          return <li key={k()}>{content}</li>;
        });
        out.push(n.ordered ? <ol key={k()}>{items}</ol> : <ul key={k()}>{items}</ul>);
        break;
      }
      case "table": {
        const [head, ...body] = n.children;
        // El contenedor con scroll horizontal pertenece al shell, fuera del subárbol permitido.
        out.push(
          <div key={k()} className="table-scroll" role="region" aria-label="Tabla de la respuesta" tabIndex={0}>
            <table>
              {head && <thead>{tableRow(head, true, depth)}</thead>}
              {body.length > 0 && <tbody>{body.map(r => tableRow(r, false, depth))}</tbody>}
            </table>
          </div>,
        );
        break;
      }
      case "blockquote": out.push(...blocks(n.children, depth + 1)); break; // sin <blockquote>
      case "code": out.push(<p key={k()}>{n.value}</p>); break;
      case "thematicBreak": break;
      case "html": {
        if (BR_HTML.test(n.value.trim())) { out.push(<br key={k()} />); break; }
        const text = htmlText(n.value);
        if (text) out.push(<p key={k()}>{text}</p>);
        break;
      }
      default:
        if ("children" in n) out.push(...blocks(n.children as RootContent[], depth + 1));
    }
  }
  return out;
}

/** Convierte Markdown del modelo en nodos React seguros. */
export function renderMarkdown(source: string): ReactNode[] {
  key = 0;
  const tree = processor.parse(source.replace(/\r\n?/g, "\n"));
  return blocks(tree.children, 0);
}
