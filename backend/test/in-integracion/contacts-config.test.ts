/**
 * T046 — Lectura de contactos oficiales (RF-C3-IN-10, C310): tres lecturas ≤ 2 s con los valores
 * del registro, una edición visible en la lectura siguiente sin redespliegue, 0 llamadas al modelo
 * y una base que no responde produce error a tiempo (sin esperar de más).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { startInApp } from "./harness.js";

test("C310 · 3 lecturas ≤2 s con los valores del registro, edición visible en la siguiente y 0 llamadas al modelo", async () => {
  const c = await startInApp();
  try {
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const r = await fetch(`${c.base}/chat/config`);
      assert.ok(Date.now() - t0 <= 2_000);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "no-store");
      const b = await r.json();
      assert.equal(b.contactos.recepcion.whatsapp, "+57 300 000 1111");
      assert.equal(b.contactos.inmediatos[0].value, "123");
      assert.equal(b.opciones.length, 2);
    }
    await c.db.admin.query("UPDATE admin.contact_reception SET whatsapp = '+57 311 999 0000'");
    const nuevo = await (await fetch(`${c.base}/chat/config`)).json();
    assert.equal(nuevo.contactos.recepcion.whatsapp, "+57 311 999 0000", "sin redespliegue ni caché");
    assert.equal(c.counters.modelCalls, 0);
    assert.equal(c.counters.searches, 0);
  } finally { await c.close(); }
});

test("C310 · tablas bloqueadas: 503 en ≤ 2,5 s con el catálogo y sin detalles; al liberar, vuelve a servir", async () => {
  const c = await startInApp();
  try {
    const holder = await c.db.migrator.connect();
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE admin.contact_reception IN ACCESS EXCLUSIVE MODE");
    try {
      const t0 = Date.now();
      const r = await fetch(`${c.base}/chat/config`);
      const ms = Date.now() - t0;
      const texto = await r.text();
      assert.equal(r.status, 503);
      assert.ok(ms <= 2_500, `respondió en ${ms} ms`);
      assert.equal(JSON.parse(texto).error.codigo, "SERVICIO_NO_DISPONIBLE");
      assert.ok(!/lock|admin\.|postgres|select/i.test(texto));
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    assert.equal((await fetch(`${c.base}/chat/config`)).status, 200);
    assert.equal(c.db.chat.waitingCount, 0);
  } finally { await c.close(); }
});
