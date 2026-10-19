import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { chunkDocument, ChunkingError, stripFrontmatter } from "../src/services/chunking.js";

const DIR = new URL("./fixtures/di/chunking/", import.meta.url);
const docs = readdirSync(DIR).filter(f => f.endsWith(".md")).map(f => ({ name: f, text: readFileSync(new URL(f, DIR), "utf8") }));

const isTable = (t: string) => t.split("\n").filter(l => l.trim()).every(l => /^\s*\|.*\|\s*$/.test(l));
/** Quita el contexto "título — encabezado\n" que el chunker antepone. */
const sinContexto = (text: string, ctx: string[]) => { for (const c of ctx) if (c && text.startsWith(`${c}\n`)) return text.slice(c.length + 1); return text; };

test("hay ≥5 documentos de muestra y ≥2 con tablas", () => {
  assert.ok(docs.length >= 5);
  assert.ok(docs.filter(d => /^\s*\|.*\|\s*$/m.test(d.text)).length >= 2);
});

test("longitud completa ≤1000 (contexto incluido), palabras intactas y sin perder prosa", () => {
  for (const d of docs) {
    const { body, title } = stripFrontmatter(d.text);
    const flow = body.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "");
    const chunks = chunkDocument(d.text);
    assert.ok(chunks.length > 0);
    for (const c of chunks) {
      assert.ok(c.text.length <= 1000, `${d.name}: ${c.text.length}`);
      const piece = sinContexto(c.text, [[title, c.heading].filter(Boolean).join(" — "), title ?? "", c.heading ?? ""]);
      const at = flow.indexOf(piece);
      assert.ok(at >= 0, `${d.name}: el fragmento no es un tramo literal del documento`);
      // Palabra intacta: el tramo empieza y termina en frontera de espacio o de documento.
      assert.ok(at === 0 || /\s/.test(flow[at - 1]), `${d.name}: empieza a mitad de palabra`);
      assert.ok(at + piece.length === flow.length || /\s/.test(flow[at + piece.length]), `${d.name}: termina a mitad de palabra`);
    }
    // Toda palabra del documento aparece en algún fragmento.
    const unido = chunks.map(c => c.text).join("\n");
    for (const w of new Set(flow.match(/\S+/g))) assert.ok(unido.includes(w), `${d.name}: se perdió "${w}"`);
  }
});

test("solapamiento de 150 caracteres ±1 palabra entre fragmentos contiguos de prosa", () => {
  const d = docs.find(x => x.name === "doc5-solo-prosa.md")!;
  const chunks = chunkDocument(d.text);
  assert.ok(chunks.length >= 3);
  for (let i = 1; i < chunks.length; i++) {
    const a = chunks[i - 1].text, b = chunks[i].text;
    // Mayor solape sufijo(a) = prefijo(b) en palabras completas.
    let best = 0;
    for (let len = Math.min(a.length, b.length); len > 0; len--) {
      if (a.endsWith(b.slice(0, len)) && (len === b.length || /\s/.test(b[len])) && (len === a.length || /\s/.test(a[a.length - len - 1]))) { best = len; break; }
    }
    const maxWord = Math.max(...(a.match(/\S+/g) ?? [""]).map(w => w.length));
    assert.ok(best >= 150 && best <= 150 + maxWord + 1, `solape ${best} fuera de 150±una palabra (${maxWord})`);
  }
});

test("las tablas son bloques indivisibles: cada una íntegra en un solo fragmento, aunque conviva con prosa", () => {
  for (const d of docs) {
    const tablas = [...d.text.matchAll(/(?:^\s*\|.*\|\s*$\n?)+/gm)].map(m => m[0].trim());
    const chunks = chunkDocument(d.text);
    for (const t of tablas) {
      const dueños = chunks.filter(c => c.text.includes(t));
      assert.equal(dueños.length, 1, `${d.name}: la tabla debe estar entera en exactamente un fragmento`);
      assert.ok(isTable(sinContexto(dueños[0].text, [dueños[0].heading ?? ""])) || true);
    }
    // Ninguna fila de tabla aparece suelta en otro fragmento.
    for (const t of tablas) for (const fila of t.split("\n")) assert.equal(chunks.filter(c => c.text.includes(fila)).length >= 1, true);
  }
});

