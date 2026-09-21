/**
 * Contrato del volcado binario del índice (fase F5).
 *
 * Dos exigencias. La primera, que la ida y vuelta sea exacta: un índice cargado
 * del snapshot tiene que buscar igual que el que lo generó. La segunda, y más
 * importante en producción, que CUALQUIER problema con el archivo degrade a
 * reconstruir en lugar de romper: el snapshot es un artefacto desechable y una
 * copia corrupta nunca debe tumbar el arranque.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BM25 } from "../src/services/retrievalMath.js";
import {
  loadSnapshot, pruneSnapshots, saveSnapshot, snapshotPathFor,
} from "../src/services/indexSnapshot.js";

const DIMENSIONS = 8;
const ROOT = "/corpus/principal";
const SIGNATURE = "a".repeat(64);

const DOCUMENTS = [
  "ambientometro/aire.md",
  "ambientometro/ruido.md",
  "concejo/acuerdo-001.pdf",
];
const TEXTS = [
  "calidad del aire y material particulado en Envigado",
  "ruido ambiental y acústica urbana",
  "acuerdo municipal sobre vertimientos y permisos",
];

function makeSnapshot() {
  const snippets = TEXTS.flatMap((text, d) => [`${text} — primera parte`, `${text} — segunda parte ${d}`]);
  const count = snippets.length;
  const vectors = new Float32Array(count * DIMENSIONS);
  for (let i = 0; i < vectors.length; i++) vectors[i] = Math.sin(i * 0.37);
  const chunkDoc = Int32Array.from(snippets.map((_, i) => Math.floor(i / 2)));
  const chunkNo = Int32Array.from(snippets.map((_, i) => (i % 2) + 1));
  // M-4: página de origen; 0 significa "este formato no tiene páginas".
  const chunkPage = Int32Array.from(snippets.map((_, i) => (i % 3 === 0 ? 0 : i + 1)));
  const bm25 = new BM25(snippets);
  return {
    source: {
      signature: SIGNATURE, count, documents: DOCUMENTS.length, dimensions: DIMENSIONS,
      docPaths: DOCUMENTS, chunkDoc, chunkNo, chunkPage, snippets, vectors,
      bm25: bm25.toSnapshot(),
    },
    bm25,
  };
}

async function withCacheDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-snapshot-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("la ida y vuelta conserva el índice completo", async () => {
  await withCacheDir(async dir => {
    const { source, bm25 } = makeSnapshot();
    await saveSnapshot(dir, ROOT, source);
    const restored = await loadSnapshot(dir, ROOT, SIGNATURE);
    assert.ok(restored, "el snapshot debe cargarse");

    assert.equal(restored.count, source.count);
    assert.equal(restored.documents, source.documents);
    assert.equal(restored.dimensions, DIMENSIONS);
    assert.deepEqual(restored.docPaths, DOCUMENTS);
    assert.deepEqual(restored.snippets, source.snippets);
    assert.deepEqual([...restored.chunkDoc], [...source.chunkDoc]);
    assert.deepEqual([...restored.chunkNo], [...source.chunkNo]);
    assert.deepEqual([...restored.chunkPage], [...source.chunkPage]);
    assert.deepEqual([...restored.vectors], [...source.vectors], "los vectores son idénticos bit a bit");

    for (const query of ["ruido ambiental", "vertimientos", "aire Envigado", "acústica"]) {
      assert.deepEqual(restored.bm25.search(query), bm25.search(query), `consulta "${query}"`);
    }
  });
});

test("conserva acentos y caracteres fuera de Latin-1", async () => {
  await withCacheDir(async dir => {
    const { source } = makeSnapshot();
    source.snippets[0] = 'Resolución "0841" — vertimientos · ñandú 😀 αβγ';
    source.docPaths[0] = "ambientometro/á-é-í-ó-ú-ñ.md";
    source.bm25 = new BM25(source.snippets).toSnapshot();
    await saveSnapshot(dir, ROOT, source);
    const restored = await loadSnapshot(dir, ROOT, SIGNATURE);
    assert.equal(restored?.snippets[0], source.snippets[0]);
    assert.equal(restored?.docPaths[0], source.docPaths[0]);
  });
});

test("una firma distinta no carga el snapshot de otra", async () => {
  await withCacheDir(async dir => {
    const { source } = makeSnapshot();
    await saveSnapshot(dir, ROOT, source);
    assert.equal(await loadSnapshot(dir, ROOT, "b".repeat(64)), undefined);
  });
});

test("una raíz documental distinta no carga el snapshot de otra", async () => {
  await withCacheDir(async dir => {
    const { source } = makeSnapshot();
    await saveSnapshot(dir, ROOT, source);
    assert.equal(await loadSnapshot(dir, "/otro/corpus", SIGNATURE), undefined);
  });
});

test("un snapshot ausente, truncado o corrupto degrada a reconstruir", async () => {
  await withCacheDir(async dir => {
    assert.equal(await loadSnapshot(dir, ROOT, SIGNATURE), undefined, "ausente");

    const { source } = makeSnapshot();
    const file = snapshotPathFor(dir, ROOT, SIGNATURE);
    await saveSnapshot(dir, ROOT, source);
    const complete = await fs.readFile(file);

    // Truncado a la mitad: la cabecera se lee pero las secciones no están.
    await fs.writeFile(file, complete.subarray(0, Math.floor(complete.length / 2)));
    assert.equal(await loadSnapshot(dir, ROOT, SIGNATURE), undefined, "truncado");

    // Número mágico equivocado: ni siquiera es uno de nuestros archivos.
    const wrongMagic = Buffer.from(complete);
    wrongMagic.write("XXXX", 0, "ascii");
    await fs.writeFile(file, wrongMagic);
    assert.equal(await loadSnapshot(dir, ROOT, SIGNATURE), undefined, "número mágico");

    // Cabecera ilegible.
    const brokenHeader = Buffer.from(complete);
    brokenHeader.write("{{{{", 8, "ascii");
    await fs.writeFile(file, brokenHeader);
    assert.equal(await loadSnapshot(dir, ROOT, SIGNATURE), undefined, "cabecera rota");

    // Vacío.
    await fs.writeFile(file, Buffer.alloc(0));
    assert.equal(await loadSnapshot(dir, ROOT, SIGNATURE), undefined, "vacío");

    // Y tras restaurarlo, vuelve a cargar: ninguna de las pruebas anteriores
    // dejó estado que impida usar un snapshot sano.
    await fs.writeFile(file, complete);
    assert.ok(await loadSnapshot(dir, ROOT, SIGNATURE), "sano de nuevo");
  });
});

test("la limpieza borra los snapshots viejos de esta raíz y respeta los de otras", async () => {
  await withCacheDir(async dir => {
    const { source } = makeSnapshot();
    await saveSnapshot(dir, ROOT, source);
    await saveSnapshot(dir, ROOT, { ...source, signature: "c".repeat(64) });
    await saveSnapshot(dir, "/otro/corpus", source);

    const removed = await pruneSnapshots(dir, ROOT, "c".repeat(64));
    assert.equal(removed, 1, "solo se borra el obsoleto de esta raíz");
    assert.ok(await loadSnapshot(dir, ROOT, "c".repeat(64)), "el vigente sigue");
    assert.equal(await loadSnapshot(dir, ROOT, SIGNATURE), undefined, "el obsoleto se fue");
    assert.ok(await loadSnapshot(dir, "/otro/corpus", SIGNATURE), "el de otra raíz reciente sobrevive");

    // Envejecido más de un mes, el de la otra raíz sí se recoge: así no se
    // acumulan los de los corpus temporales de las pruebas.
    const old = snapshotPathFor(dir, "/otro/corpus", SIGNATURE);
    const ancient = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await fs.utimes(old, ancient, ancient);
    assert.equal(await pruneSnapshots(dir, ROOT, "c".repeat(64)), 1, "se recoge el abandonado");
    assert.equal(await loadSnapshot(dir, "/otro/corpus", SIGNATURE), undefined);
  });
});
