/**
 * T042 — Plazo integral y errores (RF-C3-IN-04, RF-C3-IN-08).
 *
 * Nueve casos de error: 3 VALIDACION, 3 SERVICIO_NO_DISPONIBLE (con evento técnico y aviso), 2 de
 * tiempo y 1 ERROR_INTERNO; terminal único ≤ plazo, sin texto técnico, con la cola, el pool y las
 * conexiones liberados. Además: cuerpo, pool, conversación, error y contactos lentos desde la
 * recepción. Plazo de 5 s en las pruebas rápidas; un caso de tiempo corre con los 40 s reales.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chatAdmissionQueue } from "../../src/services/chatTraffic.js";
import { operations } from "../../src/admin/operations.js";
import { authorize, countRows, M20, post, queueAnswers, rawRequest, sessionToken, startInApp, type InApp } from "./harness.js";

const FUGAS = /postgres|select |insert |gpt-oss|bedrock|anthropic|openai|stack|at \w+\.|node_modules|econnrefused|etimedout|deadline_exceeded|qdrant|pg_|lock|statement/i;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withApp(deadlineMs: number | undefined, fn: (c: InApp) => Promise<void>): Promise<void> {
  const previo = process.env.CHAT_DEADLINE_MS;
  if (deadlineMs) process.env.CHAT_DEADLINE_MS = String(deadlineMs); else delete process.env.CHAT_DEADLINE_MS;
  const c = await startInApp();
  try { await fn(c); } finally {
    await c.close();
    if (previo === undefined) delete process.env.CHAT_DEADLINE_MS; else process.env.CHAT_DEADLINE_MS = previo;
  }
}

const eventos = async (c: InApp) => (await c.db.migrator.query("SELECT code, component, mode FROM admin.service_event ORDER BY event_id")).rows;
async function assertCatalogo(r: Response, codigo: string, status: number): Promise<{ error: { codigo: string; campo?: string } }> {
  assert.equal(r.status, status);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const texto = await r.text();
  assert.ok(!FUGAS.test(texto), `fuga técnica en ${texto}`);
  const b = JSON.parse(texto);
  assert.equal(b.error.codigo, codigo);
  assert.ok(Array.isArray(b.canales));
  return b;
}
const limpio = (c: InApp) => {
  assert.equal(chatAdmissionQueue.status().active, 0, "la plaza de la cola se liberó");
  assert.equal(chatAdmissionQueue.status().queued, 0);
  assert.equal(c.db.chat.waitingCount, 0, "nadie espera en el pool");
};

test("9 casos de error: 3 validación, 3 indisponibilidad con evento y aviso, 2 de tiempo y 1 interno", async () => {
  await withApp(5_000, async c => {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    const hdr = { authorization: `Bearer ${tk}` };

    // 3 VALIDACION (inmediatas, con el campo infractor).
    const v1 = await post(c, "/chat", tk, "{no es json");
    assert.equal((await assertCatalogo(v1, "VALIDACION", 400)).error.codigo, "VALIDACION");
    const v2 = await assertCatalogo(await post(c, "/chat", tk, {}), "VALIDACION", 400);
    assert.equal(v2.error.campo, "pregunta");
    const v3 = await assertCatalogo(await post(c, "/chat", tk, { pregunta: "x", conversationId: "no-uuid" }), "VALIDACION", 400);
    assert.equal(v3.error.campo, "conversationId");

    // 3 SERVICIO_NO_DISPONIBLE: búsqueda caída, ambos modelos caídos y respuesta sin fuente verificable.
    c.failSearch.on = true;
    await assertCatalogo(await post(c, "/chat", tk, { pregunta: "¿Qué requisitos tiene?", conversationId: conv }), "SERVICIO_NO_DISPONIBLE", 503);
    c.failSearch.on = false;
    await assertCatalogo(await post(c, "/chat", tk, { pregunta: "¿Qué requisitos tiene el RUM?" }), "SERVICIO_NO_DISPONIBLE", 503); // sin guion: doble fallo
    c.converse.on(M20, { kind: "ok", text: "Dato sin cita.\n<!--FUENTES: /ruta/interna.pdf-->", inputTokens: 5, outputTokens: 5 });
    await assertCatalogo(await post(c, "/chat", tk, { pregunta: "¿Cuánto tarda?" }), "SERVICIO_NO_DISPONIBLE", 503);

    // 2 de tiempo ≤ plazo: modelo lento y cuerpo lento.
    c.delays.model = 20_000;
    queueAnswers(c, 1, M20);
    const t0 = Date.now();
    await assertCatalogo(await post(c, "/chat", tk, { pregunta: "lenta por el modelo" }), "SERVICIO_NO_DISPONIBLE", 503);
    const modelo = Date.now() - t0;
    assert.ok(modelo <= 5_600, `modelo lento: error en ${modelo} ms (plazo 5 s)`);
    assert.ok(modelo >= 1_500, `los dos intentos usaron su presupuesto (${modelo} ms)`);
    c.delays.model = 0;
    const t1 = Date.now();
    const body = JSON.stringify({ pregunta: "cuerpo lento", conversationId: conv });
    const lento = await rawRequest(c, { path: "/chat", headers: hdr, chunks: [body.slice(0, 10), body.slice(10, 20), body.slice(20)], gapMs: 3_000 });
    const cuerpo = Date.now() - t1;
    assert.equal(lento.status, 503);
    assert.equal(lento.headers["cache-control"], "no-store");
    assert.ok(cuerpo <= 5_600, `cuerpo lento: error en ${cuerpo} ms (plazo 5 s desde la recepción)`);
    assert.ok(!FUGAS.test(lento.body));

    // Control: una conversación inexistente es validación, no cae a ERROR_INTERNO.
    const inexistente = await post(c, "/chat", tk, { pregunta: "interno", conversationId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(inexistente.status, 400);
    await inexistente.text();

    await sleep(300);
    limpio(c);
    // Eventos técnicos mínimos, sin texto: búsqueda (1); modelos (3: doble fallo, respuesta sin fuente y
    // modelo lento cuyos dos intentos agotan su presupuesto); plazo (1: cuerpo lento).
    const ev = await eventos(c);
    const porComponente = (x: string) => ev.filter(e => e.component === x).length;
    assert.equal(porComponente("busqueda"), 1);
    assert.equal(porComponente("modelos"), 3);
    assert.equal(porComponente("plazo"), 1);
    assert.ok(ev.every(e => e.code === "SERVICIO_NO_DISPONIBLE"));
    assert.ok(ev.some(e => e.component === "busqueda" && e.mode === "conversación"));
    const columnas = (await c.db.migrator.query("SELECT column_name FROM information_schema.columns WHERE table_schema='admin' AND table_name='service_event' ORDER BY ordinal_position")).rows.map(r => r.column_name);
    assert.deepEqual(columnas, ["event_id", "occurred_at", "code", "component", "mode"]);
    // Y un aviso en el panel por componente.
    const avisos = (await operations.list("no_revisada")).avisos.map(a => a.description).join("|");
    assert.match(avisos, /búsqueda documental/);
    assert.match(avisos, /plazo de 40 segundos/);
    // Ningún error dejó registro de consulta.
    assert.equal(await countRows(c, "interaction"), 0);
    assert.equal(await countRows(c, "anonymous_usage"), 0);

    // 1 ERROR_INTERNO: una excepción no prevista dentro del caso de uso (no es de disponibilidad).
    const { setChatDepsForTests } = await import("../../src/routes/chat.js");
    setChatDepsForTests({
      contacts: async () => { throw new TypeError("select * from secretos falló en node_modules/pg"); },
      retrieve: async () => ({ hits: [] }), adapter: { call: async () => { throw new Error("no se invoca"); } },
      loadConversation: async () => null, saveClarification: async () => {},
      saveInteraction: async () => null, saveAnonymousUsage: async () => false,
    });
    const interno = await assertCatalogo(await post(c, "/chat", tk, { pregunta: "inesperado" }), "ERROR_INTERNO", 500);
    assert.equal(interno.error.codigo, "ERROR_INTERNO");
    assert.equal((await eventos(c)).length, ev.length, "un error interno no es un evento de indisponibilidad");
  });
});

test("ERROR_INTERNO: un fallo inesperado se informa genérico, sin detalles ni evento de disponibilidad", async () => {
  await withApp(5_000, async c => {
    const tk = await sessionToken(c);
    // Contactos oficiales ausentes en la tabla: no es el caso; forzamos un TypeError en la búsqueda no es «indisponibilidad».
    c.retrieval.hits = [{ path: "x", snippet: "s" } as never]; // fragmento sin URL/fecha: datos de fuente inválidos → 503 (no interno)
    const datos = await post(c, "/chat", tk, { pregunta: "¿Qué requisitos tiene?" });
    assert.equal(datos.status, 503);
    // El caso interno real: una excepción no prevista dentro del caso de uso.
    const { setChatDepsForTests } = await import("../../src/routes/chat.js");
    setChatDepsForTests({
      contacts: async () => { throw new TypeError("select * from secretos falló en node_modules/pg"); },
      retrieve: async () => ({ hits: [] }), adapter: { call: async () => { throw new Error("no se invoca"); } },
      loadConversation: async () => null, saveClarification: async () => {},
      saveInteraction: async () => null, saveAnonymousUsage: async () => false,
    });
    const r = await post(c, "/chat", tk, { pregunta: "x" });
    const b = await assertCatalogo(r, "ERROR_INTERNO", 500);
    assert.equal(b.error.codigo, "ERROR_INTERNO");
  });
});

test("tiempo con el plazo real de 40 s: modelo que nunca responde → error ≤ 40 s con cola y conexiones liberadas", async () => {
  await withApp(undefined, async c => {
    const tk = await sessionToken(c);
    c.delays.model = 120_000;
    queueAnswers(c, 1, M20);
    const t0 = Date.now();
    const r = await post(c, "/chat", tk, { pregunta: "¿Qué requisitos tiene el trámite?" });
    const ms = Date.now() - t0;
    await assertCatalogo(r, "SERVICIO_NO_DISPONIBLE", 503);
    assert.ok(ms <= 40_000, `error en ${ms} ms`);
    assert.ok(ms >= 30_000, `el plazo no se corta antes de tiempo (${ms} ms)`);
    await sleep(200);
    limpio(c);
  });
});

test("pool agotado y lectura de conversación lenta: error a tiempo, sin modo anónimo silencioso ni conexiones colgadas", async () => {
  await withApp(5_000, async c => {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    queueAnswers(c, 2, M20);
    // La base de propiedad no responde (lock exclusivo): NO se degrada a anónimo.
    const holder = await c.db.migrator.connect();
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE chat.conversation IN ACCESS EXCLUSIVE MODE");
    const t0 = Date.now();
    const r = await post(c, "/chat", tk, { pregunta: "¿Qué requisitos tiene?", conversationId: conv });
    const ms = Date.now() - t0;
    await assertCatalogo(r, "SERVICIO_NO_DISPONIBLE", 503);
    assert.ok(ms <= 5_600, `error en ${ms} ms`);
    await holder.query("ROLLBACK");
    holder.release();
    assert.equal(c.counters.modelCalls, 0, "no llegó al modelo ni se trató como anónima");
    assert.equal(await countRows(c, "anonymous_usage"), 0);

    // Pool ocupado por completo: la lectura de conversación no consigue conexión y termina a tiempo.
    const retenidas = await Promise.all(Array.from({ length: 4 }, () => c.db.chat.connect()));
    const t1 = Date.now();
    const r2 = await post(c, "/chat", tk, { pregunta: "¿Y el costo?", conversationId: conv });
    const ms2 = Date.now() - t1;
    await assertCatalogo(r2, "SERVICIO_NO_DISPONIBLE", 503);
    assert.ok(ms2 <= 5_600, `con el pool lleno: error en ${ms2} ms`);
    retenidas.forEach(x => x.release());
    await sleep(200);
    limpio(c);
    assert.equal(c.db.chat.idleCount, c.db.chat.totalCount, "sin conexiones colgadas");
  });
});

test("el error no espera contactos lentos: contactos bloqueados no retrasan una validación ni un fallo", async () => {
  await withApp(5_000, async c => {
    const tk = await sessionToken(c);
    const holder = await c.db.migrator.connect();
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE admin.contact_immediate IN ACCESS EXCLUSIVE MODE");
    try {
      const t0 = Date.now();
      const r = await post(c, "/chat", tk, {});
      const ms = Date.now() - t0;
      assert.equal(r.status, 400);
      const b = await r.json();
      assert.deepEqual(b.canales, [], "sin canales antes que retrasar el error");
      assert.ok(ms <= 2_500, `la validación respondió en ${ms} ms con contactos bloqueados`);
      assert.equal(r.headers.get("cache-control"), "no-store");
    } finally { await holder.query("ROLLBACK"); holder.release(); }
  });
});
