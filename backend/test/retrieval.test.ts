import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { BM25, chunkText, reciprocalRankFusion } from '../src/services/retrievalMath.js';
import { cosine } from './oracles.js';
import { preprocessDocument } from '../src/services/documentPreprocessor.js';
import { pickProvider } from '../src/services/providerRouter.js';
import { loadSourceMetadata } from '../src/services/sourceMetadata.js';

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
test('M-11: un solapamiento de la mitad o más se rechaza, porque el bucle no terminaría', () => {
  const text = '0123456789'.repeat(30);
  // El caso real del hallazgo: size=200, overlap=150. El retroceso por
  // frontera de palabra puede dejar `end` en start+101, y `start = end -
  // overlap` retrocede a start-49. Antes esto colgaba el proceso.
  assert.throws(() => chunkText(text, 200, 150), /no termina|overlap/);
  assert.throws(() => chunkText(text, 100, 50), /overlap/);
  assert.throws(() => chunkText(text, 100, -1), /negativo/);
  // Justo por debajo del límite sigue siendo válido y avanza siempre.
  const chunks = chunkText(text, 100, 49);
  assert.ok(chunks.length > 0);
  assert.equal(chunks.join('').length >= text.length, true);
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
    const extraction = await preprocessDocument(filePath);
    assert.ok(extraction.ok);
    assert.equal(extraction.text, 'Titulo\n\nContenido');
  });
});
test('document preprocessing converts every spreadsheet sheet to Markdown tables', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Nombre', 'Estado'], ['Alfa', 'Activo']]), 'Servicios');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Codigo', 'Valor'], ['A-1', 10]]), 'Datos');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  await withTempDocument('.xlsx', buffer, async filePath => {
    const extraction = await preprocessDocument(filePath);
    assert.ok(extraction.ok);
    assert.match(extraction.text, /## Hoja: Servicios/);
    assert.match(extraction.text, /\| Nombre \| Estado \|/);
    assert.match(extraction.text, /## Hoja: Datos/);
    assert.match(extraction.text, /\| A-1 \| 10 \|/);
  });
});
test('crawler CSV metadata enriches Markdown and document paths without indexing CSV files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geobot-metadata-'));
  try {
    await fs.mkdir(path.join(root, 'metadata'));
    await fs.writeFile(path.join(root, 'metadata', 'paginas.csv'), [
      '\uFEFFid,title,url,local_md_path,category,depth,http_status,content_length,content_sha256,scraped_at,dynamic_suspected',
      'page-1,"Calidad del aire, Envigado",https://ambientometroenvigado.com/calidad/,paginas_md/aire/calidad.md,aire,1,200,100,abc,2026-01-01,false'
    ].join('\r\n'));
    await fs.writeFile(path.join(root, 'metadata', 'documentos.csv'), [
      'id,filename,local_path,extension,mime_type,file_size_bytes,sha256,source_url,source_page_url,link_text,category,http_status,downloaded_at,duplicate_of',
      `doc-1,informe.pdf,documentos/pdf/informe.pdf,pdf,application/pdf,42,${'a'.repeat(64)},https://ambientometroenvigado.com/informe.pdf,https://ambientometroenvigado.com/informes/,"Informe, anual",ruido,200,2026-01-01,`
    ].join('\n'));
    const catalog = await loadSourceMetadata(root);
    assert.deepEqual(catalog.byPath.get('paginas_md/aire/calidad.md'), {
      title: 'Calidad del aire, Envigado',
      sourceUrl: 'https://ambientometroenvigado.com/calidad/',
      category: 'aire'
    });
    assert.equal(catalog.byPath.get('documentos/pdf/informe.pdf')?.title, 'Informe, anual');
    assert.equal(catalog.byPath.get('documentos/pdf/informe.pdf')?.sourcePageUrl, 'https://ambientometroenvigado.com/informes/');
    assert.equal(catalog.byPath.size, 2);
    assert.equal(catalog.signature.length, 64);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('automatic routing honors the only configured provider', () => {
  const names = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'AUTO_ROUTE_SIMPLE_FALLBACK_PROVIDER'];
  const saved = names.map(n => process.env[n]);
  try {
    names.forEach(n => delete process.env[n]);
    process.env.DEEPSEEK_API_KEY = 'test';
    process.env.AUTO_ROUTE_SIMPLE_FALLBACK_PROVIDER = 'deepseek';
    assert.equal(pickProvider({ message: 'Hola', historyLength: 0 }).provider, 'deepseek');
  } finally { names.forEach((n, i) => saved[i] === undefined ? delete process.env[n] : process.env[n] = saved[i]); }
});
