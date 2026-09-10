import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { BM25, chunkText, cosine, reciprocalRankFusion } from '../src/services/retrievalMath.js';
import { preprocessDocument } from '../src/services/documentPreprocessor.js';
import { pickProvider } from '../src/services/providerRouter.js';

async function withTempDocument(extension: string, content: Buffer | string, callback: (filePath: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'geobot-test-'));
  const filePath = path.join(directory, `document${extension}`);
  await fs.writeFile(filePath, content);
  try {
    await callback(filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

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
test('document preprocessing returns normalized Markdown for text files', async () => {
  await withTempDocument('.txt', 'Titulo\r\n\r\n\r\nContenido', async filePath => {
    assert.equal(await preprocessDocument(filePath), 'Titulo\n\nContenido');
  });
});
test('document preprocessing converts every spreadsheet sheet to Markdown tables', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Nombre', 'Estado'], ['Alfa', 'Activo']]), 'Servicios');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Codigo', 'Valor'], ['A-1', 10]]), 'Datos');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  await withTempDocument('.xlsx', buffer, async filePath => {
    const content = await preprocessDocument(filePath);
    assert.match(content, /## Hoja: Servicios/);
    assert.match(content, /\| Nombre \| Estado \|/);
    assert.match(content, /## Hoja: Datos/);
    assert.match(content, /\| A-1 \| 10 \|/);
  });
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
