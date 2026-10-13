import test from "node:test";
import assert from "node:assert/strict";
import { followUpTail, tailOf } from "../src/chat/handleChat.js";
import { buildReport, CalibrationError, chooseThreshold, runSweep, sweepValues, type CalibrationQuestion } from "../src/kb/calibration.js";
import { evaluateRow, runtimeVersions } from "../src/services/calibration.js";

const SEGUIMIENTOS = ["¿y el plazo?", "¿Y cuánto cuesta eso?", "¿Cuál es el plazo de ese trámite?", "¿y para el caso anterior?", "según lo anterior, ¿qué sigue?"];
const AUTONOMAS = [
  "¿Qué requisitos tiene el registro de una mascota en el RUM de Envigado?",
  "¿Dónde puedo denunciar el maltrato animal en el municipio de Envigado?",
  "¿Cuál es el procedimiento para solicitar una visita técnica de arbolado urbano?",
  "¿Qué documentos necesito para la adopción de un gato en Bienestar Animal?",
  "¿Cómo se tramita una licencia ambiental para un proyecto en Envigado?",
];

test("5 seguimientos reciben cola y 5 preguntas autónomas no", () => {
  const previa = "¿Qué requisitos tiene el registro de una mascota en el RUM?";
  for (const q of SEGUIMIENTOS) assert.equal(followUpTail(q, previa), previa, q);
  for (const q of AUTONOMAS) assert.equal(followUpTail(q, previa), undefined, q);
  assert.equal(followUpTail("¿y el plazo?", undefined), undefined, "sin pregunta previa no hay cola");
});

test("cola ≤500 caracteres en límite de palabra; una palabra mayor de 500 deja la cola vacía", () => {
  const larga = Array.from({ length: 200 }, (_, i) => `palabra${i}`).join(" ");
  const cola = tailOf(larga);
  assert.ok(cola.length <= 500);
  assert.ok(larga.endsWith(cola));
  assert.ok(/^palabra\d+/.test(cola), "empieza en palabra completa");
  assert.equal(tailOf("corta"), "corta");
  assert.equal(tailOf("x".repeat(600)), "");
  assert.equal(tailOf(`hola ${"y".repeat(700)}`), "", "palabra gigante → vacía, no mutilada");
});

const q = (id: string, kind: "respondible" | "ausente", scores: number[]): CalibrationQuestion => ({
  id, kind, candidates: scores.map((rerank, i) => ({ id: i, rerank, documentId: `${id}-doc${i}`, text: `texto ${id} ${i} ${"palabra ".repeat(20)}${i}` })),
});

test("barrido: umbral = mayor valor finito con cero falsas abstenciones; guarda todos los valores y preguntas", () => {
  const preguntas = [
    q("r1", "respondible", [8, 3, -2]),
    q("r2", "respondible", [5, 1]),
    q("r3", "respondible", [2.5, 0.5, -4]),
    q("a1", "ausente", [-6, -9]),
    q("a2", "ausente", [1.5, -3]),
  ];
  const valores = sweepValues(preguntas);
  assert.ok(valores.every(Number.isFinite));
  assert.equal(valores[0], -10, "piso por debajo del mínimo observado");
  const filas = runSweep(preguntas);
  assert.equal(filas.length, valores.length, "una fila por valor");
  const elegido = chooseThreshold(filas)!;
  // r3 tiene su mejor puntaje en 2.5: con umbral < 2.5 las tres respondibles conservan un fragmento.
  assert.equal(elegido, 1.5, "el mayor valor observado < 2.5 (mínimo de los máximos)");
  assert.equal(filas.find(f => f.value === elegido)!.falseAbstentions, 0);
  assert.ok(filas.find(f => f.value === 2.5)!.falseAbstentions === 1, "con 2.5 la igualdad queda fuera y r3 se abstiene");
  const informe = buildReport(preguntas, { corpusAlias: "kb_chunks", coleccion: "kb_chunks_x", corpusHash: "h", goldenSetHash: "g", embeddingVersion: "e", rerankerVersion: "r" });
  assert.equal(informe.selectedThreshold, 1.5);
  assert.deepEqual(informe.respondibles, ["r1", "r2", "r3"]);
  assert.deepEqual(informe.ausentes, ["a1", "a2"]);
  assert.equal(informe.barrido.length, informe.valores.length);
  assert.ok(Number.isFinite(informe.selectedThreshold) && informe.regla.includes("cero falsas abstenciones"));
});

test("sin ningún valor válido es un error de calibración (no se activa a ojo ni con -Infinity)", () => {
  const imposible = [q("r1", "respondible", [3]), q("r2", "respondible", []), q("a1", "ausente", [-5])];
  assert.throws(() => buildReport(imposible, { corpusAlias: "a", coleccion: "c", corpusHash: "h", goldenSetHash: "g", embeddingVersion: "e", rerankerVersion: "r" }),
    (e: unknown) => e instanceof CalibrationError && /Ningún umbral finito/.test(e.message));
  assert.throws(() => buildReport([q("a1", "ausente", [1])], { corpusAlias: "a", coleccion: "c", corpusHash: "h", goldenSetHash: "g", embeddingVersion: "e", rerankerVersion: "r" }), CalibrationError);
});

test("una calibración deja de valer si cambian embedding, reranker o reglas de selección", () => {
  const v = runtimeVersions();
  const fila = { umbral: -1.5, embedding_version: v.embedding, reranker_version: v.reranker, politica_version: v.politica };
  assert.equal(evaluateRow("c", fila).estado, "vigente");
  assert.equal(evaluateRow("c", undefined).estado, "ausente");
  for (const [campo, motivo] of [["embedding_version", "embedding"], ["reranker_version", "reranker"], ["politica_version", "política de selección"]] as const) {
    const r = evaluateRow("c", { ...fila, [campo]: "otra" });
    assert.equal(r.estado, "incompatible");
    assert.ok(r.estado === "incompatible" && r.motivos.includes(motivo));
  }
  assert.equal(evaluateRow("c", { ...fila, umbral: Number.NEGATIVE_INFINITY }).estado, "incompatible");
});
