import test from "node:test";
import assert from "node:assert/strict";
import { classify, callWithRouting, modelsFor, ModelsUnavailableError } from "../src/chat/modelRouting.js";
import { ModelError } from "../src/bedrock/askBedrock.js";
import { Deadline } from "../src/chat/deadline.js";
import { resetCircuits } from "../src/services/circuitBreaker.js";
import type { ModelAdapter, ModelCallResult, ParHistorial } from "../src/chat/contracts.js";

const M20 = "openai.gpt-oss-20b-1:0";
const M120 = "openai.gpt-oss-120b-1:0";

const SIMPLES = ["Hola", "¿Cuál es el horario de atención?", "¿Qué es el RUM?"];
const MEDIAS = [
  "¿Qué requisitos tiene el procedimiento de adopción y cuánto tiempo tarda?",
  "¿Cuál es el plazo y el procedimiento para pedir una visita técnica?",
  "Necesito saber los requisitos y el plazo del registro de mi mascota",
];
const COMPLEJAS = [
  "Compara el procedimiento de adopción con el de registro RUM, indicando requisitos, plazos y responsables, y explica qué normas aplican a cada uno y cómo se relacionan entre sí",
  "Necesito un análisis detallado de las diferencias entre la licencia ambiental y el permiso de aprovechamiento forestal, con sus normas, plazos, costos y responsables, y qué pasa si ambos aplican a la vez",
  "¿Qué dice el artículo 45 de la ley sobre sanciones y multas por incumplimiento y cuál es la diferencia entre ambas?",
];
const par = (i: number): ParHistorial => ({ pregunta: `p${i}`, respuesta: `r${i}` });
const pares = (n: number) => Array.from({ length: n }, (_, i) => par(i));

test("12 clasificaciones: 3 por nivel y 3 simples con 10 pares suben a complejo con puntaje finito y repetible", () => {
  for (const q of SIMPLES) assert.equal(classify(q, []).level, "simple", q);
  for (const q of MEDIAS) assert.equal(classify(q, []).level, "medium", q);
  for (const q of COMPLEJAS) assert.equal(classify(q, []).level, "complex", q);
  for (const q of SIMPLES) {
    const c = classify(q, pares(10));
    assert.equal(c.level, "complex");
    assert.ok(Number.isFinite(c.score) && c.score >= 6);
    assert.deepEqual(classify(q, pares(10)), c, "repetible");
  }
  const n = classify("Compara A y B", pares(12));
  assert.ok(Number.isFinite(n.score));
});

test("20b atiende simple y medio, 120b complejo, el otro es respaldo", () => {
  assert.deepEqual(modelsFor("simple"), { primary: M20, fallback: M120 });
  assert.deepEqual(modelsFor("medium"), { primary: M20, fallback: M120 });
  assert.deepEqual(modelsFor("complex"), { primary: M120, fallback: M20 });
});

const ok = (model: string): ModelCallResult => ({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", effectiveModel: model });

function adapter(plan: Record<string, "ok" | "fail">) {
  const calls: string[] = [];
  const a: ModelAdapter = {
    call: async (id) => {
      calls.push(id);
      if (plan[id] === "ok") return ok(id);
      throw new ModelError("network", true, "503");
    },
  };
  return { a, calls };
}

const NIVELES: Array<["simple" | "medium" | "complex", string]> = [["simple", SIMPLES[1]], ["medium", MEDIAS[0]], ["complex", COMPLEJAS[0]]];

test("9 rutas: principal, respaldo y doble caída por cada nivel, una tentativa por modelo", async () => {
  for (const [level, q] of NIVELES) {
    const { primary, fallback } = modelsFor(level);
    const req = { system: "s", historial: [], pregunta: q };

    resetCircuits();
    let t = adapter({ [primary]: "ok", [fallback]: "ok" });
    let r = await callWithRouting(t.a, req, new Deadline(40_000));
    assert.equal(r.result.effectiveModel, primary);
    assert.deepEqual(t.calls, [primary]);

    resetCircuits();
    t = adapter({ [primary]: "fail", [fallback]: "ok" });
    r = await callWithRouting(t.a, req, new Deadline(40_000));
    assert.equal(r.result.effectiveModel, fallback);
    assert.deepEqual(t.calls, [primary, fallback]);

    resetCircuits();
    t = adapter({ [primary]: "fail", [fallback]: "fail" });
    await assert.rejects(callWithRouting(t.a, req, new Deadline(40_000)), ModelsUnavailableError);
    assert.deepEqual(t.calls, [primary, fallback], "ni un reintento oculto");
  }
});

test("el plazo agotado corta el intento y un circuito abierto se salta sin llamar", async () => {
  resetCircuits();
  // Plazo ya vencido: no hay presupuesto para ningún modelo.
  let clock = 1_000_000;
  const d = new Deadline(5_000, () => clock);
  clock += 6_000;
  const t = adapter({ [M20]: "ok", [M120]: "ok" });
  await assert.rejects(callWithRouting(t.a, { system: "s", historial: [], pregunta: SIMPLES[0] }, d), ModelsUnavailableError);
  assert.equal(t.calls.length, 0);

  // Tres fallos seguidos abren el circuito del 20b; la siguiente consulta va directo al 120b.
  resetCircuits();
  const f = adapter({ [M20]: "fail", [M120]: "ok" });
  for (let i = 0; i < 3; i++) await callWithRouting(f.a, { system: "s", historial: [], pregunta: SIMPLES[0] }, new Deadline(40_000));
  f.calls.length = 0;
  await callWithRouting(f.a, { system: "s", historial: [], pregunta: SIMPLES[0] }, new Deadline(40_000));
  assert.deepEqual(f.calls, [M120]);
  resetCircuits();
});
