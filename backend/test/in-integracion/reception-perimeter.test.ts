/**
 * T007 — Recepción y perímetro (RNF-C3-IN-04, RNF-C3-IN-12, RF-C3-IN-04).
 *
 * Estas pruebas deben FALLAR contra las contradicciones de H005-01/04/05 (Origin ausente
 * permitido, preflight respondido por CORS antes del guard, cuota compartida, inicio medido
 * después de la lectura del cuerpo) y pasar tras corregirlas. Origin explícito en el arnés.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, countRows, M20, ORIGIN, post, queueAnswers, rawRequest, sessionToken, startInApp, type InApp } from "./harness.js";

const FOREIGN = "https://malo.example";
const NOSTORE = (h: Headers | Record<string, string | string[] | undefined>): string | null =>
  h instanceof Headers ? h.get("cache-control") : String(h["cache-control"] ?? "") || null;

async function withApp(fn: (c: InApp) => Promise<void>): Promise<void> {
  const c = await startInApp();
  try { await fn(c); } finally { await c.close(); }
}

test("POST sin Origin o con Origin ajeno: 403 no-store antes de sesión, modelo y registro", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    for (const path of ["/chat", "/conversations", "/ratings"]) {
      const sinOrigin = await fetch(`${c.base}${path}`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk}` }, body: "{}" });
      assert.equal(sinOrigin.status, 403, `${path} sin Origin`);
      assert.equal(NOSTORE(sinOrigin.headers), "no-store");
      assert.equal((await sinOrigin.json()).error.codigo, "ORIGEN_NO_PERMITIDO");

      const ajeno = await post(c, path, tk, {}, { origin: FOREIGN });
      assert.equal(ajeno.status, 403, `${path} Origin ajeno`);
      assert.equal(NOSTORE(ajeno.headers), "no-store");
    }
    assert.equal(c.counters.modelCalls, 0);
    assert.equal(await countRows(c, "interaction"), 0);
    assert.equal(await countRows(c, "anonymous_usage"), 0);
  });
});

test("preflight: ajeno 403 antes de CORS; permitido 204 con el origen exacto; método o cabeceras ajenas 403", async () => {
  await withApp(async c => {
    const pre = (origin: string | null, method: string, headers: string) => fetch(`${c.base}/chat`, {
      method: "OPTIONS",
      headers: { ...(origin ? { origin } : {}), "access-control-request-method": method, "access-control-request-headers": headers },
    });
    const ajeno = await pre(FOREIGN, "POST", "content-type,authorization");
    assert.equal(ajeno.status, 403);
    assert.equal(ajeno.headers.get("access-control-allow-origin"), null);
    assert.equal(NOSTORE(ajeno.headers), "no-store");

    const sinOrigin = await pre(null, "POST", "content-type");
    assert.equal(sinOrigin.status, 403);

    const ok = await pre(ORIGIN, "POST", "content-type,authorization");
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    assert.match(ok.headers.get("access-control-allow-methods") ?? "", /POST/);

    assert.equal((await pre(ORIGIN, "PUT", "content-type")).status, 403, "método no permitido");
    assert.equal((await pre(ORIGIN, "POST", "x-evil")).status, 403, "cabecera no permitida");
    assert.equal(c.counters.modelCalls, 0);
  });
});

test("el preflight permitido, la configuración y la sesión no consumen la cuota de 60 consultas/min", async () => {
  await withApp(async c => {
    for (let i = 0; i < 70; i++) {
      const r = await fetch(`${c.base}/chat`, { method: "OPTIONS",
        headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
      assert.equal(r.status, 204);
    }
    for (let i = 0; i < 30; i++) assert.equal((await fetch(`${c.base}/chat/config`)).status, 200);
    const tk = await sessionToken(c);
    for (let i = 0; i < 20; i++) assert.equal((await post(c, "/conversations", tk, { autorizacion: false })).status, 200);

    queueAnswers(c, 61, M20);
    let ok = 0;
    for (let i = 0; i < 60; i++) {
      const r = await post(c, "/chat", tk, { pregunta: `consulta ${i}` });
      if (r.status === 200) ok++;
    }
    assert.equal(ok, 60, "las 60 consultas caben en la ventana");
    const sobra = await post(c, "/chat", tk, { pregunta: "una más" });
    assert.equal(sobra.status, 429);
    assert.ok(Number(sobra.headers.get("retry-after")) >= 1);
    assert.equal(NOSTORE(sobra.headers), "no-store");
  });
});

test("falta de sesión o token inválido: 401 con catálogo y no-store", async () => {
  await withApp(async c => {
    for (const tk of [null, "token-inventado"]) {
      const r = await post(c, "/chat", tk, { pregunta: "hola" });
      assert.equal(r.status, 401);
      assert.equal(NOSTORE(r.headers), "no-store");
      const b = await r.json();
      assert.equal(b.error.codigo, "NO_AUTORIZADO");
      assert.ok(Array.isArray(b.canales));
      assert.ok(!JSON.stringify(b).match(/jwt|jose|secret|signature/i));
    }
    assert.equal(c.counters.modelCalls, 0);
  });
});

test("cuerpo lento: la fecha registrada y la duración parten de la recepción, no de la lectura del cuerpo", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    queueAnswers(c, 1, M20);
    const body = JSON.stringify({ pregunta: "¿Qué requisitos tiene el trámite?", conversationId: conv });
    const third = Math.ceil(body.length / 3);
    const t0 = Date.now();
    const r = await rawRequest(c, {
      path: "/chat", headers: { authorization: `Bearer ${tk}` },
      chunks: [body.slice(0, third), body.slice(third, 2 * third), body.slice(2 * third)], gapMs: 400,
    });
    assert.equal(r.status, 200, r.body);
    const { rows } = await c.db.migrator.query("SELECT received_at, duration_ms FROM chat.interaction");
    assert.equal(rows.length, 1);
    const receivedLag = new Date(rows[0].received_at).getTime() - t0;
    assert.ok(receivedLag < 300, `received_at debe ser la llegada de los encabezados (retraso ${receivedLag} ms)`);
    assert.ok(rows[0].duration_ms >= 750, `la duración incluye la lectura del cuerpo (${rows[0].duration_ms} ms)`);
  });
});

test("GET de configuración del mismo origen admite ausencia de Origin; con Origin ajeno se rechaza", async () => {
  await withApp(async c => {
    assert.equal((await fetch(`${c.base}/chat/config`)).status, 200);
    const ajeno = await fetch(`${c.base}/chat/config`, { headers: { origin: FOREIGN } });
    assert.equal(ajeno.status, 403);
    assert.equal(NOSTORE(ajeno.headers), "no-store");
  });
});
