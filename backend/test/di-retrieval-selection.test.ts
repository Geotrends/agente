import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CANDIDATES, MAX_SELECTED, selectFragments, selectWithoutReranker } from "../src/services/selection.js";
import { reciprocalRankFusion } from "../src/services/retrievalMath.js";

const ranking = (ids: number[]) => ids.map((id, i) => ({ id, score: 100 - i }));

test("5 trazas: ambos métodos aportan, ≤16 candidatos al reranker y ≤8 fragmentos de mayor a menor relevancia", () => {
  for (let t = 0; t < 5; t++) {
    // BM25 y denso comparten algunos ids y aportan otros propios (top 40 cada uno).
    const bm25 = ranking(Array.from({ length: 40 }, (_, i) => i + t));
    const denso = ranking(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1000 + i + t : i + t)));
    const fusion = reciprocalRankFusion([bm25, denso]);
    const candidatos = fusion.slice(0, MAX_CANDIDATES);
    assert.ok(candidatos.length <= 16);
    const idsBm25 = new Set(bm25.map(r => r.id)); const idsDenso = new Set(denso.map(r => r.id));
    assert.ok(candidatos.some(c => idsBm25.has(c.id)), "aporta el léxico");
    assert.ok(candidatos.some(c => idsDenso.has(c.id)), "aporta el denso");
    assert.ok(candidatos.some(c => idsBm25.has(c.id) && idsDenso.has(c.id)), "los acuerdos de ambos suben en la fusión");
    assert.equal(new Set(candidatos.map(c => c.id)).size, candidatos.length, "sin duplicar puntos");
    const puntuados = candidatos.map((c, i) => ({ id: c.id, rerank: 10 - i * 0.5 + (t % 2 ? 0.1 * (c.id % 3) : 0), doc: `d${c.id % 9}`, text: `fragmento único ${c.id} ${"x".repeat(c.id)}` }));
    const final = selectFragments(puntuados, { threshold: -Infinity, scoreOf: c => c.rerank, idOf: c => c.id, documentOf: c => c.doc, textOf: c => c.text });
    assert.ok(final.length <= MAX_SELECTED);
    for (let i = 1; i < final.length; i++) assert.ok(final[i - 1].rerank >= final[i].rerank, "orden por relevancia");
  }
  assert.equal(MAX_CANDIDATES, 16);
  assert.equal(MAX_SELECTED, 8);
});

test("reranker caído: exactamente los 8 mejores de RRF, en su orden, sin umbral ni diversificación", () => {
  for (let caso = 0; caso < 3; caso++) {
    const fusion = reciprocalRankFusion([ranking(Array.from({ length: 30 }, (_, i) => i)), ranking(Array.from({ length: 30 }, (_, i) => 29 - i))]);
    const candidatos = fusion.slice(0, 16);
    const elegidos = selectWithoutReranker(candidatos);
    assert.equal(elegidos.length, 8);
    assert.deepEqual(elegidos.map(c => c.id), candidatos.slice(0, 8).map(c => c.id), "mismo orden de la fusión");
  }
  assert.deepEqual(selectWithoutReranker([{ id: 1 }, { id: 2 }]).map(c => c.id), [1, 2], "con menos de 8 entrega los que haya");
});
