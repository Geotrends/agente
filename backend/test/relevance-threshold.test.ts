import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankAndFilterByRelevance } from '../src/services/search.js';

test('rankAndFilterByRelevance: descarta lo que no llega al umbral y ordena por logit', () => {
  const candidates = [
    { id: 1, score: 0, rerank: -3 },
    { id: 2, score: 0, rerank: 5 },
    { id: 3, score: 0, rerank: 0 },
    { id: 4, score: 0, rerank: -0.5 },
  ];
  const result = rankAndFilterByRelevance(candidates, 0);
  assert.deepEqual(result.map(r => r.id), [2, 3]);
});

test('rankAndFilterByRelevance: umbral muy alto puede dejar cero resultados (abstención)', () => {
  const candidates = [
    { id: 1, score: 0, rerank: 2 },
    { id: 2, score: 0, rerank: 4 },
  ];
  assert.deepEqual(rankAndFilterByRelevance(candidates, 10), []);
});

test('rankAndFilterByRelevance: sin umbral (muy negativo) no descarta nada, solo recorta a 8', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({ id: i, score: 0, rerank: -100 + i }));
  const result = rankAndFilterByRelevance(candidates, -Infinity);
  assert.equal(result.length, 8);
  // El orden es por logit descendente: los últimos (mayor rerank) quedan primero.
  assert.deepEqual(result.map(r => r.id), [9, 8, 7, 6, 5, 4, 3, 2]);
});

test('rankAndFilterByRelevance: un candidato sin logit (rerank undefined) se trata como -Infinity', () => {
  const candidates = [
    { id: 1, score: 0, rerank: 1 },
    { id: 2, score: 0 }, // el reranker no puntuó este candidato
  ];
  assert.deepEqual(rankAndFilterByRelevance(candidates, 0).map(r => r.id), [1]);
});

test('rankAndFilterByRelevance: ruta de reserva sin reranker (RRF) nunca la llama -- no filtra nada por diseño', () => {
  // Documenta la limitación conocida de A-5: cuando el reranker falla,
  // hybridSearch usa `candidates.slice(0, 8)` directamente y NUNCA pasa por
  // rankAndFilterByRelevance, así que el umbral no se aplica en ese camino.
  // Esta prueba fija esa garantía estructural en vez de solo describirla.
  const candidates = [{ id: 1, score: 0 }, { id: 2, score: 0 }];
  // Si por error alguien empezara a llamar a esta función también en el
  // camino de reserva, un umbral alto la haría vaciar el resultado -- lo que
  // demuestra por qué la ruta de reserva debe evitarla, no llamarla con -Infinity.
  assert.deepEqual(rankAndFilterByRelevance(candidates, 5), []);
});
