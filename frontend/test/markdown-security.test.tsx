/** T032 (RNF-C4-UI-03): diez cargas maliciosas y tres consultas con marcado. */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ChatMarkdown from "../shared/ChatMarkdown";
import { MessageContent } from "../shared/MessageContent";
import fx from "./fixtures/respuestas.json";

const ALLOWED = new Set(["P", "BR", "STRONG", "EM", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "H3", "H4", "A", "DIV"]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "target", "rel", "aria-label"]),
  TH: new Set(["scope"]),
  DIV: new Set(["class", "role", "aria-label", "tabindex"]), // contenedores del shell (raíz y tabla)
};

function audit(root: Element) {
  const bad: string[] = [];
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (!ALLOWED.has(el.tagName)) bad.push(`<${el.tagName.toLowerCase()}>`);
    for (const a of el.getAttributeNames()) {
      if (!(ALLOWED_ATTRS[el.tagName]?.has(a))) bad.push(`${el.tagName.toLowerCase()}[${a}]`);
    }
    if (el.tagName === "A") {
      expect(el.getAttribute("href")).toMatch(/^https:\/\//);
      expect(el.getAttribute("target")).toBe("_blank");
      expect(el.getAttribute("rel")).toBe("noopener noreferrer");
    }
  }
  return bad;
}

describe("respuestas maliciosas", () => {
  it.each(fx.maliciosas.map((m, i) => [i, m] as const))("carga %i: solo elementos y atributos permitidos, sin ejecución", (_i, md) => {
    (window as unknown as { __pwned?: number }).__pwned = undefined;
    const { container } = render(<ChatMarkdown content={md} />);
    expect(audit(container)).toEqual([]);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(container.innerHTML).not.toMatch(/onerror|onclick|onload|ontoggle|javascript:|<script|<iframe|<style|<img|<svg|style=/i);
  });

  it("conserva el contenido legible de las cargas (texto visible, enlace seguro)", () => {
    const a = render(<ChatMarkdown content={fx.maliciosas[0]} />).container;
    expect(a.textContent).toContain("Texto visible");
    expect(a.textContent).not.toContain("pwned");
    const b = render(<ChatMarkdown content={fx.maliciosas[4]} />).container;
    // El HTML bruto no se interpreta: ni siquiera un <a> "limpio" pasa; queda su texto.
    expect(b.querySelector("a")).toBeNull();
    expect(b.textContent).toContain("enlace");
    const c = render(<ChatMarkdown content={fx.maliciosas[7]} />).container;
    expect(c.querySelectorAll("a")).toHaveLength(0); // ftp, mailto, tel y http solo como texto
    expect(c.textContent).toContain("correo");
    const d = render(<ChatMarkdown content={fx.maliciosas[6]} />).container;
    expect(d.querySelector("img")).toBeNull();
  });

  it("markdown malformado no abre superficies HTML", () => {
    for (const md of ["[a](", "**sin cerrar <b onclick=x>", "| a |\n|--\n| <img onerror=x> |", "<<script>script>alert(1)<</script>/script>"]) {
      const { container } = render(<ChatMarkdown content={md} />);
      expect(audit(container)).toEqual([]);
    }
  });
});

describe("consultas del ciudadano", () => {
  it.each(fx.consultas.map((q, i) => [i, q] as const))("consulta %i se muestra como texto plano", (_i, q) => {
    const { container } = render(<div><MessageContent role="user" content={q} /></div>);
    expect(container.querySelector("script,a,table,strong,em")).toBeNull();
    expect(container.textContent).toBe(q);
  });
});
