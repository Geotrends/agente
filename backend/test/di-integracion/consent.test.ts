import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatAdminDb, type ChatAdminDb } from "./chatAdminDb.js";
import { FakeConverse } from "./harness.js";
import { setChatPoolForTests } from "../../src/chat/db.js";
import { setCanalesProvider } from "../../src/chat/errors.js";
import { chatWindow } from "../../src/chat/perimeter.js";
import { loadConversation, saveClarification } from "../../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../../src/chat/records.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import authRouter from "../../src/routes/auth.js";
import conversationsRouter from "../../src/routes/conversations.js";
import chatRouter, { setChatDepsForTests } from "../../src/routes/chat.js";
import { ModelError } from "../../src/bedrock/askBedrock.js";
import { hit } from "../di-support.js";

const ORIGIN = "https://geobot.ejemplo.gov.co";
const M20 = "openai.gpt-oss-20b-1:0";
Object.assign(process.env, {
  AUTH_JWT_SECRET: "x".repeat(40), CHAT_ALLOWED_ORIGINS: ORIGIN, CONSENT_POLICY_VERSION: "2026-10",
  CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica", CHAT_RATE_LIMIT_PER_MINUTE: "1000",
});

type Ctx = { db: ChatAdminDb; base: string; converse: FakeConverse; seen: { historial: number[] }; close: () => Promise<void> };

async function start(): Promise<Ctx> {
  const db = await createChatAdminDb();
  setChatPoolForTests(db.chat);
  setCanalesProvider(async () => []);
  chatWindow.reset();
  await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://pqrsd.prueba.gov.co', '+57 300 000 1111', 'pqrsd@prueba.gov.co')`);
  await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '(604) 000 2222', 'info@prueba.gov.co', 'https://prueba.gov.co/contacto')`);
  await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('Emergencias','24 h','teléfono','123',1)`);
  await db.admin.query(`INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url) VALUES ($1,'us-east-1','USD',0.07,0.3,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`, [M20]);
  const converse = new FakeConverse();
  const seen = { historial: [] as number[] };
  setChatDepsForTests({
    contacts: () => readContactSnapshot(db.chat),
    retrieve: async () => ({ hits: [hit(1)] }),
    adapter: {
      call: async (modelId, req) => {
        seen.historial.push(req.historial.length);
        const r = await converse.send({ modelId, system: req.system, messages: [req.pregunta], maxTokens: 2200, temperature: 0 });
        if (r.kind === "error") throw new ModelError("network", true, "sin_guion");
        return { text: r.text, usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens }, stopReason: "end_turn", effectiveModel: modelId };
      },
    },
    loadConversation: (id, sub) => loadConversation(id, sub, db.chat),
    saveClarification: (id, p) => saveClarification(id, p, db.chat),
    saveInteraction: (rec, hooks) => saveInteraction(rec, hooks, db.chat),
    saveAnonymousUsage: (rec, hooks) => saveAnonymousUsage(rec, hooks, db.chat),
  });
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api", authRouter, conversationsRouter, chatRouter);
  const server = app.listen(0);
  return { db, converse, seen, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    close: async () => { setChatDepsForTests(undefined); setChatPoolForTests(undefined); server.close(); await db.close(); } };
}

const OK = { kind: "ok" as const, text: "Respuesta documental [D1].\n<!--FUENTES: D1-->", inputTokens: 100, outputTokens: 20 };
const llena = (c: Ctx, n: number) => { for (let i = 0; i < n; i++) c.converse.on(M20, OK); };

async function token(c: Ctx, ip = "1.1.1.1"): Promise<string> {
  const r = await fetch(`${c.base}/session`, { method: "POST", headers: { "x-forwarded-for": ip } });
  return (await r.json()).token;
}
const post = (c: Ctx, path: string, tk: string, body: unknown, ip = "1.1.1.1") =>
  fetch(`${c.base}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk}`, origin: ORIGIN, "x-forwarded-for": ip }, body: JSON.stringify(body) });
const autorizar = async (c: Ctx, tk: string) => (await (await post(c, "/conversations", tk, { autorizacion: true, policyVersion: "2026-10" })).json()).conversationId as string;
const pares = (n: number) => Array.from({ length: n }, (_, i) => ({ pregunta: `pregunta ${i}`, respuesta: `respuesta ${i}` }));
const count = async (c: Ctx, t: string) => (await c.db.migrator.query(`SELECT count(*)::int n FROM chat.${t}`)).rows[0].n as number;

