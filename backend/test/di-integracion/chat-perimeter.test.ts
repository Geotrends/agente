import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatAdminDb, type ChatAdminDb } from "./chatAdminDb.js";
import { setChatPoolForTests } from "../../src/chat/db.js";
import { setCanalesProvider } from "../../src/chat/errors.js";
import { boundedJson, chatWindow, originGuard, perIpRateLimit } from "../../src/chat/perimeter.js";
import { Deadline, FINALIZATION_RESERVE_MS, RETRIEVAL_BUDGET_MS } from "../../src/chat/deadline.js";
import chatConfigRouter from "../../src/routes/chatConfig.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";

const ORIGIN = "https://geobot.ejemplo.gov.co";
Object.assign(process.env, {
  CHAT_ALLOWED_ORIGINS: ORIGIN, CONSENT_POLICY_VERSION: "2026-10", CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica",
});

type Ctx = { db: ChatAdminDb; base: string; port: number; handled: { n: number }; bodyStats: Array<{ read: number; retained: number }>; close: () => Promise<void> };

async function start(): Promise<Ctx> {
  const db = await createChatAdminDb();
  setChatPoolForTests(db.chat);
  setCanalesProvider(async () => (await readContactSnapshot(db.chat))?.inmediatos ?? []);
  chatWindow.reset();
  const handled = { n: 0 };
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api", chatConfigRouter);
  // Maneja como el chat real: perímetro y después el "LLM" (contador).
  const bodyStats: Array<{ read: number; retained: number }> = [];
  app.use((_req, res, next) => { res.on("finish", () => { if (res.locals.bodyStats) bodyStats.push({ ...res.locals.bodyStats }); }); next(); });
  app.post("/api/chat", originGuard(), perIpRateLimit(), boundedJson(), (req, res) => {
    handled.n++;
    res.json({ longitud: String(req.body?.pregunta ?? "").length });
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { db, base: `http://127.0.0.1:${port}/api`, port, handled, bodyStats,
    close: async () => { setChatPoolForTests(undefined); server.close(); await db.close(); } };
}

async function seedContacts(db: ChatAdminDb, whatsapp = "+57 300 111 2233"): Promise<void> {
  await db.admin.query("INSERT INTO admin.contact_reception VALUES (1, 'https://pqrsd.ejemplo.gov.co', $1, 'pqrsd@ejemplo.gov.co')", [whatsapp]);
  await db.admin.query("INSERT INTO admin.contact_general VALUES (1, '(604) 555 0100', 'info@ejemplo.gov.co', 'https://ejemplo.gov.co/contacto') ON CONFLICT (id) DO NOTHING");
  await db.admin.query("INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('Línea de emergencia','Atención 24 h','teléfono','123',1)");
}

const post = (c: Ctx, body: string, headers: Record<string, string> = {}) =>
  fetch(`${c.base}/chat`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body });

test("config pública: 503 sin datos oficiales, 3 llamadas ≤2 s, cambio visible en la siguiente", async () => {
  const c = await start();
  try {
    const vacio = await fetch(`${c.base}/chat/config`);
    assert.equal(vacio.status, 503);
    const e = await vacio.json();
    assert.equal(e.error.codigo, "SERVICIO_NO_DISPONIBLE");
    assert.ok(!JSON.stringify(e).match(/postgres|select|modelo|bedrock/i));

    await seedContacts(c.db);
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const r = await fetch(`${c.base}/chat/config`);
      assert.ok(Date.now() - t0 <= 2000);
      const b = await r.json();
      assert.equal(r.status, 200);
      assert.equal(b.politica.version, "2026-10");
      assert.equal(b.contactos.recepcion.whatsapp, "+57 300 111 2233");
      assert.deepEqual(b.opciones.map((o: { etiqueta: string }) => o.etiqueta), ["Autorizo", "No autorizo"]);
      assert.ok(!JSON.stringify(b).match(/gpt-oss|bedrock|modelo/i));
    }
    await c.db.admin.query("UPDATE admin.contact_reception SET whatsapp = '+57 311 999 0000'");
    const despues = await (await fetch(`${c.base}/chat/config`)).json();
    assert.equal(despues.contactos.recepcion.whatsapp, "+57 311 999 0000", "sin caché: la edición se ve en la consulta siguiente");
  } finally { await c.close(); }
});

