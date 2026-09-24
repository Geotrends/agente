import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resetAuthSecret } from "../src/services/auth.js";
import {
  ChatAdmissionQueue, ChatQueueError, ChatTrafficController,
} from "../src/services/chatTraffic.js";

const originalEnv = { ...process.env };

async function fixture(nowValue = Date.parse("2026-09-24T12:00:00Z")) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-traffic-"));
  let now = nowValue;
  process.env.AUTH_JWT_SECRET = "test-secret-that-is-long-enough-for-traffic";
  process.env.CHAT_LIMIT_STATE_FILE = path.join(directory, "traffic.json");
  resetAuthSecret();
  return {
    directory,
    controller: new ChatTrafficController(() => now),
    setNow(value: number) { now = value; },
    async cleanup() { await fs.rm(directory, { recursive: true, force: true }); },
  };
}

function configureDefaults(): void {
  process.env.CHAT_DAILY_PER_IP_LIMIT = "100";
  process.env.CHAT_DAILY_GLOBAL_LIMIT = "1000";
  process.env.CHAT_DAILY_ALERT_PERCENTAGES = "10,25,50,75,90,100";
  process.env.CHAT_LONG_MESSAGE_CHARS = "1500";
  process.env.CHAT_LONG_MESSAGE_HOURLY_LIMIT = "10";
  process.env.CHAT_LONG_MESSAGE_BLOCK_HOURS = "24";
  process.env.CHAT_MAX_CONCURRENT = "4";
  process.env.CHAT_MAX_QUEUE = "24";
  process.env.CHAT_QUEUE_TIMEOUT_MS = "30000";
}

test.beforeEach(configureDefaults);
test.after(() => {
  process.env = originalEnv;
  resetAuthSecret();
});

test("cuotas por IP y global persisten sin guardar la IP original", async () => {
  const f = await fixture();
  process.env.CHAT_DAILY_PER_IP_LIMIT = "2";
  process.env.CHAT_DAILY_GLOBAL_LIMIT = "3";
  process.env.CHAT_DAILY_ALERT_PERCENTAGES = "50,100";
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    assert.deepEqual(await f.controller.consumeDailyQuota("203.0.113.7"), { ok: true });
    assert.deepEqual(await f.controller.consumeDailyQuota("203.0.113.7"), { ok: true });
    assert.equal((await f.controller.consumeDailyQuota("203.0.113.7")).ok, false);
    assert.deepEqual(await f.controller.consumeDailyQuota("198.51.100.9"), { ok: true });
    const global = await f.controller.consumeDailyQuota("198.51.100.10");
    assert.equal(global.ok, false);
    if (!global.ok) assert.equal(global.code, "daily_global_limit");

    const saved = await fs.readFile(path.join(f.directory, "traffic.json"), "utf8");
    assert.doesNotMatch(saved, /203\.0\.113\.7|198\.51\.100\.9/);
    assert.equal(warnings.filter(line => line.includes("percentage=50")).length, 1);
    assert.equal(warnings.filter(line => line.includes("percentage=100")).length, 1);

    const afterRestart = new ChatTrafficController(() => Date.parse("2026-09-24T12:30:00Z"));
    const persisted = await afterRestart.consumeDailyQuota("203.0.113.7");
    assert.equal(persisted.ok, false);
    if (!persisted.ok) assert.equal(persisted.code, "daily_global_limit");
  } finally {
    console.warn = originalWarn;
    await f.cleanup();
  }
});

test("el cupo diario se reinicia al cambiar el día UTC", async () => {
  const f = await fixture(Date.parse("2026-09-24T23:59:59Z"));
  process.env.CHAT_DAILY_PER_IP_LIMIT = "1";
  assert.deepEqual(await f.controller.consumeDailyQuota("203.0.113.8"), { ok: true });
  assert.equal((await f.controller.consumeDailyQuota("203.0.113.8")).ok, false);
  f.setNow(Date.parse("2026-09-25T00:00:01Z"));
  assert.deepEqual(await f.controller.consumeDailyQuota("203.0.113.8"), { ok: true });
  await f.cleanup();
});

test("la consulta larga posterior al límite bloquea la IP durante 24 horas", async () => {
  const start = Date.parse("2026-09-24T10:00:00Z");
  const f = await fixture(start);
  process.env.CHAT_LONG_MESSAGE_HOURLY_LIMIT = "2";
  assert.deepEqual(await f.controller.checkAndRecordLongRequest("203.0.113.9", 1500), { ok: true });
  assert.deepEqual(await f.controller.checkAndRecordLongRequest("203.0.113.9", 1501), { ok: true });
  assert.deepEqual(await f.controller.checkAndRecordLongRequest("203.0.113.9", 1501), { ok: true });
  const blocked = await f.controller.checkAndRecordLongRequest("203.0.113.9", 1501);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.code, "ip_temporarily_blocked");
    assert.equal(blocked.retryAfterSeconds, 24 * 60 * 60);
  }
  assert.equal((await f.controller.checkAndRecordLongRequest("203.0.113.9", 20)).ok, false,
    "el bloqueo afecta también las preguntas cortas posteriores");
  assert.deepEqual(await f.controller.checkAndRecordLongRequest("198.51.100.2", 20), { ok: true });
  f.setNow(start + 24 * 60 * 60 * 1_000 + 1);
  assert.deepEqual(await f.controller.checkAndRecordLongRequest("203.0.113.9", 20), { ok: true });
  await f.cleanup();
});

test("la cola es FIFO, se acota y retira clientes desconectados", async () => {
  process.env.CHAT_MAX_CONCURRENT = "2";
  process.env.CHAT_MAX_QUEUE = "2";
  const queue = new ChatAdmissionQueue();
  const release1 = await queue.acquire();
  const release2 = await queue.acquire();
  const order: number[] = [];
  const third = queue.acquire().then(release => { order.push(3); return release; });
  const abort = new AbortController();
  const fourth = queue.acquire(abort.signal);
  await assert.rejects(queue.acquire(), (error: unknown) =>
    error instanceof ChatQueueError && error.code === "chat_queue_full");
  abort.abort();
  await assert.rejects(fourth, /client_disconnected/);
  assert.deepEqual(queue.status(), { active: 2, queued: 1, averageMs: 10000 });
  release1();
  const release3 = await third;
  assert.deepEqual(order, [3]);
  release2();
  release3();
  assert.equal(queue.status().active, 0);
});

test("una espera que vence sale de la cola con código estable", async () => {
  process.env.CHAT_MAX_CONCURRENT = "1";
  process.env.CHAT_MAX_QUEUE = "1";
  process.env.CHAT_QUEUE_TIMEOUT_MS = "100";
  const queue = new ChatAdmissionQueue();
  const release = await queue.acquire();
  await assert.rejects(queue.acquire(), (error: unknown) =>
    error instanceof ChatQueueError && error.code === "chat_queue_timeout");
  assert.equal(queue.status().queued, 0);
  release();
});
