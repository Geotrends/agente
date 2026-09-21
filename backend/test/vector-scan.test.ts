/**
 * Contrato de `topKByDot`, el escaneo vectorial que la fase F1 pone en lugar de
 * `map(cosine) + filter + sort + slice`.
 *
 * La prueba central compara contra una referencia ingenua que reproduce el
 * algoritmo anterior literalmente: mismo orden, mismos desempates. Si esta
 * prueba pasa, el cambio de estructura no altera qué fragmentos se recuperan.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { topKByDot, type Ranked } from "../src/services/retrievalMath.js";
import { cosine } from "./oracles.js";

const DIMENSIONS = 8;

/** Generador determinista: las mismas cifras en cada corrida y en cada máquina. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function unit(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? values.map(value => value / norm) : values;
}

function buildStore(count: number, seed = 7): { rows: number[][]; flat: Float32Array } {
  const random = makeRandom(seed);
  const rows = Array.from({ length: count }, () =>
    unit(Array.from({ length: DIMENSIONS }, () => random() * 2 - 1)));
  const flat = new Float32Array(count * DIMENSIONS);
  rows.forEach((row, id) => flat.set(row, id * DIMENSIONS));
  return { rows, flat };
}

/** El algoritmo anterior, tal cual estaba en services/search.ts. */
function referenceTopK(
  rows: number[][], query: number[], k: number, eligible?: (id: number) => boolean,
): Ranked[] {
  return rows
    .map((row, id) => ({ id, score: cosine(query, row) }))
    .filter(result => !eligible || eligible(result.id))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, k);
}

function assertSameRanking(actual: Ranked[], expected: Ranked[], message: string): void {
  assert.deepEqual(actual.map(r => r.id), expected.map(r => r.id), `${message}: orden de ids`);
  for (const [index, result] of expected.entries()) {
    // Float32 en el almacén, float64 en el acumulador: el error es de
    // representación de cada componente, no de la suma.
    assert.ok(
      Math.abs(actual[index].score - result.score) < 1e-6,
      `${message}: puntaje de ${result.id} — ${actual[index].score} vs ${result.score}`,
    );
  }
}

test("topKByDot reproduce el ranking del escaneo exhaustivo anterior", () => {
  const { rows, flat } = buildStore(500);
  const random = makeRandom(99);
  for (let trial = 0; trial < 12; trial++) {
    const query = unit(Array.from({ length: DIMENSIONS }, () => random() * 2 - 1));
    assertSameRanking(
      topKByDot(flat, DIMENSIONS, 0, rows.length, new Float32Array(query), 40),
      referenceTopK(rows, query, 40),
      `consulta ${trial}`,
    );
  }
});

test("topKByDot desempata por id ascendente, como el ordenamiento total", () => {
  // Todos los vectores idénticos: el puntaje empata en los 20.
  const row = unit([1, 1, 0, 0, 0, 0, 0, 0]);
  const rows = Array.from({ length: 20 }, () => [...row]);
  const flat = new Float32Array(rows.length * DIMENSIONS);
  rows.forEach((values, id) => flat.set(values, id * DIMENSIONS));

  const result = topKByDot(flat, DIMENSIONS, 0, rows.length, new Float32Array(row), 5);
  assert.deepEqual(result.map(r => r.id), [0, 1, 2, 3, 4], "gana el id más bajo");
  assertSameRanking(result, referenceTopK(rows, row, 5), "empate total");
});

test("topKByDot filtra durante el recorrido: el top-k es el de los admitidos", () => {
  const { rows, flat } = buildStore(300, 21);
  const query = unit([0.4, -0.2, 0.9, 0.1, -0.5, 0.3, 0.7, -0.1]);
  // Solo los ids múltiplos de 7: los mejores globales quedan fuera casi siempre.
  const eligible = (id: number) => id % 7 === 0;

  const actual = topKByDot(flat, DIMENSIONS, 0, rows.length, new Float32Array(query), 10, eligible);
  assertSameRanking(actual, referenceTopK(rows, query, 10, eligible), "con filtro");
  assert.equal(actual.length, 10);
  assert.ok(actual.every(r => r.id % 7 === 0), "no se cuela ningún id excluido");
});

