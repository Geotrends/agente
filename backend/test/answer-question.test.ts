/**
 * Contrato entre recuperación y prompt, probado sin servidor (M-1, M-13).
 *
 * Estas tres funciones vivían en línea dentro del handler HTTP, así que la
 * única forma de ejercitarlas era levantar Express con embeddings reales —lo
 * que hace `http-smoke.ts`, que por eso en la práctica no se corre—. Extraídas
 * a `answerQuestion.ts`, se prueban con una llamada a función.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { formatContextEntry, groupSources, previousContextFor } from "../src/services/answerQuestion.js";

test("el encabezado de fragmento lleva los campos que la regla 7 del prompt necesita para citar", () => {
  const entry = formatContextEntry({
    path: "concejo_envigado/documentos/acuerdos/acuerdo-034-de-2019.pdf",
    snippet: "ARTÍCULO 1. Objeto.",
    title: "Acuerdo 034 de 2019",
    page: 12,
    sourceUrl: "https://concejoenvigado.gov.co/acuerdo-034.pdf",
  });
  assert.match(entry, /Fuente: Acuerdo 034 de 2019/);
  assert.match(entry, /Pagina: 12/);
  assert.match(entry, /URL original: https:\/\/concejoenvigado/);
  assert.ok(entry.endsWith("ARTÍCULO 1. Objeto."), "el texto del fragmento va al final");
});

test("sin título, el encabezado cae al nombre de archivo y no a la ruta entera", () => {
  const entry = formatContextEntry({ path: "a/b/c/acuerdo-12.pdf", snippet: "x" });
  assert.match(entry, /Fuente: acuerdo-12\.pdf/);
  assert.ok(!entry.includes("Fuente: a/b/c/"));
});

test("un documento sin páginas no inventa el campo", () => {
  const entry = formatContextEntry({ path: "pagina.md", snippet: "x" });
  assert.ok(!entry.includes("Pagina:"), "no debe aparecer el campo si no hay página");
});

test("M-4: las fuentes agrupan por documento conservando TODAS las páginas citadas", () => {
  const sources = groupSources([
    { path: "acuerdo.pdf", snippet: "a", page: 12, title: "Acuerdo" },
    { path: "acuerdo.pdf", snippet: "b", page: 3, title: "Acuerdo" },
    { path: "otro.pdf", snippet: "c", page: 1, title: "Otro" },
  ]);
  assert.equal(sources.length, 2, "un elemento por documento");
  const acuerdo = sources.find(s => s.path === "acuerdo.pdf")!;
  // Quedarse con la primera página perdería justo lo que hace verificable la
  // cita cuando la respuesta se apoya en dos pasajes distantes del mismo PDF.
  assert.deepEqual(acuerdo.pages, [3, 12], "ordenadas y sin perder ninguna");
  assert.equal(acuerdo.title, "Acuerdo");
  assert.ok(!("snippet" in acuerdo), "el texto del fragmento no viaja a la UI");
});

test("un documento sin páginas no expone el campo pages", () => {
  const [source] = groupSources([{ path: "x.md", snippet: "a" }]);
  assert.ok(!("pages" in source));
});

test("M-2: la pregunta que se sostiene sola no arrastra el tema anterior", () => {
  const history = [
    { role: "user" as const, content: "¿Cuánto cuesta el impuesto predial?" },
    { role: "assistant" as const, content: "Depende del avalúo." },
  ];
  // Autocontenida: no debe contaminarse con la pregunta previa.
  assert.equal(previousContextFor("¿Qué es el POT de Envigado?", history), undefined);
  // Con referencia previa explícita, sí necesita el contexto.
  assert.ok(previousContextFor("¿y el plazo de ese trámite?", history));
});

test("M-2: sin historial nunca hay contexto previo", () => {
  assert.equal(previousContextFor("¿y eso?", []), undefined);
});
