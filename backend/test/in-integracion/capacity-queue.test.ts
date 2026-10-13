/**
 * T067 — Cola de admisión y capacidad (RNF-C3-IN-03): 25 consultas simultáneas deben ser admitidas
 * en frío (proceso recién iniciado, sin promedio aprendido) sin relajar la cuota ni los límites
 * contractuales, y atendidas con el máximo concurrente configurado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChatAdmissionQueue, ChatQueueError } from "../../src/services/chatTraffic.js";
import { setting } from "../../src/services/settings.js";

/** Lo que calcula la ruta para esperar: plazo restante − 10 s (con unos ms ya consumidos). */
const OPCIONES = { maxWaitMs: 40_000 - 12 - 10_000 };

test("límites contractuales: concurrencia × cola cubre 25 simultáneas", () => {
  assert.ok(setting("chatMaxConcurrent") + setting("chatMaxQueue") >= 25, "8 + 24 ≥ 25");
});

test("25 simultáneas en frío: ninguna se rechaza por «cola ocupada» y todas obtienen su turno", async () => {
  const q = new ChatAdmissionQueue();
  const pendientes = Array.from({ length: 25 }, () => q.acquire(undefined, OPCIONES).then(
    release => ({ ok: true as const, release }), error => ({ ok: false as const, error: error as ChatQueueError })));
  // Atiende de a poco: cada plaza liberada deja pasar a la siguiente.
  const atendidas: boolean[] = [];
  const drenaje = (async () => {
    for (let i = 0; i < 25; i++) {
      const r = await pendientes[i];
      atendidas.push(r.ok);
      if (r.ok) r.release();
    }
  })();
  await drenaje;
  const rechazadas = (await Promise.all(pendientes)).filter(r => !r.ok);
  assert.equal(rechazadas.length, 0, rechazadas.map(r => (r as { error: ChatQueueError }).error.code).join(","));
  assert.equal(atendidas.length, 25);
  assert.equal(q.status().active, 0);
  assert.equal(q.status().queued, 0);
});

test("aun así rechaza lo que de verdad no cabe: la plaza 33 (8 en curso + 24 en cola) recibe «cola llena»", async () => {
  const q = new ChatAdmissionQueue();
  const control = new AbortController();
  const tomas = Array.from({ length: 33 }, () => q.acquire(control.signal, { maxWaitMs: 600_000 }).then(
    release => ({ ok: true as const, release }), (error: ChatQueueError | Error) => ({ ok: false as const, error })));
  await new Promise(r => setTimeout(r, 50));
  const estado = q.status();
  assert.equal(estado.active, 8);
  assert.equal(estado.queued, 24);
  const llena = (await Promise.race(tomas.map((t, i) => (i === 32 ? t : new Promise<never>(() => {}))))) as { ok: boolean; error?: ChatQueueError };
  assert.equal(llena.ok, false);
  assert.equal(llena.error?.code, "chat_queue_full");
  // Limpieza: cancela a las que esperan y libera las activas.
  control.abort();
  await Promise.all(tomas);
  for (const t of await Promise.all(tomas)) if (t.ok) t.release();
});
