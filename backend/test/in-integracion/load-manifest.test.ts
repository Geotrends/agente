/** T062 — el manifiesto de carga está congelado y coincide con el plan vigente del arnés. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSequentialPlan } from "../../scripts/lib/loadRunner.js";

const m = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/in/load-manifest.json", import.meta.url)), "utf8"));

test("manifiesto: 100 preguntas 40/30/30, 10 autorizadas con 10 pares y 10 largas con la convención del arnés", () => {
  assert.equal(m.preguntas.length, 100);
  const por = (k: string) => m.preguntas.filter((p: { kind: string }) => p.kind === k).length;
  assert.deepEqual([por("simple"), por("media"), por("compleja")], [40, 30, 30]);
  assert.equal(m.preguntas.filter((p: { conHistorial: boolean }) => p.conHistorial).length, 10);
  assert.equal(m.preguntas.filter((p: { larga: boolean }) => p.larga).length, 10);
  assert.deepEqual(m.largaConvencion, { minTokens: 700, maxTokens: 2200 });
  assert.equal(new Set(m.preguntas.map((p: { id: string }) => p.id)).size, 100);
  assert.deepEqual(m.oleadas, { cantidad: 3, tamano: 25, autorizadas: 15, conversaciones: 5, anonimas: 10, pausaMs: 120000, registrosPorDia: 75, autorizadosPorDia: 45, anonimosPorDia: 30 });
  assert.match(m.corpus.matrizHash, /^[0-9a-f]{64}$/);
});

test("el manifiesto coincide con el plan que ejecuta el arnés (regenerar de forma deliberada si cambia)", () => {
  assert.deepEqual(m.preguntas, buildSequentialPlan(100).map(p => ({ id: p.id, kind: p.kind, pregunta: p.pregunta, autorizada: p.autorizada, conHistorial: p.conHistorial, larga: p.larga })));
});
