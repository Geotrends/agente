/**
 * T017 (lado servidor): «No autorizo» sin contexto ni registro, bypass de UUID y versión de política
 * rechazados, y ningún texto del ciudadano en las tablas ni en los registros de log.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, countRows, post, POLICY, queueAnswers, sessionToken, startUiApp } from "./app.js";

test("No autorizo: 4 consultas, sin filas de conversación ni interacción, sin historial hacia el proveedor", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 4);
    const tk = await sessionToken(c);
    assert.equal((await post(c, "/conversations", tk, { autorizacion: false })).status, 200);
    for (const q of ["uno", "dos", "tres", "cuatro"]) assert.equal((await post(c, "/chat", tk, { pregunta: q })).status, 200);
    assert.deepEqual(c.seen.historial, [0, 0, 0, 0]);
    assert.equal(await countRows(c, "conversation"), 0);
    assert.equal(await countRows(c, "interaction"), 0);
    assert.equal(await countRows(c, "anonymous_usage"), 4);
  } finally { await c.close(); }
});

test("versión de política desactualizada y UUID elegido por el navegador: rechazados sin escritura", async () => {
  const c = await startUiApp();
  try {
    const tk = await sessionToken(c);
    assert.equal((await post(c, "/conversations", tk, { autorizacion: true, policyVersion: "otra" })).status, 400);
    assert.equal((await post(c, "/conversations", tk, { autorizacion: true, policyVersion: POLICY, conversationId: "11111111-1111-4111-8111-111111111111" })).status, 400);
    assert.equal(await countRows(c, "conversation"), 0);
    // Consulta con un UUID bien formado que el backend no emitió.
    queueAnswers(c, 1);
    const r = await post(c, "/chat", tk, { pregunta: "x", conversationId: "22222222-2222-4222-8222-222222222222" });
    assert.equal(r.status, 400);
    assert.equal(c.converse.calls.length, 0);
  } finally { await c.close(); }
});

test("el texto del ciudadano autorizado queda solo en chat.interaction y nunca en conversation ni en logs", async () => {
  const c = await startUiApp();
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    queueAnswers(c, 1);
    const tk = await sessionToken(c);
    const id = await authorize(c, tk);
    const secreta = "consulta única sobre mi predio rural";
    assert.equal((await post(c, "/chat", tk, { pregunta: secreta, conversationId: id })).status, 200);
    const conv = JSON.stringify((await c.db.migrator.query("SELECT row_to_json(t) j FROM chat.conversation t")).rows);
    assert.ok(!conv.includes("predio"));
    const inter = (await c.db.migrator.query("SELECT question_text FROM chat.interaction")).rows;
    assert.equal(inter.length, 1);
    assert.ok(!logs.join("\n").includes("predio"), "el texto no aparece en ningún log");
  } finally {
    Object.assign(console, orig);
    await c.close();
  }
});
