/**
 * Contrato de la selección final (RF-C3-DI-12/14, contracts/retrieval.md), antes la
 * «diversificación» de A-6. Cambió una regla central: lo descartado por duplicado o por el tope
 * por documento YA NO vuelve por relleno; si faltan alternativas se entregan menos fragmentos.
 *
 * Casos sintéticos con el resultado calculado a mano.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFragments } from '../src/services/selection.js';

type Hit = { id: number; doc: string; text: string; rerank: number };

const run = (items: Hit[], threshold = -Infinity, extra: Record<string, number> = {}) =>
  selectFragments(items, {
    threshold, scoreOf: i => i.rerank, idOf: i => i.id, documentOf: i => i.doc, textOf: i => i.text, ...extra,
  });

/** Texto con suficientes palabras distintas para producir 3-gramas útiles. */
const prose = (seed: string, words = 60) => Array.from({ length: words }, (_, i) => `${seed}${i}`).join(' ');

test('varias fuentes útiles: ≤3 por documento y la selección es menor de 8 si faltan alternativas', () => {
  const items: Hit[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: i, doc: 'A.pdf', text: prose(`a${i}`), rerank: 10 - i })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: 10 + i, doc: `B${i}.pdf`, text: prose(`b${i}`), rerank: 4 - i })),
  ];
  const r = run(items);
  assert.equal(r.filter(x => x.doc === 'A.pdf').length, 3, 'tope de 3 por documento');
  assert.equal(r.length, 5, '3 + 2: no se rellena con lo descartado por el tope');
  assert.deepEqual(r.map(x => x.id), [0, 1, 2, 10, 11], 'en orden de puntaje');
});

test('varias fuentes con alternativas de sobra: llega a 8 repartiendo entre documentos', () => {
  const items: Hit[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: i, doc: 'A.pdf', text: prose(`a${i}`), rerank: 20 - i })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: 10 + i, doc: `B${i}.pdf`, text: prose(`b${i}`), rerank: 10 - i })),
  ];
  const r = run(items);
  assert.equal(r.length, 8);
  assert.equal(r.filter(x => x.doc === 'A.pdf').length, 3);
});

test('única fuente útil: hasta 8 fragmentos distintos del mismo documento', () => {
  const items: Hit[] = Array.from({ length: 10 }, (_, i) => ({ id: i, doc: 'unico.pdf', text: prose(`x${i}`), rerank: 10 - i }));
  const r = run(items);
  assert.equal(r.length, 8);
  assert.deepEqual(r.map(x => x.id), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('la «única fuente» se mide DESPUÉS del umbral: si los demás documentos no lo superan, vale la excepción', () => {
  const items: Hit[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: i, doc: 'A.pdf', text: prose(`a${i}`), rerank: 5 - i * 0.1 })),
    { id: 20, doc: 'B.pdf', text: prose('b'), rerank: -4 },
  ];
  assert.equal(run(items, 0).length, 6);
  assert.equal(run(items).length, 4, 'sin umbral B es útil: aplica el tope de 3 (A) + 1 (B)');
});

test('casi duplicado: se conserva el de mayor puntaje y NUNCA vuelve por relleno', () => {
  const base = prose('dup', 80);
  const items: Hit[] = [
    { id: 0, doc: 'A.pdf', text: base, rerank: 9 },
    { id: 1, doc: 'B.pdf', text: base + ' extra', rerank: 8 },
    { id: 2, doc: 'C.pdf', text: prose('otro'), rerank: 1 },
  ];
  const r = run(items);
  assert.deepEqual(r.map(x => x.id), [0, 2]);
  const solo: Hit[] = [items[0], items[1]];
  assert.deepEqual(run(solo).map(x => x.id), [0], 'aunque falte cupo, el duplicado no se reintegra');
});

test('umbral estricto: la igualdad queda fuera y no se rellena bajo el umbral', () => {
  const items: Hit[] = [
    { id: 1, doc: 'A', text: prose('a'), rerank: -3 },
    { id: 2, doc: 'B', text: prose('b'), rerank: 5 },
    { id: 3, doc: 'C', text: prose('c'), rerank: 0 },
    { id: 4, doc: 'D', text: prose('d'), rerank: -0.5 },
  ];
  assert.deepEqual(run(items, 0).map(x => x.id), [2], 'el puntaje 0 con umbral 0 no pasa');
  assert.deepEqual(run(items, -0.5).map(x => x.id), [2, 3]);
  assert.deepEqual(run(items, 99), [], 'umbral muy alto → cero resultados (abstención)');
});

test('orden estable: empates de puntaje se resuelven por id y el resultado no depende del orden de entrada', () => {
  const items: Hit[] = [3, 1, 2].map(id => ({ id, doc: `D${id}`, text: prose(`t${id}`), rerank: 7 }));
  assert.deepEqual(run(items).map(x => x.id), [1, 2, 3]);
  assert.deepEqual(run([...items].reverse()).map(x => x.id), [1, 2, 3]);
});

test('lista vacía no revienta', () => {
  assert.deepEqual(run([]), []);
});