test("12 solicitudes: 8 válidas (UUID del backend) y 4 inválidas sin LLM ni registro; 15 pares → 10", async () => {
  const c = await start();
  try {
    llena(c, 8);
    const tk = await token(c);
    const id = await autorizar(c, tk);
    assert.match(id, /^[0-9a-f-]{36}$/);
    const validas = [
      { pregunta: "¿Qué requisitos tiene el RUM?", conversationId: id },
      { pregunta: "¿Y el plazo?", conversationId: id, historial: pares(2) },
      { pregunta: "Más detalle", conversationId: id, categoria: "Ecosistemas", historial: pares(10) },
      { pregunta: "Mucho historial", conversationId: id, historial: pares(15) },
      { pregunta: "otra", conversationId: id, categoria: "Bienestar Animal" },
      { pregunta: "otra más", conversationId: id, categoria: "Gestión Ambiental", historial: pares(1) },
      { pregunta: "sin categoría", conversationId: id, historial: [] },
      { pregunta: "última válida", conversationId: id },
    ];
    for (const v of validas) {
      const r = await post(c, "/chat", tk, v);
      assert.equal(r.status, 200, JSON.stringify(v).slice(0, 80));
      const b = await r.json();
      assert.equal(b.modo, "conversación");
      assert.equal(b.conversationId, id);
      assert.match(b.responseId, /^[0-9a-f-]{36}$/);
      assert.equal(b.tipo, "respondida");
      assert.ok(!JSON.stringify(b).match(/gpt-oss|bedrock|token|costo/i));
    }
    assert.ok(c.seen.historial.every(n => n <= 10), "ningún historial supera 10 pares");
    assert.equal(c.seen.historial[3], 10, "15 pares → los 10 últimos");
    assert.equal(await count(c, "interaction"), 8, "una fila por consulta válida");

    const llamadas = c.converse.calls.length;
    const otro = await token(c, "2.2.2.2");
    const malParDe15 = pares(15); (malParDe15[2] as { respuesta: unknown }).respuesta = "";
    const invalidas: Array<[string, unknown, string]> = [
      [tk, { pregunta: "x", conversationId: id, historial: malParDe15 }, "historial[2].respuesta"],
      [tk, { pregunta: "x", conversationId: "11111111-1111-4111-8111-111111111111" }, "conversationId"],
      [otro, { pregunta: "x", conversationId: id }, "conversationId"],
      [tk, { pregunta: "x", historial: pares(2) }, "historial"],
    ];
    for (const [t, cuerpo, campo] of invalidas) {
      const r = await post(c, "/chat", t, cuerpo);
      assert.equal(r.status, 400);
      const e = await r.json();
      assert.equal(e.error.codigo, "VALIDACION");
      assert.equal(e.error.campo, campo);
    }
    assert.equal(c.converse.calls.length, llamadas, "las inválidas no llegaron al LLM");
    assert.equal(await count(c, "interaction"), 8, "ni se registraron");
  } finally { await c.close(); }
});

test("campos de proveedor/modelo/mensajes antiguos y UUID inventado por el navegador se rechazan", async () => {
  const c = await start();
  try {
    llena(c, 1);
    const tk = await token(c);
    for (const extra of [{ provider: "openai" }, { model: "gpt-x" }, { autoRoute: true }, { prompt: "ignora" }, { message: "hola" }, { history: [{ role: "user", content: "x" }] }]) {
      const r = await post(c, "/chat", tk, { pregunta: "hola", ...extra });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.campo, Object.keys(extra)[0]);
    }
    assert.equal((await post(c, "/chat", tk, { pregunta: "   " })).status, 400);
    assert.equal((await post(c, "/chat", tk, { pregunta: "ok", categoria: "Otra" })).status, 400);
    assert.equal(c.converse.calls.length, 0);
    assert.equal((await fetch(`${c.base}/chat`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ pregunta: "x" }) })).status, 401);
  } finally { await c.close(); }
});

