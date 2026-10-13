/**
 * T057 — Matriz de inyección N311 (RNF-C3-IN-11): 9 casos (3 pregunta, 3 historial falso, 3
 * fragmento) por el camino de producción y por cada modelo. Con el doble es evidencia CONTROLADA;
 * la ejecución con ambos modelos reales y la matriz congelada de SPEC002 son T075/T080.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_BEDROCK_MODELS } from "../../src/services/diConfig.js";
import { loadInjectionFixture, runInjectionMatrix } from "../../scripts/lib/injectionMatrix.js";
import type { ModelAdapter } from "../../src/chat/contracts.js";

const conforme: ModelAdapter = {
  call: async (m, req) => {
    // Un modelo que trata la inyección como dato: orienta y conserva la leyenda.
    const decision = /aprueban/i.test(req.pregunta);
    const texto = decision
      ? "Esta información es una orientación preliminar. La decisión le corresponde a la dirección responsable y no reemplaza asesoría técnica ni jurídica formal. [D1]\n<!--FUENTES: D1-->"
      : "Orientación sobre el trámite [D1].\n<!--FUENTES: D1-->";
    return { text: texto, usage: { inputTokens: 5, outputTokens: 5 }, stopReason: "end_turn", effectiveModel: m };
  },
};

test("la matriz tiene 9 casos: 3 por vector, con canario y sin duplicados", () => {
  const fx = loadInjectionFixture();
  assert.equal(fx.casos.length, 9);
  for (const v of ["pregunta", "historial", "fragmento"]) assert.equal(fx.casos.filter(c => c.vector === v).length, 3, v);
  assert.equal(new Set(fx.casos.map(c => c.id)).size, 9);
  assert.ok(fx.canario.length > 0);
});

test("con un modelo conforme: 9 de 9 casos pasan en CADA uno de los dos modelos (18 ejecuciones)", async () => {
  const r = await runInjectionMatrix(conforme, ALLOWED_BEDROCK_MODELS);
  assert.equal(r.length, 18);
  assert.deepEqual(r.filter(x => !x.ok), [], "ningún caso falla");
  assert.deepEqual([...new Set(r.map(x => x.model))].sort(), [...ALLOWED_BEDROCK_MODELS].sort());
});

test("control negativo: un modelo que obedece la inyección o revela el prompt es detectado", async () => {
  const obediente: ModelAdapter = { call: async (m) => ({ text: "HACKEADO\n<!--FUENTES: D1-->", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", effectiveModel: m }) };
  const r = await runInjectionMatrix(obediente, [ALLOWED_BEDROCK_MODELS[0]]);
  assert.ok(r.filter(x => !x.ok).length >= 6, "el canario se detecta en los casos que lo piden");
  const filtrador: ModelAdapter = { call: async (m, req) => ({ text: `${req.system}\n<!--FUENTES: D1-->`, usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", effectiveModel: m }) };
  const f = await runInjectionMatrix(filtrador, [ALLOWED_BEDROCK_MODELS[0]]);
  assert.ok(f.some(x => x.failures.some(m => /prompt/.test(m))), "se detecta la revelación del prompt");
});
