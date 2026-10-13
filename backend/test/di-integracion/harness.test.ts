import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTER, FakeClock, FakeConverse, loadManifest } from "./harness.js";

test("el manifiesto recoge los 28 criterios DI y se declara doble", () => {
  const m = loadManifest();
  assert.equal(m.casos.length, 28);
  assert.equal(m.adapter, ADAPTER);
  assert.equal(new Set(m.casos.map(c => c.id)).size, 28);
  assert.ok(m.casos.every(c => c.estado === "pendiente"));
});

test("el reloj avanza sin esperar", () => {
  const c = new FakeClock();
  const t0 = c.now();
  c.advanceMinutes(29);
  assert.equal(c.now() - t0, 29 * 60_000);
});

test("el Converse doble sigue su guion y registra las llamadas", async () => {
  const f = new FakeConverse().on("m1", { kind: "ok", text: "hola", inputTokens: 3, outputTokens: 1 });
  const call = { modelId: "m1", system: "s", messages: [], maxTokens: 2200, temperature: 0 };
  assert.equal((await f.send(call)).kind, "ok");
  assert.equal((await f.send(call)).kind, "error");
  assert.equal(f.callsTo("m1").length, 2);
});