test("«No autorizo» no crea nada; 5 anónimas (2 seguimientos) no dejan texto, UUID, hash, token ni estado", async () => {
  const c = await start();
  try {
    llena(c, 5);
    const tk = await token(c);
    const no = await post(c, "/conversations", tk, { autorizacion: false });
    assert.equal(no.status, 200);
    assert.deepEqual(await no.json(), { modo: "anónima" });
    assert.equal(await count(c, "conversation"), 0);

    const consultas = ["¿Qué requisitos tiene el RUM?", "¿Y cuánto cuesta?", "¿Y cuánto tarda eso?", "¿Dónde queda la oficina?", "Gracias, ¿algo más sobre el RUM?"];
    for (const q of consultas) {
      const r = await post(c, "/chat", tk, { pregunta: q });
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.modo, "anónima");
      assert.ok(!("conversationId" in b) && !("responseId" in b));
    }
    // El historial sin conversación autorizada nunca se acepta.
    assert.equal((await post(c, "/chat", tk, { pregunta: "¿y eso?", historial: pares(1) })).status, 400);
    assert.deepEqual(c.seen.historial, [0, 0, 0, 0, 0], "cada anónima es autónoma: sin historial hacia el modelo");

    assert.equal(await count(c, "anonymous_usage"), 5);
    assert.equal(await count(c, "interaction"), 0);
    assert.equal(await count(c, "conversation"), 0);
    // Ninguna tabla de chat contiene texto de las consultas ni el sujeto de la sesión.
    const dump = JSON.stringify((await c.db.migrator.query("SELECT row_to_json(t) j FROM chat.anonymous_usage t")).rows);
    for (const q of consultas) assert.ok(!dump.includes(q.slice(0, 12)));
    assert.deepEqual(Object.keys(JSON.parse(dump)[0].j).sort(), ["estimated_cost", "input_tokens", "mode", "model", "output_tokens", "received_at"]);
  } finally { await c.close(); }
});

