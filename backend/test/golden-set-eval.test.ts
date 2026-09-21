/**
 * Contrato de las métricas de A-12 (scripts/lib/goldenSet.ts).
 *
 * El plan de la fase 2 exige validar el arnés con casos de respuesta obvia
 * ANTES de confiar en los agregados sobre el conjunto dorado completo. Aquí
 * los "casos obvios" son sintéticos, con el valor esperado calculado a mano —
 * más riguroso que probar contra el corpus real, porque no depende de que el
 * corpus no cambie.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, ndcgAt, reciprocalRank, recallAt, scoreCase, type GoldenCase } from "../scripts/lib/goldenSet.js";

const hit = (path: string): { path: string } => ({ path });
const hits = (...paths: string[]) => paths.map(hit);

test("recallAt: una sola ruta relevante, presente o ausente", () => {
  assert.equal(recallAt(["a"], hits("x", "a", "y")), 1);
  assert.equal(recallAt(["a"], hits("x", "y", "z")), 0);
});

test("recallAt: varias rutas relevantes cuenta la fracción encontrada", () => {
  // Dos de tres relevantes aparecen en el top: 2/3.
  assert.equal(recallAt(["a", "b", "c"], hits("a", "x", "b", "y")), 2 / 3);
});

test("recallAt: sin rutas relevantes declaradas, 0 por definición (no NaN)", () => {
  assert.equal(recallAt([], hits("a", "b")), 0);
});

test("recallAt: solo cuenta dentro de los primeros `at`", () => {
  // "a" es la novena posición: fuera del top-8 por defecto.
  const nine = ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "a"];
  assert.equal(recallAt(["a"], hits(...nine)), 0);
  assert.equal(recallAt(["a"], hits(...nine), 9), 1);
});

test("reciprocalRank: 1/posición del primer acierto, 1-based", () => {
  assert.equal(reciprocalRank(["a"], hits("a", "b", "c")), 1);
  assert.equal(reciprocalRank(["a"], hits("x", "a", "c")), 0.5);
  assert.equal(reciprocalRank(["a"], hits("x", "y", "a")), 1 / 3);
  assert.equal(reciprocalRank(["a"], hits("x", "y", "z")), 0);
});

test("reciprocalRank: con varias rutas relevantes, se queda con la primera que aparece", () => {
  assert.equal(reciprocalRank(["a", "b"], hits("x", "b", "a")), 0.5);
});

test("ndcgAt: un único acierto en la posición 1 es nDCG perfecto", () => {
  assert.equal(ndcgAt(["a"], hits("a", "x", "y")), 1);
});

test("ndcgAt: el mismo acierto más abajo vale menos, calculado a mano", () => {
  // DCG = 1/log2(3) (posición 2, rank=2 → log2(rank+1)=log2(3)); IDCG = 1/log2(2) = 1.
  const score = ndcgAt(["a"], hits("x", "a", "y"));
  const expected = (1 / Math.log2(3)) / 1;
  assert.ok(Math.abs(score - expected) < 1e-12, `${score} vs ${expected}`);
});

test("ndcgAt: dos relevantes, el orden ideal los pone primero — verificado a mano", () => {
  // Relevantes {a, b}. Hits: b en pos1, x en pos2, a en pos3.
  // DCG  = 1/log2(2) + 1/log2(4) = 1 + 0.5 = 1.5
  // IDCG = 1/log2(2) + 1/log2(3) = 1 + 0.6309297535714575 = 1.6309297535714575
  const score = ndcgAt(["a", "b"], hits("b", "x", "a"));
  const dcg = 1 / Math.log2(2) + 1 / Math.log2(4);
  const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);
  assert.ok(Math.abs(score - dcg / idcg) < 1e-12);
  assert.ok(score > 0.9 && score < 1, `nDCG fuera del rango esperado: ${score}`);
});

test("ndcgAt: sin ningún acierto es 0, no división por cero", () => {
  assert.equal(ndcgAt(["a"], hits("x", "y", "z")), 0);
  assert.equal(ndcgAt([], hits("x", "y")), 0);
});

test("scoreCase: factual delega en las tres métricas", () => {
  const golden: GoldenCase = { id: "q1", query: "¿?", kind: "factual", relevantPaths: ["a"] };
  const score = scoreCase(golden, hits("a", "b"));
  assert.equal(score.recallAt8, 1);
  assert.equal(score.mrr, 1);
  assert.equal(score.ndcgAt8, 1);
  assert.equal(score.abstained, undefined, "un caso factual no lleva abstained");
});

test("scoreCase: abstención solo mide si hits vino vacío", () => {
  const golden: GoldenCase = { id: "ab1", query: "¿capital de Francia?", kind: "abstention", relevantPaths: [] };
  assert.equal(scoreCase(golden, []).abstained, true);
  assert.equal(scoreCase(golden, hits("x")).abstained, false);
  assert.equal(scoreCase(golden, hits("x")).recallAt8, undefined, "abstención no lleva recall");
});

test("scoreCase: no evaluable no lleva ninguna métrica, sea lo que sea que devuelva la busqueda", () => {
  const golden: GoldenCase = {
    id: "q15", query: "¿qué dice el acuerdo de 1899?", kind: "unanswerable", relevantPaths: [],
    note: "manuscrito, OCR ilegible",
  };
  for (const found of [[], hits("x", "y")]) {
    const score = scoreCase(golden, found);
    assert.equal(score.recallAt8, undefined);
    assert.equal(score.mrr, undefined);
    assert.equal(score.ndcgAt8, undefined);
    assert.equal(score.abstained, undefined);
  }
});

test("aggregate: promedios calculados a mano sobre un conjunto pequeño y mixto", () => {
  const cases: GoldenCase[] = [
    { id: "q1", query: "a", kind: "factual", relevantPaths: ["x"] },
    { id: "q2", query: "b", kind: "factual", relevantPaths: ["y"] },
    { id: "ab1", query: "c", kind: "abstention", relevantPaths: [] },
    { id: "ab2", query: "d", kind: "abstention", relevantPaths: [] },
    { id: "u1", query: "e", kind: "unanswerable", relevantPaths: [], note: "manuscrito ilegible" },
  ];
  const scores = [
    scoreCase(cases[0], hits("x")),          // recall 1, mrr 1, ndcg 1
    scoreCase(cases[1], hits("z", "w")),     // recall 0, mrr 0, ndcg 0
    scoreCase(cases[2], []),                 // abstuvo: true
    scoreCase(cases[3], hits("z")),          // abstuvo: false
    scoreCase(cases[4], hits("z")),          // no evaluable: no debe tocar ninguna cifra de arriba
  ];
  const report = aggregate(scores, cases);
  assert.equal(report.factualCount, 2, "la no evaluable NO cuenta como factual");
  assert.equal(report.meanRecallAt8, 0.5);
  assert.equal(report.meanMrr, 0.5);
  assert.equal(report.meanNdcgAt8, 0.5);
  assert.deepEqual(report.zeroRecallIds, ["q2"]);
  assert.equal(report.abstentionCount, 2);
  assert.equal(report.abstainedCount, 1);
  assert.deepEqual(report.falseRelevantAbstentionIds, []);
  assert.equal(report.unanswerableCount, 1);
  assert.deepEqual(report.unanswerableIds, ["u1"]);
});

test("aggregate: señala una abstención cuya pregunta en realidad sí tenía fuente relevante", () => {
  // Un caso mal clasificado como abstención: relevantPaths no está vacío.
  // aggregate() debe delatarlo, no aceptarlo en silencio.
  const cases: GoldenCase[] = [
    { id: "ab1", query: "¿en realidad tiene respuesta?", kind: "abstention", relevantPaths: ["x"] },
  ];
  const scores = [scoreCase(cases[0], hits("x"))];
  const report = aggregate(scores, cases);
  assert.deepEqual(report.falseRelevantAbstentionIds, ["ab1"]);
});

test("aggregate: conjunto vacío da promedios en 0, no NaN", () => {
  const report = aggregate([], []);
  assert.equal(report.meanRecallAt8, 0);
  assert.equal(report.meanMrr, 0);
  assert.equal(report.meanNdcgAt8, 0);
});
