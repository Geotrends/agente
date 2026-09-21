/**
 * La purga de caché de fragmentos NO puede tocar la de otro corpus (M-11).
 *
 * Esta prueba existe por un daño real: al introducir la purga, una prueba de
 * integración que levanta un corpus de 2 documentos borró 5 GB de caché del
 * corpus de producción, porque ambos comparten `RETRIEVAL_CACHE_DIR` y el
 * nombre de archivo no decía a qué raíz pertenecía. El índice sobrevivió
 * —estaba en memoria— pero el trabajo de horas de reconstrucción, no.
 *
 * Se prueba sobre el comportamiento observable: construir un índice sobre una
 * raíz y comprobar que las entradas de la otra siguen ahí.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'geobot-prune-'));
const corpusA = await fs.mkdtemp(path.join(os.tmpdir(), 'geobot-corpusA-'));
process.env.RETRIEVAL_CACHE_DIR = cacheDir;
process.env.GEOTRENDS_DOCUMENTS_ROOT = corpusA;
process.env.RETRIEVAL_WORKER = 'false';
process.env.INDEX_REVALIDATE_MS = '0';

await fs.writeFile(path.join(corpusA, 'uno.txt'), 'El certificado de estratificación se expide en cinco días hábiles.', 'utf8');

const { hybridSearch } = await import('../src/services/search.js');

test('construir el índice de un corpus no borra la caché de otro', async () => {
  // Entrada que simula la caché de OTRA raíz: prefijo distinto.
  const ajena = path.join(cacheDir, 'ffffffffffff-' + 'a'.repeat(64) + '.json');
  await fs.writeFile(ajena, JSON.stringify({ entries: [] }), 'utf8');

  // Y un reporte, que tampoco debe tocarse.
  const reporte = path.join(cacheDir, '_documentos-sin-texto-ffffffffffff.csv');
  await fs.writeFile(reporte, 'ruta,motivo,detalle\n', 'utf8');

  await hybridSearch('certificado de estratificación');

  assert.ok(await fs.stat(ajena).catch(() => null),
    'la caché de otra raíz fue borrada: es el fallo que esta prueba existe para impedir');
  assert.ok(await fs.stat(reporte).catch(() => null), 'el reporte de otra raíz fue borrado');
});

test('sí purga las entradas obsoletas de su propia raíz', async () => {
  const { rootScope } = await import('../src/services/indexSnapshot.js');
  const propia = path.join(cacheDir, `${rootScope(path.resolve(corpusA))}-${'b'.repeat(64)}.json`);
  await fs.writeFile(propia, JSON.stringify({ entries: [] }), 'utf8');

  // Cambiar el documento fuerza una reconstrucción, y con ella la purga.
  await fs.writeFile(path.join(corpusA, 'uno.txt'), 'Texto distinto para forzar una firma nueva del índice.', 'utf8');
  await hybridSearch('texto distinto');

  assert.equal(await fs.stat(propia).catch(() => null), null,
    'una entrada obsoleta de la propia raíz debe desaparecer');
});

test.after(async () => {
  await Promise.all([
    fs.rm(cacheDir, { recursive: true, force: true }),
    fs.rm(corpusA, { recursive: true, force: true }),
  ]);
});
