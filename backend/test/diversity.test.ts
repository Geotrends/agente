/**
 * Contrato de la diversificación del top-k (hallazgo A-6).
 *
 * Los casos son sintéticos y con el resultado calculado a mano, igual que el
 * arnés de A-12: así no dependen de que el corpus real no cambie. La
 * calibración del umbral contra el corpus real está documentada en
 * .env.example (RETRIEVAL_NEAR_DUPLICATE_JACCARD).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diversify } from '../src/services/search.js';
import { jaccard, shingles } from '../src/services/retrievalMath.js';

type Hit = { id: number; doc: string; text: string };

const run = (items: Hit[], options?: Partial<{ limit: number; maxPerDocument: number; nearDuplicateJaccard: number }>) =>
  diversify(items, i => i.doc, i => i.text, {
    limit: 8, maxPerDocument: 3, nearDuplicateJaccard: 0.6, ...options,
  });

/** Texto con suficientes palabras distintas para producir 3-gramas útiles. */
const prose = (seed: string, words = 60) =>
  Array.from({ length: words }, (_, i) => `${seed}${i}`).join(' ');

test('diversify: respeta el tope por documento cuando hay alternativas de sobra', () => {
  // Seis fragmentos del mismo documento compiten con ocho documentos
  // distintos: hay con qué llenar el cupo sin volver al repetido.
  const items: Hit[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: i, doc: 'A.pdf', text: prose(`a${i}`) })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: 10 + i, doc: `B${i}.pdf`, text: prose(`b${i}`) })),
  ];
  const result = run(items, { maxPerDocument: 2 });
  assert.equal(result.length, 8, 'sigue devolviendo el cupo completo');
  assert.equal(result.filter(r => r.doc === 'A.pdf').length, 2, 'solo dos del documento repetido');
  assert.equal(new Set(result.map(r => r.doc)).size, 7, 'siete documentos distintos representados');
});

test('diversify: el tope cede antes que el cupo cuando no hay alternativas suficientes', () => {
  // Seis del mismo documento y solo cinco alternativas: 2 + 5 = 7, así que el
  // octavo puesto tiene que volver al documento repetido. Se prefiere un
  // fragmento de más del mismo archivo antes que devolver menos contexto.
  const items: Hit[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: i, doc: 'A.pdf', text: prose(`a${i}`) })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, doc: `B${i}.pdf`, text: prose(`b${i}`) })),
  ];
  const result = run(items, { maxPerDocument: 2 });
  assert.equal(result.length, 8, 'el cupo manda sobre el tope por documento');
  assert.equal(result.filter(r => r.doc === 'A.pdf').length, 3, 'el octavo puesto vuelve al repetido');
  // Y el que vuelve es el de mejor puntaje de los descartados, no uno al azar.
  assert.equal(result.at(-1)!.id, 2);
});

test('diversify: si NO hay alternativas, rellena y devuelve lo mismo que sin diversificar', () => {
  // Diez fragmentos, todos del mismo documento y todos distintos entre sí.
  const items: Hit[] = Array.from({ length: 10 }, (_, i) => ({ id: i, doc: 'unico.pdf', text: prose(`x${i}`) }));
  const result = run(items, { maxPerDocument: 2 });
  assert.equal(result.length, 8, 'no se devuelven menos resultados por el tope');
  // Y en el orden de relevancia original: los dos primeros por diversidad, el
  // resto por relleno, que respeta el orden en que venían.
  assert.deepEqual(result.map(r => r.id), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('diversify: descarta un casi-duplicado cuando hay con qué reemplazarlo', () => {
  const repetido = prose('repetido');
  const items: Hit[] = [
    { id: 1, doc: 'A.pdf', text: repetido },
    { id: 2, doc: 'B.pdf', text: repetido },            // mismo contenido, otro archivo
    ...Array.from({ length: 8 }, (_, i) => ({ id: 10 + i, doc: `C${i}.pdf`, text: prose(`c${i}`) })),
  ];
  const result = run(items);
  assert.equal(result.length, 8);
  const posicionDelDuplicado = result.findIndex(r => r.id === 2);
  assert.equal(posicionDelDuplicado, -1, 'el casi-duplicado no entra habiendo alternativas');
  assert.ok(result.some(r => r.id === 1), 'pero el primero de los dos sí');
});

test('diversify: un casi-duplicado SÍ entra si no hay nada más con que llenar el cupo', () => {
  const repetido = prose('repetido');
  const items: Hit[] = [
    { id: 1, doc: 'A.pdf', text: repetido },
    { id: 2, doc: 'B.pdf', text: repetido },
  ];
  const result = run(items);
  assert.equal(result.length, 2, 'no se recorta el contexto por deduplicar');
});

test('diversify: funciona sobre candidatos sin logit del reranker (ruta de reserva RRF)', () => {
  // En la ruta de reserva los candidatos no traen `rerank`: diversify no debe
  // asumir que ese campo existe, solo respetar el orden en que llegan.
  const items = [
    { id: 1, doc: 'A.pdf', text: prose('uno') },
    { id: 2, doc: 'A.pdf', text: prose('dos') },
    { id: 3, doc: 'B.pdf', text: prose('tres') },
  ];
  const result = run(items, { maxPerDocument: 1 });
  assert.deepEqual(result.map(r => r.id), [1, 3, 2], 'primero los diversos, el resto de relleno');
});

test('diversify: lista vacía no revienta', () => {
  assert.deepEqual(run([]), []);
});

test('shingles/jaccard: identidad, disyunción y solapamiento parcial', () => {
  const a = shingles('el concejo municipal aprueba el acuerdo de presupuesto anual');
  assert.equal(jaccard(a, a), 1, 'idéntico consigo mismo');
  assert.equal(jaccard(a, shingles('receta de ensalada con tomate lechuga y aceite')), 0, 'sin nada en común');
  // Comparte una frase de cuatro palabras con el primero, pero sigue el resto
  // por su cuenta: parecido parcial, no duplicado.
  const parcial = jaccard(a, shingles('el concejo municipal aprueba otras cosas distintas cada semana'));
  assert.ok(parcial > 0 && parcial < 0.5, `solapamiento parcial fuera de rango: ${parcial}`);
});

test('shingles: ignora tildes y palabras vacías, para que dos copias del mismo texto coincidan', () => {
  const conTildes = shingles('la resolución técnica del área metropolitana define la política');
  const sinTildes = shingles('la resolucion tecnica del area metropolitana define la politica');
  assert.equal(jaccard(conTildes, sinTildes), 1);
});
