/**
 * RF-C3-IN-04: 9 casos del contrato de errores (validación, disponibilidad, tiempo, interno).
 * Formato `{error:{codigo,mensaje,campo?},canales:[…]}`; ni SQL, ni modelo, ni proveedor, ni trazas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatAdminDb } from "./chatAdminDb.js";
import { setChatPoolForTests } from "../../src/chat/db.js";
import { setCanalesProvider } from "../../src/chat/errors.js";
import { chatWindow } from "../../src/chat/perimeter.js";
import { loadConversation, saveClarification } from "../../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../../src/chat/records.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import { ModelError } from "../../src/bedrock/askBedrock.js";
import authRouter from "../../src/routes/auth.js";
import chatRouter, { setChatDepsForTests } from "../../src/routes/chat.js";
import type { ChatDeps } from "../../src/chat/handleChat.js";
import { resetCircuits } from "../../src/services/circuitBreaker.js";
import { hit } from "../di-support.js";

const ORIGIN = "https://geobot.ejemplo.gov.co";
Object.assign(process.env, { AUTH_JWT_SECRET: "x".repeat(40), CHAT_ALLOWED_ORIGINS: ORIGIN, CONSENT_POLICY_VERSION: "2026-10", CONSENT_RATE: "1", CHAT_RATE_LIMIT_PER_MINUTE: "6000" });

const FUGAS = /postgres|select |insert |gpt-oss|bedrock|anthropic|openai|stack|at \w+\.|node_modules|econnrefused|ETIMEDOUT/i;

test("9 casos de error: código de catálogo, canales vigentes y ninguna fuga interna", async () => {
  const db = await createChatAdminDb();
  setChatPoolForTests(db.chat);
  chatWindow.reset(); resetCircuits();
  await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://p.gov.co', '300 111 2233', 'a@b.co')`);
  await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '604 555 0100', 'i@b.co', 'https://p.gov.co/c')`);
  await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('Emergencias','24 h','teléfono','123',1)`);
  setCanalesProvider(async () => (await readContactSnapshot(db.chat))?.inmediatos ?? []);

  const ok = (text = "Respuesta [D1].\n<!--FUENTES: D1-->") => ({ text, usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" as const, effectiveModel: "openai.gpt-oss-20b-1:0" });
  const base = (): ChatDeps => ({
    contacts: () => readContactSnapshot(db.chat), retrieve: async () => ({ hits: [hit(1)] }), adapter: { call: async () => ok() },
    loadConversation: (id, sub) => loadConversation(id, sub, db.chat), saveClarification: (id, p) => saveClarification(id, p, db.chat),
    saveInteraction: (r, h) => saveInteraction(r, h, db.chat), saveAnonymousUsage: (r, h) => saveAnonymousUsage(r, h, db.chat),
  });
  const app = express(); app.set("trust proxy", 1);
  app.use("/api", authRouter, chatRouter);
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = (await (await fetch(`${url}/session`, { method: "POST" })).json()).token as string;
  const post = (body: unknown) => fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: ORIGIN }, body: typeof body === "string" ? body : JSON.stringify(body) });

  type Caso = { nombre: string; deps?: Partial<ChatDeps>; body: unknown; status: number; codigo: string; campo?: string; env?: Record<string, string> };
  const sinSuerte = { call: async () => { throw new ModelError("network", true, "503"); } };
  const casos: Caso[] = [
    { nombre: "1 cuerpo no JSON", body: "{no es json", status: 400, codigo: "VALIDACION" },
    { nombre: "2 pregunta ausente", body: {}, status: 400, codigo: "VALIDACION", campo: "pregunta" },
    { nombre: "3 conversationId inválido", body: { pregunta: "x", conversationId: "no-es-uuid" }, status: 400, codigo: "VALIDACION", campo: "conversationId" },
    { nombre: "4 doble fallo de modelos", deps: { adapter: sinSuerte }, body: { pregunta: "¿Qué requisitos tiene el RUM?" }, status: 503, codigo: "SERVICIO_NO_DISPONIBLE" },
    { nombre: "5 falla la búsqueda (no es «sin información»)", deps: { retrieve: async () => { throw new Error("qdrant ECONNREFUSED 10.0.0.5:6333"); } }, body: { pregunta: "¿Qué requisitos tiene el RUM?" }, status: 503, codigo: "SERVICIO_NO_DISPONIBLE" },
    { nombre: "6 contactos oficiales sin cargar", deps: { contacts: async () => null }, body: { pregunta: "¿Qué requisitos tiene el RUM?" }, status: 503, codigo: "SERVICIO_NO_DISPONIBLE" },
    { nombre: "7 plazo agotado (cancelación incluida la espera del modelo)", env: { CHAT_DEADLINE_MS: "5000" },
      deps: { adapter: { call: (_m, req) => new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new ModelError("timeout", false, "abort")))) } },
      body: { pregunta: "¿Qué requisitos tiene el RUM?" }, status: 503, codigo: "SERVICIO_NO_DISPONIBLE" },
    { nombre: "8 error interno inesperado", deps: { contacts: async () => { throw new TypeError("select * from secretos falló en node_modules/pg"); } }, body: { pregunta: "x" }, status: 500, codigo: "ERROR_INTERNO" },
    { nombre: "9 respuesta sin fuente verificable (nunca se entrega sin sustento)", deps: { adapter: { call: async () => ok("Dato sin cita.\n<!--FUENTES: /ruta/interna.pdf-->") } }, body: { pregunta: "¿Qué requisitos tiene el RUM?" }, status: 503, codigo: "SERVICIO_NO_DISPONIBLE" },
  ];
  try {
    assert.equal(casos.length, 9);
    for (const c of casos) {
      resetCircuits();
      setChatDepsForTests({ ...base(), ...c.deps });
      const previo = Object.fromEntries(Object.keys(c.env ?? {}).map(k => [k, process.env[k]]));
      Object.assign(process.env, c.env ?? {});
      const t0 = Date.now();
      const r = await post(c.body);
      const ms = Date.now() - t0;
      for (const [k, v] of Object.entries(previo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      const texto = await r.text();
      assert.equal(r.status, c.status, `${c.nombre}: ${texto}`);
      const b = JSON.parse(texto);
      assert.equal(b.error.codigo, c.codigo, c.nombre);
      assert.equal(typeof b.error.mensaje, "string");
      if (c.campo) assert.equal(b.error.campo, c.campo, c.nombre);
      assert.ok(Array.isArray(b.canales), c.nombre);
      assert.ok(b.canales.length >= 1 && b.canales[0].value === "123", `${c.nombre}: los canales vigentes acompañan al error`);
      assert.ok(!FUGAS.test(texto), `${c.nombre}: fuga en ${texto}`);
      if (c.env) assert.ok(ms < 9_000, `${c.nombre}: respondió en ${ms} ms`);
    }
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.interaction")).rows[0].n, 0, "ningún error deja registro de consulta");
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.anonymous_usage")).rows[0].n, 0);
  } finally { server.close(); setChatDepsForTests(undefined); setChatPoolForTests(undefined); await db.close(); }
});
