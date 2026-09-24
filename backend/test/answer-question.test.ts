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
import { fixCarnet, formatContextEntry, groupSources, previousContextFor, selectSources } from "../src/services/answerQuestion.js";

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

test("M-4: marcador FUENTES_USADAS vacío (saludo) no muestra ninguna fuente", () => {
  const allSources = [{ path: "a.pdf" }, { path: "b.pdf" }];
  // El modelo puso <!--FUENTES_USADAS:--> a propósito: no usó nada.
  assert.deepEqual(selectSources([], allSources), []);
});

test("M-4: sin marcador (usedPaths null) se muestran todas por seguridad", () => {
  const allSources = [{ path: "a.pdf" }, { path: "b.pdf" }];
  assert.deepEqual(selectSources(null, allSources), allSources);
});

test("M-4: con fuentes citadas, se filtra solo a las usadas", () => {
  const allSources = [{ path: "a.pdf" }, { path: "b.pdf" }, { path: "c.pdf" }];
  assert.deepEqual(selectSources(["a.pdf"], allSources), [{ path: "a.pdf" }]);
});

test("M-4: cita que no encaja con ningún path cae a mostrar todas (no oculta evidencia)", () => {
  const allSources = [{ path: "a.pdf" }, { path: "b.pdf" }];
  assert.deepEqual(selectSources(["nombre-que-no-existe.pdf"], allSources), allSources);
});

test("'carne' de documento pasa a 'carnet', con artículo masculino", () => {
  // Frases reales: la fuente GT-P-011 escribe "carne" sin tilde.
  assert.equal(fixCarnet("te entregará la “carne de la mascota”"), "te entregará el “carnet de la mascota”");
  assert.equal(fixCarnet("Copia del carne de vacunación."), "Copia del carnet de vacunación.");
  assert.equal(fixCarnet("Entrega del carne Municipal"), "Entrega del carnet Municipal");
  assert.equal(fixCarnet("presentar el carné escaneado"), "presentar el carnet escaneado");
  assert.equal(fixCarnet("Carne de vacunas al día"), "Carnet de vacunas al día");
  assert.equal(fixCarnet("una carne de identificación"), "un carnet de identificación");
});

test("'carne' como alimento no se toca", () => {
  for (const text of [
    "No le des carne cruda a tu mascota.",
    "la carne de res y la carne de cerdo",
    "El consumo de carne en la dieta del animal.",
    "carnetización",
  ]) assert.equal(fixCarnet(text), text);
});
