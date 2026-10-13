/**
 * Vector BM25 disperso (T017, research R3).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BM25_B, BM25_K1, hashTermino, vectorBm25, vectorConsulta } from "../src/kb/sparse.js";

test("el hash de término es determinista y de 32 bits sin signo", () => {
  assert.equal(hashTermino("esterilizacion"), hashTermino("esterilizacion"));
  assert.notEqual(hashTermino("esterilizacion"), hashTermino("adopcion"));
  for (const t of ["a", "microchip", "ñandú", "x".repeat(200)]) {
    const h = hashTermino(t);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  }
});

test("mismo tokenizador que el BM25 anterior: sin tildes, sin mayúsculas, sin stopwords", () => {
  const a = vectorBm25("Esterilización de las MASCOTAS", 10);
  const b = vectorBm25("esterilizacion mascotas", 10);
  assert.deepEqual(a, b);
});

test("tf saturado BM25 con k1=1,2 y b=0,75", () => {
  // Un documento de longitud igual a avgdl: norma = 1.
  const v = vectorBm25("microchip microchip registro", 3);
  const peso = (tf: number) => (tf * (BM25_K1 + 1)) / (tf + BM25_K1);
  const i = v.indices.indexOf(hashTermino("microchip"));
  assert.ok(Math.abs(v.values[i] - peso(2)) < 1e-12);
  assert.ok(BM25_B === 0.75);
});

test("un documento más largo que el promedio pesa menos cada término", () => {
  const corto = vectorBm25("microchip", 10);
  const largo = vectorBm25("microchip " + "palabra ".repeat(40), 10);
  const i = hashTermino("microchip");
  assert.ok(corto.values[corto.indices.indexOf(i)] > largo.values[largo.indices.indexOf(i)]);
});

test("índices ordenados y sin duplicados (formato que exige Qdrant)", () => {
  const v = vectorBm25("uno dos tres dos uno cuatro", 6);
  assert.deepEqual([...v.indices].sort((a, b) => a - b), v.indices);
  assert.equal(new Set(v.indices).size, v.indices.length);
});

test("la pregunta anterior pesa menos que la actual, salvo términos repetidos", () => {
  const v = vectorConsulta([{ text: "cuanto demora microchip", weight: 1 }, { text: "registro mascotas microchip", weight: 0.3 }]);
  const peso = (t: string) => v.values[v.indices.indexOf(hashTermino(t))];
  assert.equal(peso("demora"), 1);
  assert.equal(peso("registro"), 0.3);
  assert.equal(peso("microchip"), 1, "una palabra repetida en la pregunta actual es del usuario");
});
