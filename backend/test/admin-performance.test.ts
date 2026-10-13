import test from "node:test";
import assert from "node:assert/strict";
import { percentil95, PANTALLAS, resumir, volumenCumple } from "../scripts/lib/adminPerformance.js";

test("p95 por rango más cercano: con 20 muestras es la 19.ª ordenada", () => {
  const m = Array.from({ length: 20 }, (_, i) => (i + 1) * 100); // 100..2000
  assert.equal(percentil95(m), 1900);
  assert.equal(percentil95([...m].reverse()), 1900);
  assert.equal(percentil95([5]), 5);
  assert.throws(() => percentil95([]));
});

test("un error de carga nunca se trata como rápido: arrastra el p95 sobre el umbral", () => {
  const ok = resumir("matriz", Array.from({ length: 20 }, () => 120), 0);
  assert.equal(ok.cumple, true);
  const conError = resumir("matriz", Array.from({ length: 19 }, () => 120), 1);
  assert.equal(conError.cumple, false);
  assert.ok(conError.p95Ms > 3000 || conError.maxMs > 3000);
  assert.equal(resumir("lenta", Array.from({ length: 20 }, () => 3500), 0).cumple, false);
});

test("las ocho pantallas contractuales y los volúmenes mínimos", () => {
  assert.equal(PANTALLAS.length, 8);
  assert.deepEqual(volumenCumple({ documentos: 1000, interacciones: 100000, auditorias: 10000 }), []);
  assert.equal(volumenCumple({ documentos: 999, interacciones: 100000, auditorias: 9999 }).length, 2);
});
