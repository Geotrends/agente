import assert from "node:assert/strict";
import test from "node:test";
import { chunkDocument, ChunkingError, stripFrontmatter } from "../src/services/chunking.js";

test("M-3: el frontmatter YAML deja de ser el fragmento nº 1 y aporta el título", () => {
  const md = `---\ntitle: Resolución 1541 de 2013\nurl: https://minambiente.gov.co/x\n---\n\nEl olor ofensivo se regula así.`;
  const { body, title } = stripFrontmatter(md);
  assert.equal(title, "Resolución 1541 de 2013");
  assert.ok(!body.includes("url:"), "el frontmatter no debe quedar en el cuerpo");

  const chunks = chunkDocument(md);
  assert.equal(chunks.length, 1);
  assert.ok(!chunks[0].text.includes("https://minambiente.gov.co"), "la metadata no se embebe");
  assert.ok(chunks[0].text.includes("olor ofensivo"));
  // El título sí se conserva, como contexto del fragmento.
  assert.ok(chunks[0].text.includes("Resolución 1541 de 2013"));
});

test("RF-C3-DI-13: los artículos son metadata del fragmento, no cortes: la prosa corrida no pierde solapamiento", () => {
  const texto = [
    "ARTÍCULO 1. Objeto. La presente resolución regula el asunto.",
    "ARTÍCULO 2. Ámbito. Aplica a todo el municipio de Envigado.",
    "ARTÍCULO 3. Vigencia. Rige desde su publicación.",
  ].join("\n");
  const chunks = chunkDocument(texto, 1000, 150);
  assert.equal(chunks.length, 1, "cabe en un fragmento");
  assert.match(chunks[0].heading ?? "", /ART[ÍI]CULO 1/);
  for (const parte of ["Objeto", "Ámbito", "Vigencia"]) assert.ok(chunks[0].text.includes(parte));
});

test('M-3: "el artículo 5 dice" en mitad de un párrafo no abre sección', () => {
  const texto = "Según lo previsto, el artículo 5 dice que el plazo es de treinta días hábiles.";
  const chunks = chunkDocument(texto);
  assert.equal(chunks.length, 1);
});

test("RF-C3-DI-13: una tabla cabe íntegra en un solo fragmento; si excede el límite, el documento no es publicable", () => {
  const filas = (n: number) => Array.from({ length: n }, (_, i) => `| Rubro ${i} | ${i * 1000} | vigencia 2005 |`);
  const tabla = (n: number) => ["| Concepto | Valor | Nota |", "| --- | --- | --- |", ...filas(n)].join("\n");
  const chicas = chunkDocument(`Antes de la tabla.\n\n${tabla(5)}\n\nDespués de la tabla.`);
  assert.equal(chicas.filter(c => c.text.includes(tabla(5))).length, 1, "la tabla viaja entera");
  assert.throws(() => chunkDocument(tabla(60)), (e: unknown) => e instanceof ChunkingError && e.finding.kind === "tabla_excede");
});

test("M-4: el fragmento sabe en qué página del PDF empieza", () => {
  const pagina = (n: number) => Array.from({ length: 150 }, (_, i) => `p${n}w${i}`).join(" ");
  const pdf = ["-- 1 of 3 --", pagina(1), "-- 2 of 3 --", pagina(2), "-- 3 of 3 --", pagina(3)].join("\n");
  const chunks = chunkDocument(pdf);
  assert.equal(chunks[0].page, 1);
  assert.ok(chunks.some(c => c.page === 2), "algún fragmento empieza en la página 2");
  assert.ok(chunks.some(c => c.page === 3), "algún fragmento empieza en la página 3");
  // Y el separador no queda como contenido.
  assert.ok(!chunks.some(c => c.text.includes(" of 3")), "el separador no es contenido");
});

test("M-4: un documento sin páginas no inventa número", () => {
  const chunks = chunkDocument("Texto plano sin separadores de página.");
  assert.equal(chunks[0].page, undefined);
});

test("una sección más larga que el límite se sigue partiendo por tamaño", () => {
  const largo = "ARTÍCULO 1. " + "palabra ".repeat(500);
  const chunks = chunkDocument(largo, 500, 100);
  assert.ok(chunks.length > 1, "la estructura acota dónde cortar, no elimina el límite");
  for (const chunk of chunks) assert.ok(chunk.text.length <= 500);
});

test("no se pierde contenido al fragmentar", () => {
  const texto = [
    "ARTÍCULO 1. Primero y su contenido.",
    "ARTÍCULO 2. Segundo y su contenido.",
  ].join("\n");
  const unido = chunkDocument(texto).map(c => c.text).join(" ");
  for (const palabra of ["Primero", "Segundo", "contenido"]) {
    assert.ok(unido.includes(palabra), `se perdió "${palabra}"`);
  }
});

test("un documento vacío no produce fragmentos rotos", () => {
  assert.deepEqual(chunkDocument("   ").map(c => c.text), [""]);
});