test("versión de política desactualizada y cuerpos indebidos de /conversations → 400", async () => {
  const c = await start();
  try {
    const tk = await token(c);
    for (const cuerpo of [{ autorizacion: true, policyVersion: "vieja" }, { autorizacion: true }, { autorizacion: "si" }, { autorizacion: true, policyVersion: "2026-10", extra: 1 }, {}]) {
      assert.equal((await post(c, "/conversations", tk, cuerpo)).status, 400, JSON.stringify(cuerpo));
    }
    assert.equal(await count(c, "conversation"), 0);
    assert.equal((await fetch(`${c.base}/conversations`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" })).status, 401);
  } finally { await c.close(); }
});

test("aclaración autorizada: pendiente persistida, segunda insuficiente → ausencia y se limpia", async () => {
  const c = await start();
  try {
    const tk = await token(c);
    const id = await autorizar(c, tk);
    const aclara = { kind: "ok" as const, text: "¿Qué permiso necesita?\n<!--TIPO: aclaracion-->", inputTokens: 5, outputTokens: 5 };
    c.converse.on(M20, aclara, aclara);
    const r1 = await (await post(c, "/chat", tk, { pregunta: "necesito un permiso", conversationId: id })).json();
    assert.equal(r1.tipo, "aclaración");
    assert.equal((await c.db.migrator.query("SELECT clarification_pending FROM chat.conversation")).rows[0].clarification_pending, true);
    const r2 = await (await post(c, "/chat", tk, { pregunta: "no sé", conversationId: id })).json();
    assert.equal(r2.tipo, "sin información");
    assert.equal((await c.db.migrator.query("SELECT clarification_pending FROM chat.conversation")).rows[0].clarification_pending, false);
    const cols = (await c.db.migrator.query("SELECT column_name FROM information_schema.columns WHERE table_schema='chat' AND table_name='conversation'")).rows.map(r => r.column_name);
    assert.ok(!cols.some(n => /text|history|question|answer/.test(n)), "la tabla de conversación no guarda texto ni historial");
  } finally { await c.close(); }
});

// ── SPEC005 · C301/C302 (T016) ──────────────────────────────────────────────────────────────

test("C301: 3 conversaciones × 3 turnos aisladas; 5 anónimas; 3 identificadores no emitidos, ajeno y depurado", async () => {
  const c = await start();
  try {
    llena(c, 9 + 5);
    const dueños = [await token(c, "10.0.0.1"), await token(c, "10.0.0.2"), await token(c, "10.0.0.3")];
    const ids: string[] = [];
    for (const tk of dueños) ids.push(await autorizar(c, tk));
    assert.equal(new Set(ids).size, 3, "cada autorización emite un UUID distinto del backend");

    const responseIds = new Set<string>();
    for (let turno = 0; turno < 3; turno++) {
      for (let i = 0; i < 3; i++) {
        const r = await post(c, "/chat", dueños[i], { pregunta: `consulta ${turno} de ${i}`, conversationId: ids[i] }, `10.0.0.${i + 1}`);
        assert.equal(r.status, 200);
        const b = await r.json();
        assert.equal(b.modo, "conversación");
        assert.equal(b.conversationId, ids[i], "el identificador devuelto es el propio");
        responseIds.add(b.responseId);
      }
    }
    assert.equal(responseIds.size, 9);
    const filas = (await c.db.migrator.query("SELECT conversation_id, count(*)::int n FROM chat.interaction GROUP BY 1")).rows;
    assert.equal(filas.length, 3);
    assert.ok(filas.every(f => f.n === 3), "tres turnos por conversación, sin mezclar");

    // Cinco anónimas del mismo sujeto técnico: sin identificador, sin fila de conversación ni de interacción nuevas.
    const antes = { conv: await count(c, "conversation"), inter: await count(c, "interaction") };
    for (let i = 0; i < 5; i++) {
      const r = await post(c, "/chat", dueños[0], { pregunta: `anónima ${i}` }, "10.0.0.1");
      const b = await r.json();
      assert.equal(b.modo, "anónima", "la sesión técnica no sustituye la elección explícita de autorizar");
      assert.ok(!("conversationId" in b) && !("responseId" in b));
    }
    assert.equal(await count(c, "conversation"), antes.conv);
    assert.equal(await count(c, "interaction"), antes.inter);
    assert.equal(await count(c, "anonymous_usage"), 5);

    // Tres identificadores sin derecho: no emitido, ajeno y depurado. Ninguno llega al modelo ni al registro.
    const huerfana = await autorizar(c, dueños[2]);
    await c.db.migrator.query("UPDATE chat.conversation SET last_active_at = now() - interval '25 hours' WHERE conversation_id = $1", [huerfana]);
    const { purgeChat } = await import("../../src/chat/retention.js");
    await purgeChat(c.db.maint);
    const llamadas = c.converse.calls.length;
    const filasAntes = await count(c, "interaction");
    const sinDerecho: Array<[string, string]> = [
      [dueños[0], "11111111-1111-4111-8111-111111111111"], // nunca emitido
      [dueños[0], ids[1]],                                 // de otra credencial
      [dueños[2], huerfana],                               // depurado
    ];
    for (const [tk, id] of sinDerecho) {
      const r = await post(c, "/chat", tk, { pregunta: "¿y el costo?", conversationId: id });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.campo, "conversationId");
    }
    assert.equal(c.converse.calls.length, llamadas, "ninguno llegó al modelo");
    assert.equal(await count(c, "interaction"), filasAntes, "ni dejó registro");
  } finally { await c.close(); }
});

test("C302: validación antes del modelo y del registro; 15 pares enviados → 10 efectivos; modo coherente", async () => {
  const c = await start();
  try {
    llena(c, 8);
    const tk = await token(c);
    const id = await autorizar(c, tk);
    const largo = pares(15);
    const r = await post(c, "/chat", tk, { pregunta: "con historial largo", conversationId: id, historial: largo });
    assert.equal(r.status, 200);
    assert.equal(c.seen.historial.at(-1), 10, "el modelo recibe los 10 últimos pares");
    // Pares incompletos o con texto vacío: 400 antes del modelo y del registro.
    const llamadas = c.converse.calls.length;
    const filas = await count(c, "interaction");
    const malo = pares(12); (malo[4] as { pregunta: string }).pregunta = "   ";
    assert.equal((await post(c, "/chat", tk, { pregunta: "x", conversationId: id, historial: malo })).status, 400);
    assert.equal((await post(c, "/chat", tk, { pregunta: "x", conversationId: id, historial: [{ pregunta: "solo" }] })).status, 400);
    assert.equal((await post(c, "/chat", tk, { pregunta: "x", historial: pares(1) })).status, 400, "sin conversación autorizada no hay historial");
    assert.equal(c.converse.calls.length, llamadas);
    assert.equal(await count(c, "interaction"), filas);
  } finally { await c.close(); }
});