test("origen fuera de la lista se rechaza sin llegar al manejador", async () => {
  const c = await start();
  try {
    assert.equal((await post(c, "{}", { origin: "https://malo.example" })).status, 403);
    assert.equal((await post(c, "{}", { origin: ORIGIN })).status, 200);
    // SPEC005 (RNF-C3-IN-04): la ausencia de Origin ya no se admite; antes esta expectativa era 200.
    const sinOrigin = await fetch(`${c.base}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(sinOrigin.status, 403);
    assert.equal(c.handled.n, 1);
  } finally { await c.close(); }
});

test("62 solicitudes en un minuto: 60 válidas y 2 con 429 + Retry-After, sin llegar al manejador", async () => {
  const c = await start();
  try {
    const statuses: number[] = [];
    let retry = "";
    for (let i = 0; i < 62; i++) {
      const r = await post(c, "{}", { origin: ORIGIN, "x-forwarded-for": "7.7.7.7" });
      statuses.push(r.status);
      if (r.status === 429) { retry = r.headers.get("retry-after") ?? ""; await r.text(); }
    }
    assert.equal(statuses.filter(s => s === 200).length, 60);
    assert.equal(statuses.filter(s => s === 429).length, 2);
    assert.ok(Number(retry) >= 1);
    assert.equal(c.handled.n, 60);
  } finally { await c.close(); }
});

test("el límite usa la IP del proxy confiable: falsificar la cabecera no lo evita", async () => {
  const c = await start();
  try {
    let limited = 0;
    for (let i = 0; i < 65; i++) {
      // El proxy real añade la IP verdadera (5.5.5.5) a la derecha; el cliente solo controla lo anterior.
      const r = await post(c, "{}", { "x-forwarded-for": `9.9.9.${i}, 5.5.5.5` });
      if (r.status === 429) limited++;
      await r.text();
    }
    assert.equal(limited, 5);
    const otra = await post(c, "{}", { "x-forwarded-for": "1.1.1.1, 6.6.6.6" });
    assert.equal(otra.status, 200, "otra IP real no comparte el cupo");
  } finally { await c.close(); }
});

test("cuerpo: 128 KiB exactos pasan, 128 KiB+1 dan 413 (también en streaming) y 20.000 caracteres entran", async () => {
  const c = await start();
  try {
    const conTamano = (bytes: number) => {
      const base = '{"pregunta":""}';
      return `{"pregunta":"${"a".repeat(bytes - base.length)}"}`;
    };
    const justo = conTamano(131_072);
    assert.equal(Buffer.byteLength(justo), 131_072);
    assert.equal((await post(c, justo)).status, 200);
    const exceso = conTamano(131_073);
    assert.equal((await post(c, exceso)).status, 413);

    // Streaming sin Content-Length: el tope se aplica contando bytes.
    const status = await new Promise<number>(resolve => {
      const req = http.request({ host: "127.0.0.1", port: c.port, path: "/api/chat", method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked", origin: ORIGIN } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", () => resolve(413));
      const bytes = Buffer.from(exceso);
      for (let i = 0; i < bytes.length; i += 8192) req.write(bytes.subarray(i, i + 8192));
      req.end();
    });
    assert.equal(status, 413);

    const larga = await post(c, JSON.stringify({ pregunta: "p".repeat(20_000) }));
    assert.equal(larga.status, 200);
    assert.equal((await larga.json()).longitud, 20_000, "sin truncar la pregunta");
    assert.equal(c.handled.n, 2, "los rechazos no llegaron al manejador");
  } finally { await c.close(); }
});

test("JSON inválido o tipo distinto: 400 VALIDACION sin detalle interno", async () => {
  const c = await start();
  try {
    const r = await post(c, "{no es json");
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.codigo, "VALIDACION");
    const t = await fetch(`${c.base}/chat`, { method: "POST", headers: { "content-type": "text/plain", origin: ORIGIN }, body: "x" });
    assert.equal(t.status, 400);
  } finally { await c.close(); }
});

test("plazo único: reserva de recuperación/finalización y cancelación incluso en cola", async () => {
  let t = 1_000_000;
  const d = new Deadline(40_000, () => t);
  assert.equal(d.retrievalBudgetMs(), RETRIEVAL_BUDGET_MS);
  const { primaryMs, fallbackMs } = d.attemptBudgets();
  assert.ok(primaryMs + fallbackMs + FINALIZATION_RESERVE_MS <= 39_000, "objetivo operativo <39 s");
  t += 35_000; // pasó casi todo el plazo esperando en cola
  assert.equal(d.retrievalBudgetMs(), 3_000);
  assert.equal(d.modelBudgetMs(), 2_000);
  t += 5_000;
  assert.equal(d.expired, true);
  assert.throws(() => d.throwIfExpired(), /deadline_exceeded/);
  d.dispose();
  const real = new Deadline(20);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(real.signal.aborted, true);
});

// ── SPEC005 · N304 / N305 / N306 (T050) ─────────────────────────────────────────────────────────

import { startInApp, M20 as MODELO, queueAnswers as llenar, sessionToken as sesion } from "../in-integracion/harness.js";
import { SlidingWindow } from "../../src/chat/perimeter.js";

test("N304 · ocho orígenes: 2 válidos y 6 rechazados con 403 (ausencia y preflight incluidos), 0 LLM y 0 registros", async () => {
  const c = await startInApp();
  try {
    const tk = await sesion(c);
    llenar(c, 4, MODELO);
    const permitido = "https://geobot.ejemplo.gov.co";
    const pre = (origin: string | null) => fetch(`${c.base}/chat`, { method: "OPTIONS", headers: {
      ...(origin ? { origin } : {}), "access-control-request-method": "POST", "access-control-request-headers": "content-type,authorization" } });
    const post = (origin: string | null) => fetch(`${c.base}/chat`, { method: "POST", headers: {
      "content-type": "application/json", authorization: `Bearer ${tk}`, ...(origin ? { origin } : {}) }, body: JSON.stringify({ pregunta: "¿Qué requisitos tiene?" }) });

    // Válidos (2): POST y preflight del origen exacto.
    assert.equal((await post(permitido)).status, 200);
    const okPre = await pre(permitido);
    assert.equal(okPre.status, 204);
    assert.equal(okPre.headers.get("access-control-allow-origin"), permitido);
    const llamadasValidas = c.counters.modelCalls;
    assert.equal(llamadasValidas, 1);

    // Rechazados (6): ausencia, preflight ajeno, subdominio, http, puerto distinto y dominio padre.
    const rechazos: Array<[string, () => Promise<Response>]> = [
      ["sin Origin", () => post(null)],
      ["preflight de origen ajeno", () => pre("https://malo.example")],
      ["subdominio", () => post("https://sub.geobot.ejemplo.gov.co")],
      ["esquema http", () => post("http://geobot.ejemplo.gov.co")],
      ["puerto distinto", () => post("https://geobot.ejemplo.gov.co:8443")],
      ["dominio padre", () => post("https://ejemplo.gov.co")],
    ];
    const filasAntes = (await c.db.migrator.query("SELECT (SELECT count(*) FROM chat.interaction) + (SELECT count(*) FROM chat.anonymous_usage) AS n")).rows[0].n;
    for (const [nombre, f] of rechazos) {
      const r = await f();
      assert.equal(r.status, 403, nombre);
      assert.equal(r.headers.get("access-control-allow-origin"), null, `${nombre}: sin cabeceras CORS`);
      assert.equal(r.headers.get("cache-control"), "no-store");
    }
    assert.equal(c.counters.modelCalls, llamadasValidas, "ningún rechazo llegó al modelo");
    const filasDespues = (await c.db.migrator.query("SELECT (SELECT count(*) FROM chat.interaction) + (SELECT count(*) FROM chat.anonymous_usage) AS n")).rows[0].n;
    assert.equal(filasDespues, filasAntes, "ni dejó registro");
  } finally { await c.close(); }
});

test("N305 · 60 por minuto durante 5 minutos no producen 429; la 61.ª en el mismo minuto sí; otra IP no comparte cupo", () => {
  let t = 0;
  const w = new SlidingWindow(() => t);
  let rechazos = 0;
  // 5 minutos a razón de 60/min exactos (una por segundo).
  for (let i = 0; i < 300; i++) { if (!w.take("ip-a", 60, 60_000).ok) rechazos++; t += 1_000; }
  assert.equal(rechazos, 0, "60/min sostenidos no se limitan");
  // Ráfaga de 62 en 30 s: 60 pasan y 2 se rechazan con Retry-After.
  t = 10 * 60_000;
  const resultados = Array.from({ length: 62 }, () => { t += 30_000 / 62; return w.take(`ip-b`, 60, 60_000); });
  assert.equal(resultados.filter(r => r.ok).length, 60);
  const mal = resultados.filter(r => !r.ok) as Array<{ ok: false; retryAfterSeconds: number }>;
  assert.equal(mal.length, 2);
  assert.ok(mal.every(r => r.retryAfterSeconds >= 1 && r.retryAfterSeconds <= 60));
  assert.equal(w.take("ip-c", 60, 60_000).ok, true, "otra IP real tiene su propio cupo");
});

test("N306 · seis cuerpos: 100 KB y 20.000 caracteres pasan; 131072 pasa; 131073 y 5 MB (con o sin longitud) dan 413 sin acumular", async () => {
  const c = await start();
  try {
    const conTamano = (bytes: number) => `{"pregunta":"${"a".repeat(bytes - '{"pregunta":""}'.length)}"}`;
    const enviar = (cuerpo: string) => post(c, cuerpo);
    assert.equal((await enviar(conTamano(100 * 1024))).status, 200, "100 KB");
    assert.equal((await enviar(JSON.stringify({ pregunta: "ñ".repeat(20_000) }))).status, 200, "20.000 caracteres multibyte (40.000 bytes)");
    assert.equal((await enviar(conTamano(131_072))).status, 200, "131072 exactos");
    assert.equal((await enviar(conTamano(131_073))).status, 413, "131073");
    assert.equal(c.handled.n, 3);

    // 5 MB con Content-Length: se rechaza por la cabecera, sin leer el cuerpo.
    const cinco = 5 * 1024 * 1024;
    const declarado = await new Promise<{ status: number; leidos: number }>(resolve => {
      const req = http.request({ host: "127.0.0.1", port: c.port, path: "/api/chat", method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "content-length": String(cinco) } }, res => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, leidos: req.socket?.bytesWritten ?? 0 });
        req.destroy();
      });
      req.on("error", () => {});
      req.write("{");
    });
    assert.equal(declarado.status, 413);

    // 5 MB en streaming sin Content-Length (chunked): el servidor lo descarta sin acumularlo.
    const antes = c.bodyStats.length;
    const streaming = await new Promise<{ status: number }>(resolve => {
      let escritos = 0; let status = 0;
      const req = http.request({ host: "127.0.0.1", port: c.port, path: "/api/chat", method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "transfer-encoding": "chunked" } }, res => { status = res.statusCode ?? 0; res.resume(); });
      const chunk = Buffer.alloc(64 * 1024, 97);
      const fin = () => resolve({ status });
      req.on("error", fin); req.on("close", fin);
      const pump = () => {
        while (escritos < cinco) {
          const ok = req.write(chunk); escritos += chunk.length;
          if (!ok) { req.once("drain", pump); return; }
        }
        req.end();
      };
      pump();
    });
    assert.equal(streaming.status, 413);
    const s = c.bodyStats[c.bodyStats.length - 1];
    assert.ok(c.bodyStats.length > antes && s, "el perímetro registró lectura");
    assert.equal(s.retained, 0, "tras rechazar no se conserva ningún byte del cuerpo");
    assert.ok(s.read <= 131_072 + 64 * 1024, `solo se contó hasta cruzar el límite (${s.read} bytes)`);
    assert.equal(c.handled.n, 3, "ningún rechazo llegó al manejador");
  } finally { await c.close(); }
});
