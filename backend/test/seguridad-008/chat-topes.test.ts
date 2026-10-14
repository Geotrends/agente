/**
 * SPEC008 US1 (NV-01): los topes diarios y el bloqueo por mensajes extensos se aplican de verdad en
 * POST /api/chat, antes de la cola y del LLM, y sin registrar la interacción.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatAdminDb, type ChatAdminDb } from "../di-integracion/chatAdminDb.js";
import { FakeConverse } from "../di-integracion/harness.js";
import { setChatPoolForTests } from "../../src/chat/db.js";
import { setCanalesProvider } from "../../src/chat/errors.js";
import { chatWindow } from "../../src/chat/perimeter.js";
import { loadConversation, saveClarification } from "../../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../../src/chat/records.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import { resetAuthSecret } from "../../src/services/auth.js";
import { ChatTrafficController } from "../../src/services/chatTraffic.js";
import authRouter from "../../src/routes/auth.js";
import conversationsRouter from "../../src/routes/conversations.js";
import chatRouter, { setChatDepsForTests, setChatTrafficForTests } from "../../src/routes/chat.js";
import { ModelError } from "../../src/bedrock/askBedrock.js";
import { hit } from "../di-support.js";

const ORIGIN = "https://geobot.ejemplo.gov.co";
const M20 = "openai.gpt-oss-20b-1:0";
Object.assign(process.env, {
  AUTH_JWT_SECRET: "x".repeat(40), CHAT_ALLOWED_ORIGINS: ORIGIN, CONSENT_POLICY_VERSION: "2026-10",
  CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica", CHAT_RATE_LIMIT_PER_MINUTE: "1000",
});

type Ctx = { db: ChatAdminDb; base: string; llamadasLlm: () => number; dir: string; close: () => Promise<void> };

async function start(env: Record<string, string>): Promise<Ctx> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-topes-"));
  Object.assign(process.env, {
    CHAT_LIMIT_STATE_FILE: path.join(dir, "traffic.json"),
    CHAT_DAILY_PER_IP_LIMIT: "300", CHAT_DAILY_GLOBAL_LIMIT: "1000",
    CHAT_LONG_MESSAGE_CHARS: "1500", CHAT_LONG_MESSAGE_HOURLY_LIMIT: "10", CHAT_LONG_MESSAGE_BLOCK_HOURS: "24",
    ...env,
  });
  resetAuthSecret();
  const db = await createChatAdminDb();
  setChatPoolForTests(db.chat);
  setCanalesProvider(async () => []);
  chatWindow.reset();
  await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://pqrsd.prueba.gov.co', '+57 300 000 1111', 'pqrsd@prueba.gov.co')`);
  await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '(604) 000 2222', 'info@prueba.gov.co', 'https://prueba.gov.co/contacto')`);
  await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('Emergencias','24 h','teléfono','123',1)`);
  await db.admin.query(`INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url) VALUES ($1,'us-east-1','USD',0.07,0.3,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`, [M20]);
  const converse = new FakeConverse();
  let llamadas = 0;
  for (let i = 0; i < 50; i++) converse.on(M20, { kind: "ok", text: "Respuesta documental [D1].\n<!--FUENTES: D1-->", inputTokens: 100, outputTokens: 20 });
  setChatDepsForTests({
    contacts: () => readContactSnapshot(db.chat),
    retrieve: async () => ({ hits: [hit(1)] }),
    adapter: {
      call: async (modelId, req) => {
        llamadas++;
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
  setChatTrafficForTests(new ChatTrafficController());
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api", authRouter, conversationsRouter, chatRouter);
  const server = app.listen(0);
  return {
    db, dir, llamadasLlm: () => llamadas, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    close: async () => {
      setChatTrafficForTests(undefined); setChatDepsForTests(undefined); setChatPoolForTests(undefined);
      server.close(); await db.close(); await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

async function token(c: Ctx, ip: string): Promise<string> {
  const r = await fetch(`${c.base}/session`, { method: "POST", headers: { "x-forwarded-for": ip } });
  return (await r.json()).token;
}
const chat = (c: Ctx, tk: string, pregunta: string, ip: string) =>
  fetch(`${c.base}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tk}`, origin: ORIGIN, "x-forwarded-for": ip },
    body: JSON.stringify({ pregunta }),
  });

test("NV-01: la consulta N+1 de una IP se rechaza con 429 sin invocar al LLM ni registrar", async () => {
  const c = await start({ CHAT_DAILY_PER_IP_LIMIT: "2" });
  try {
    const tk = await token(c, "9.9.9.9");
    assert.equal((await chat(c, tk, "¿Qué requisitos tiene el trámite?", "9.9.9.9")).status, 200);
    assert.equal((await chat(c, tk, "¿Y el plazo del trámite?", "9.9.9.9")).status, 200);
    const antes = c.llamadasLlm();
    const registros = (await c.db.migrator.query("SELECT count(*)::int n FROM chat.anonymous_usage")).rows[0].n as number;
    const r = await chat(c, tk, "¿Una tercera consulta?", "9.9.9.9");
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) >= 1, "Retry-After hasta el día siguiente");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(c.llamadasLlm(), antes, "el LLM no se invoca");
    assert.equal((await c.db.migrator.query("SELECT count(*)::int n FROM chat.anonymous_usage")).rows[0].n, registros, "no se registra");
    const cuerpo = JSON.stringify(await r.json());
    assert.doesNotMatch(cuerpo, /bedrock|gpt-oss|anthropic|stack|\/Users\//i, "error genérico (FR-022)");
    // Otra IP sigue atendiéndose.
    const otro = await token(c, "8.8.8.8");
    assert.equal((await chat(c, otro, "¿Requisitos?", "8.8.8.8")).status, 200);
  } finally { await c.close(); }
});

test("NV-01: el tope global agota el servicio para todas las IP", async () => {
  const c = await start({ CHAT_DAILY_GLOBAL_LIMIT: "2" });
  try {
    for (const ip of ["1.1.1.1", "2.2.2.2"]) {
      assert.equal((await chat(c, await token(c, ip), "¿Requisitos del trámite?", ip)).status, 200);
    }
    const r = await chat(c, await token(c, "3.3.3.3"), "¿Requisitos del trámite?", "3.3.3.3");
    assert.equal(r.status, 429);
  } finally { await c.close(); }
});

test("NV-01: mensajes extensos repetidos bloquean la IP", async () => {
  const c = await start({ CHAT_LONG_MESSAGE_CHARS: "50", CHAT_LONG_MESSAGE_HOURLY_LIMIT: "1" });
  try {
    const ip = "4.4.4.4";
    const tk = await token(c, ip);
    const largo = "x".repeat(60);
    assert.equal((await chat(c, tk, largo, ip)).status, 200, "dentro del umbral de la hora");
    const bloqueada = await chat(c, tk, largo, ip);
    assert.equal(bloqueada.status, 429, "al superar el umbral la IP queda bloqueada");
    // Una vez bloqueada, incluso una pregunta corta se rechaza.
    assert.equal((await chat(c, tk, "corta", ip)).status, 429);
  } finally { await c.close(); }
});
