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

test("RF-C3-DI-13: una tabla cabe íntegra en un solo fragmento; si excede el límite se divide por filas con el encabezado repetido", () => {
  const filas = (n: number) => Array.from({ length: n }, (_, i) => `| Rubro ${i} | ${i * 1000} | vigencia 2005 |`);
  const tabla = (n: number) => ["| Concepto | Valor | Nota |", "| --- | --- | --- |", ...filas(n)].join("\n");
  const chicas = chunkDocument(`Antes de la tabla.\n\n${tabla(5)}\n\nDespués de la tabla.`);
  assert.equal(chicas.filter(c => c.text.includes(tabla(5))).length, 1, "la tabla viaja entera");
  const grande = tabla(60);
  assert.ok(grande.length > 1000, "la tabla de prueba excede el límite");
  const partes = chunkDocument(`Texto previo.\n\n${grande}\n\nTexto posterior.`).filter(c => c.text.includes("| Rubro "));
  assert.ok(partes.length >= 2, "se divide en varios fragmentos");
  for (const c of partes) {
    assert.ok(c.text.length <= 1000, "cada fragmento respeta el límite");
    assert.ok(c.text.includes("| Concepto | Valor | Nota |\n| --- | --- | --- |"), "cada fragmento repite encabezado y separador");
  }
  // Ninguna fila se pierde ni se duplica, y el orden se conserva.
  const vistas = partes.flatMap(c => c.text.split("\n").filter(l => l.startsWith("| Rubro ")));
  assert.deepEqual(vistas, filas(60));
});

test("RF-C3-DI-13: una fila que no cabe ni sola con su encabezado pasa a prosa; las demás filas siguen siendo tabla", () => {
  const parrafo = Array.from({ length: 220 }, (_, i) => `palabra${i}`).join(" "); // ~1900 caracteres
  const md = ["| Políticas de Operación |", "| --- |", "| Fila corta uno |", `| ${parrafo} |`, "| Fila corta dos |"].join("\n");
  const chunks = chunkDocument(md);
  assert.ok(chunks.every(c => c.text.length <= 1000), "ningún fragmento supera 1000");
  const prosa = chunks.filter(c => c.text.includes("palabra"));
  assert.ok(prosa.length >= 2, "el párrafo se parte en varios fragmentos");
  assert.ok(prosa.every(c => !c.text.includes("|")), "la prosa no lleva barras de tabla");
  assert.ok(prosa[0].text.startsWith("Políticas de Operación — palabra0"), "conserva el título del encabezado");
  // Solapamiento aproximado de 150 caracteres y ninguna palabra partida.
  for (let k = 1; k < prosa.length; k++) {
    const previo = prosa[k - 1].text.split(/\s+/), actual = prosa[k].text.split(/\s+/);
    assert.ok(previo.includes(actual[0]), "el fragmento siguiente repite el final del anterior");
  }
  const dichas = new Set(chunks.flatMap(c => c.text.match(/palabra\d+/g) ?? []));
  assert.equal(dichas.size, 220, "no se pierde ninguna palabra ni se corta alguna");
  // Las filas cortas siguen como tabla, con su encabezado.
  assert.ok(chunks.some(c => c.text.includes("| Fila corta uno |") && c.text.includes("| Políticas de Operación |\n| --- |")));
  assert.ok(chunks.some(c => c.text.includes("| Fila corta dos |")));
  // Una palabra de más de 1000 caracteres sigue bloqueando la publicación.
  assert.throws(() => chunkDocument(`| H |\n| --- |\n| ${"x".repeat(1100)} |`), (e: unknown) => e instanceof ChunkingError && e.finding.kind === "palabra_excede");
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
