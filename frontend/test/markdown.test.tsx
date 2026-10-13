/** T031 (RF-C4-UI-03): nueve respuestas → HTML semántico exacto, sin marcas visibles. */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ChatMarkdown from "../shared/ChatMarkdown";
import fx from "./fixtures/respuestas.json";

const html = (md: string) => render(<ChatMarkdown content={md} />).container.querySelector(".markdown-content")!;

describe("pasos → listas ordenadas", () => {
  it.each(fx.pasos.map((p, i) => [i, p] as const))("respuesta de pasos %i", (_i, md) => {
    const root = html(md);
    const ol = root.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll(":scope > li").length).toBeGreaterThanOrEqual(3);
    expect(root.textContent).not.toMatch(/\*\*|^\d+\.\s|\[.+\]\(.+\)/m);
  });
  it("conserva el orden, el énfasis y el enlace con nombre accesible", () => {
    const root = html(fx.pasos[0]);
    const items = [...root.querySelectorAll("ol > li")].map(li => li.textContent);
    expect(items[0]).toContain("GT-F-01");
    expect(items[1]).toContain("cédula");
    expect(root.querySelector("strong")?.textContent).toBe("GT-F-01");
    expect(root.querySelector("em")?.textContent).toBe("cédula");
    const a = root.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://tramites.envigado.gov.co/ventanilla");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("aria-label")).toBe("ventanilla virtual (se abre en una pestaña nueva)");
  });
  it("listas anidadas: ul dentro de li", () => {
    const root = html(fx.pasos[1]);
    expect(root.querySelector("ol > li > ul > li")).not.toBeNull();
  });
});

describe("tablas", () => {
  it.each(fx.tablas.map((t, i) => [i, t] as const))("tabla %i: thead/th scope=col y tbody", (_i, md) => {
    const root = html(md);
    const table = root.querySelector("table")!;
    expect(table.querySelectorAll("thead th").length).toBeGreaterThan(0);
    for (const th of table.querySelectorAll("thead th")) expect(th.getAttribute("scope")).toBe("col");
    expect(table.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    expect(root.textContent).not.toMatch(/\|\s*---|\|---/);
  });
  it("la tabla vive en su propio contenedor con scroll, hermano de los párrafos (fuera del contenido restringido)", () => {
    const root = html(fx.tablas[2]);
    const wrap = root.querySelector(".table-scroll")!;
    expect(wrap.parentElement).toBe(root);
    expect(wrap.getAttribute("tabindex")).toBe("0"); // desplazable con teclado
    expect(wrap.querySelector(":scope > table")).not.toBeNull();
  });
  it("varias tablas generan contenedores independientes", () => {
    const root = html(`${fx.tablas[0]}\n\ntexto\n\n${fx.tablas[1]}`);
    expect(root.querySelectorAll(".table-scroll")).toHaveLength(2);
  });
});

describe("prosa y títulos", () => {
  it("párrafos y énfasis", () => {
    const root = html(fx.prosa[1]);
    expect(root.querySelectorAll("p").length).toBe(2);
    expect(root.querySelector("em")?.textContent).toBe("treinta días hábiles");
  });
  it("H1/H2 → h3, H3 → h3, H4+ → h4; sin '#' visibles", () => {
    const root = html("# Uno\n\n## Dos\n\n### Tres\n\n#### Cuatro\n\n###### Seis");
    expect([...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h => h.tagName)).toEqual(["H3", "H3", "H3", "H4", "H4"]);
    expect(root.textContent).not.toContain("#");
  });
  it("salto simple <br> del modelo y reglas horizontales omitidas", () => {
    const root = html("línea uno\nlínea dos\n\n---\n\nfin");
    expect(root.querySelectorAll("br")).toHaveLength(1);
    expect(root.querySelector("hr")).toBeNull();
  });
  it("<br> literal en una celda se conserva como <br> propio", () => {
    const root = html("| a | b |\n|---|---|\n| uno<br>dos | tres |");
    expect(root.querySelector("td br")).not.toBeNull();
  });
  it("enlace con paréntesis en la URL y URL suelta https", () => {
    const root = html("Ver [norma](https://es.wikipedia.org/wiki/Ley_(derecho)) y https://envigado.gov.co/ruta.");
    const hrefs = [...root.querySelectorAll("a")].map(a => a.getAttribute("href"));
    expect(hrefs[0]).toBe("https://es.wikipedia.org/wiki/Ley_(derecho)");
    expect(hrefs[1]).toBe("https://envigado.gov.co/ruta");
  });
  it("código en línea y bloques quedan como texto, sin code/pre", () => {
    const root = html("Use `GT-P-01` así:\n\n```\nlinea de código\n```");
    expect(root.querySelector("code,pre")).toBeNull();
    expect(root.textContent).toContain("GT-P-01");
    expect(root.textContent).toContain("linea de código");
  });
});
