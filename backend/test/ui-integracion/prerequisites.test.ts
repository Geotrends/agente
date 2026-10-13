/**
 * T008 · Prerrequisitos de SPEC004 contra PostgreSQL real (adapter `controlled`):
 * contrato español, autorización/propiedad, doce consultas con diez pares, config completa y anonimato.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, countRows, ORIGIN, pairs, POLICY, post, queueAnswers, sessionToken, startUiApp } from "./app.js";

test("GET /chat/config: apertura, política, opciones y contactos completos; no-store y ≤2 s", async () => {
  const c = await startUiApp();
  try {
    const t0 = Date.now();
    const r = await fetch(`${c.base}/chat/config`, { headers: { origin: ORIGIN } });
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 2000);
    assert.match(r.headers.get("cache-control") ?? "", /no-store/);
    const cfg = await r.json();
    assert.deepEqual(Object.keys(cfg).sort(), ["apertura", "contactos", "opciones", "politica"]);
    assert.equal(cfg.politica.version, POLICY);
    assert.match(cfg.politica.url, /^https:\/\//);
    assert.deepEqual(cfg.opciones.map((o: { valor: string }) => o.valor), ["autorizo", "no_autorizo"]);
    assert.ok(cfg.apertura.length > 0);
    assert.ok(cfg.contactos.recepcion.pqrsd && cfg.contactos.recepcion.whatsapp && cfg.contactos.recepcion.email);
    assert.equal(cfg.contactos.inmediatos.length, 1);
    assert.equal(c.converse.calls.length, 0, "la configuración no invoca al proveedor");
  } finally { await c.close(); }
});

test("doce consultas autorizadas: la duodécima envía exactamente diez pares y cada respuesta lleva responseId", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 12);
    const tk = await sessionToken(c);
    const id = await authorize(c, tk);
    let history: Array<{ pregunta: string; respuesta: string }> = [];
    for (let i = 0; i < 12; i++) {
      const sent = history.slice(-10);
      const r = await post(c, "/chat", tk, { pregunta: `consulta ${i}`, conversationId: id, ...(sent.length ? { historial: sent } : {}) });
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.modo, "conversación");
      assert.match(b.responseId, /^[0-9a-f-]{36}$/);
      history = [...history, { pregunta: `consulta ${i}`, respuesta: b.respuesta }];
    }
    assert.equal(c.seen.historial[11], 10);
    assert.equal(c.seen.historial[0], 0, "la primera consulta no lleva historial");
    assert.equal(await countRows(c, "interaction"), 12);
  } finally { await c.close(); }
});

test("bypass sin consentimiento, UUID ajeno/inventado, mensaje incompleto y política inválida: 400 sin LLM ni filas", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 1);
    const tk = await sessionToken(c, "1.1.1.1");
    const otro = await sessionToken(c, "2.2.2.2");
    const id = await authorize(c, tk);
    const calls = c.converse.calls.length;
    const casos: Array<[string, unknown, string]> = [
      [tk, { pregunta: "x", historial: pairs(2) }, "historial"], // historial sin conversación autorizada
      [tk, { pregunta: "x", conversationId: "11111111-1111-4111-8111-111111111111" }, "conversationId"], // UUID inventado
      [otro, { pregunta: "x", conversationId: id }, "conversationId"], // UUID ajeno
      [tk, { conversationId: id }, "pregunta"], // mensaje incompleto
      [tk, { pregunta: "  ", conversationId: id }, "pregunta"],
    ];
    for (const [t, cuerpo, campo] of casos) {
      const r = await post(c, "/chat", t, cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
      assert.equal((await r.json()).error.campo, campo);
    }
    const rp = await post(c, "/conversations", tk, { autorizacion: true, policyVersion: "vieja" });
    assert.equal(rp.status, 400);
    assert.equal((await rp.json()).error.campo, "policyVersion");
    assert.equal(c.converse.calls.length, calls);
    assert.equal(await countRows(c, "interaction"), 0);
    assert.equal(await countRows(c, "conversation"), 1, "solo la conversación autorizada de este recorrido");
  } finally { await c.close(); }
});

test("fallo de registro: la respuesta sale completa pero sin responseId", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 1);
    const tk = await sessionToken(c);
    const id = await authorize(c, tk);
    c.failRecording.on = true;
    const r = await post(c, "/chat", tk, { pregunta: "¿Qué requisitos tiene el RUM?", conversationId: id });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.ok(b.respuesta);
    assert.equal(b.conversationId, id);
    assert.ok(!("responseId" in b));
  } finally { await c.close(); }
});

test("anonimato: sin conversationId, responseId ni filas de interacción; cabecera no-store", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 3);
    const tk = await sessionToken(c);
    for (let i = 0; i < 3; i++) {
      const r = await post(c, "/chat", tk, { pregunta: `anónima ${i}` });
      assert.equal(r.status, 200);
      assert.match(r.headers.get("cache-control") ?? "", /no-store/);
      const b = await r.json();
      assert.equal(b.modo, "anónima");
      assert.ok(!("conversationId" in b) && !("responseId" in b));
    }
    assert.equal(await countRows(c, "interaction"), 0);
    assert.equal(await countRows(c, "conversation"), 0);
    assert.deepEqual(c.seen.historial, [0, 0, 0]);
  } finally { await c.close(); }
});