test("topKByDot respeta el rango [lo, hi) sin tocar el resto", () => {
  const { rows, flat } = buildStore(200, 33);
  const query = unit([1, 0, 0, 0, 0, 0, 0, 0]);
  const [lo, hi] = [50, 90];

  const actual = topKByDot(flat, DIMENSIONS, lo, hi, new Float32Array(query), 8);
  assert.ok(actual.every(r => r.id >= lo && r.id < hi), "todos dentro del rango");
  assertSameRanking(
    actual,
    referenceTopK(rows, query, 8, id => id >= lo && id < hi),
    "rango contiguo",
  );
});

test("topKByDot tolera menos vectores que k, rangos vacíos y dimensión errónea", () => {
  const { rows, flat } = buildStore(3, 5);
  const query = new Float32Array(unit([1, 0, 0, 0, 0, 0, 0, 0]));

  assert.equal(topKByDot(flat, DIMENSIONS, 0, rows.length, query, 40).length, 3);
  assert.deepEqual(topKByDot(flat, DIMENSIONS, 2, 2, query, 40), []);
  assert.deepEqual(topKByDot(flat, DIMENSIONS, 0, rows.length, query, 0), []);
  assert.deepEqual(topKByDot(flat, DIMENSIONS, 0, rows.length, new Float32Array(4), 10), []);
  // Un filtro que no admite nada devuelve vacío, no posiciones sin llenar.
  assert.deepEqual(topKByDot(flat, DIMENSIONS, 0, rows.length, query, 5, () => false), []);
});

test("topKByDot es determinista", () => {
  const { flat } = buildStore(120, 11);
  const query = new Float32Array(unit([0.1, 0.2, -0.3, 0.4, 0.5, -0.6, 0.7, 0.8]));
  assert.deepEqual(
    topKByDot(flat, DIMENSIONS, 0, 120, query, 15),
    topKByDot(flat, DIMENSIONS, 0, 120, query, 15),
  );
});

/**
 * El bucle interno se desenrolla de ocho en ocho, con un bucle de resto para lo
 * que sobra. Las pruebas de arriba usan dimensión 8 —justo un múltiplo—, así que
 * no tocarían ese resto: aquí se barren todas las formas posibles.
 *
 * La exigencia es la máxima que cabe pedir: el puntaje debe salir IDÉNTICO BIT A
 * BIT al de un bucle simple, porque desenrollar no cambia el orden de las sumas
 * y ese orden es lo que fija el último bit de un float.
 */
test("topKByDot suma igual sea cual sea la dimensión, múltiplo de ocho o no", () => {
  const random = makeRandom(31);
  // 1..17 cubre menos de una vuelta, la vuelta exacta y todos los restos; 384 es
  // la dimensión real del modelo en producción.
  for (const dimensions of [...Array.from({ length: 17 }, (_, i) => i + 1), 384]) {
    const count = 60;
    const flat = new Float32Array(count * dimensions);
    for (let i = 0; i < flat.length; i++) flat[i] = random() * 2 - 1;
    const query = new Float32Array(dimensions);
    for (let i = 0; i < dimensions; i++) query[i] = random() * 2 - 1;

    // Referencia: un bucle simple, sin desenrollar, sobre los mismos datos.
    const expected = Array.from({ length: count }, (_, id) => {
      let sum = 0;
      for (let i = 0; i < dimensions; i++) sum += flat[id * dimensions + i] * query[i];
      return { id, score: sum };
    }).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 10);

    const actual = topKByDot(flat, dimensions, 0, count, query, 10);
    assert.deepEqual(actual.map(r => r.id), expected.map(r => r.id), `dimensión ${dimensions}: orden`);
    for (const [index, result] of expected.entries()) {
      assert.equal(actual[index].score, result.score, `dimensión ${dimensions}: puntaje de ${result.id}`);
    }
  }
});