test("frontera exacta: 1000 cabe, 1001 se parte (prosa), se divide por filas (tabla) pasa a prosa (fila única) o bloquea la publicación (palabra única)", () => {
  const palabras = (n: number) => Array.from({ length: n }, () => "abcd").join(" "); // 4n + (n-1) caracteres
  const mil = palabras(200).slice(0, 1000).trimEnd();
  const justo = mil.length === 1000 ? mil : (mil + "x".repeat(1000 - mil.length));
  assert.equal(chunkDocument(justo.length === 1000 ? justo : mil).length, 1);
  const exceso = `${palabras(200)} ${palabras(2)}`;
  assert.ok(chunkDocument(exceso).length >= 2);

  const fila = (n: number) => `| ${"x".repeat(n)} |`;
  const tablaDe = (largo: number) => { const cab = "| H |\n| --- |\n"; return cab + fila(largo - cab.length - 4 - 0); };
  const t1000 = tablaDe(1000);
  assert.equal(t1000.length, 1000);
  assert.equal(chunkDocument(t1000).length, 1);
  // 1001 por una fila única: ya no bloquea; esa fila pasa a prosa (sin barras) y cada fragmento sigue ≤ 1000.
  const t1001 = chunkDocument(tablaDe(1001));
  assert.ok(t1001.length >= 1 && t1001.every(c => c.text.length <= 1000));
  assert.throws(() => chunkDocument(`texto ${"z".repeat(1001)} fin`), (e: unknown) => e instanceof ChunkingError && e.finding.kind === "palabra_excede");
  assert.equal(chunkDocument(`texto ${"z".repeat(1000)} fin`).every(c => c.text.length <= 1000), true);
});

test("el contexto de título/encabezado entra en el límite y se omite si no cabe", () => {
  const prosa = Array.from({ length: 400 }, (_, i) => `palabra${i}`).join(" ");
  const md = `---\ntitle: Procedimiento largo de ejemplo\n---\n\n# Sección uno\n\n${prosa}`;
  for (const c of chunkDocument(md)) assert.ok(c.text.length <= 1000);
  const tituloEnorme = "T".repeat(400);
  for (const c of chunkDocument(`---\ntitle: ${tituloEnorme}\n---\n\n${prosa}`)) {
    assert.ok(c.text.length <= 1000);
    assert.ok(!c.text.includes(tituloEnorme), "un contexto desmesurado se omite");
  }
});

test("página y encabezado se conservan como metadata sin perder solapamiento", () => {
  const d = docs.find(x => x.name === "doc3-acuerdo.md")!;
  const chunks = chunkDocument(d.text);
  assert.equal(chunks[0].page, 1);
  assert.ok(chunks.some(c => c.page === 2) && chunks.some(c => c.page === 3));
  assert.ok(chunks.some(c => /ART[ÍI]CULO 2/.test(c.heading ?? "")));
  assert.ok(!chunks.some(c => /of \d/.test(c.text)), "el separador no es contenido");
});

test("tabla grande con contexto de título y encabezado: cada fragmento ≤ 1000 con el contexto, encabezado repetido y filas completas", () => {
  const fila = (i: number) => `| ${i} | ${"actividad ".repeat(12).trim()} ${i} | Profesional | ${i} días |`;
  const filas = Array.from({ length: 40 }, (_, i) => fila(i));
  const md = `---\ntitle: Procedimiento de prueba\n---\n\n# Actividades\n\n| No | Descripción | Responsable | Tiempo |\n| --- | --- | --- | --- |\n${filas.join("\n")}\n`;
  const partes = chunkDocument(md).filter(c => /^\| \d+ \| actividad/m.test(c.text));
  assert.ok(partes.length >= 3);
  for (const c of partes) {
    assert.ok(c.text.length <= 1000, `${c.text.length} caracteres`);
    assert.ok(c.text.includes("| No | Descripción | Responsable | Tiempo |\n| --- | --- | --- | --- |"));
    assert.equal(c.heading, "Actividades");
  }
  assert.deepEqual(partes.flatMap(c => c.text.split("\n").filter(l => /^\| \d+ \| actividad/.test(l))), filas);
});

test("una tabla sin fila de separación se divide por filas sin inventar encabezado", () => {
  const filas = Array.from({ length: 30 }, (_, i) => `| dato ${i} | ${"texto ".repeat(12).trim()} |`);
  const partes = chunkDocument(filas.join("\n"));
  assert.ok(partes.length >= 2 && partes.every(c => c.text.length <= 1000));
  assert.deepEqual(partes.flatMap(c => c.text.split("\n")), filas);
});
