import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BM25, chunkText, cosine, reciprocalRankFusion } from '../src/services/retrievalMath.js';
import { pickProvider } from '../src/services/providerRouter.js';

test('BM25 matches whole normalized terms and rewards rare terms', () => {
  const index = new BM25(['ruido ruido ambiental', 'ruido ambiental acústica', 'ruidoso']);
  assert.equal(index.search('ACÚSTICA')[0].id, 1);
  assert.deepEqual(index.search('ruido').map(x => x.id).sort(), [0, 1]);
  assert.deepEqual(index.search('inexistente'), []);
});
test('chunks cover tail and overlap without losing source text', () => {
  const text = '0123456789'.repeat(30);
  const chunks = chunkText(text, 100, 20);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].slice(-20), chunks[1].slice(0, 20));
  assert.equal(chunks.at(-1), text.slice(240));
  assert.throws(() => chunkText(text, 10, 10));
});
test('cosine similarity uses vector direction', () => {
  assert.equal(cosine([1, 0], [2, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.throws(() => cosine([1], [1, 2]));
});
test('RRF combines ranks rather than incomparable score scales', () => {
  const results = reciprocalRankFusion([
    [{ id: 0, score: 100 }, { id: 1, score: 2 }],
    [{ id: 1, score: 0.9 }, { id: 2, score: 0.8 }]
  ]);
  assert.equal(results[0].id, 1);
  assert.equal(results[0].score, 1 / 62 + 1 / 61);
  assert.equal(results.length, 3);
});
test('automatic routing honors the only configured provider', () => {
  const names = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY'];
  const saved = names.map(n => process.env[n]);
  try {
    names.forEach(n => delete process.env[n]);
    process.env.DEEPSEEK_API_KEY = 'test';
    assert.equal(pickProvider({ message: 'Hola', historyLength: 0, documentCharLength: 0 }).provider, 'deepseek');
  } finally { names.forEach((n, i) => saved[i] === undefined ? delete process.env[n] : process.env[n] = saved[i]); }
});
