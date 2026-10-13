/**
 * App Express de pruebas de SPEC004: rutas reales (sesión, config, conversaciones, chat) sobre
 * PostgreSQL real, con recuperación y proveedor dobles (adapter `controlled`).
 */
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
import authRouter from "../../src/routes/auth.js";
import chatConfigRouter from "../../src/routes/chatConfig.js";
import conversationsRouter from "../../src/routes/conversations.js";
import feedbackRouter from "../../src/routes/feedback.js";
import chatRouter, { setChatDepsForTests } from "../../src/routes/chat.js";
import { ModelError } from "../../src/bedrock/askBedrock.js";
import { hit } from "../di-support.js";

export const ORIGIN = "https://geobot.ejemplo.gov.co";
export const M20 = "openai.gpt-oss-20b-1:0";
export const POLICY = "2026-10";

Object.assign(process.env, {
  AUTH_JWT_SECRET: "x".repeat(40), CHAT_ALLOWED_ORIGINS: ORIGIN, CONSENT_POLICY_VERSION: POLICY,
  CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica", CHAT_RATE_LIMIT_PER_MINUTE: "1000",
});

export type UiApp = {
  db: ChatAdminDb;
  base: string;
  converse: FakeConverse;
  /** Historiales (n.º de pares) que llegaron al proveedor, uno por llamada. */
  seen: { historial: number[] };
  /** Si es true, el registro de la interacción falla y la respuesta sale sin responseId. */
  failRecording: { on: boolean };
  adapter: "controlled";
  close: () => Promise<void>;
};

export async function startUiApp(): Promise<UiApp> {
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
  const failRecording = { on: false };
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
    saveInteraction: (rec, hooks) => failRecording.on ? Promise.resolve(null) : saveInteraction(rec, hooks, db.chat),
    saveAnonymousUsage: (rec, hooks) => saveAnonymousUsage(rec, hooks, db.chat),
  });
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api", authRouter, chatConfigRouter, conversationsRouter, chatRouter, feedbackRouter);
  const server = app.listen(0);
  return {
    db, converse, seen, failRecording, adapter: "controlled",
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    close: async () => { setChatDepsForTests(undefined); setChatPoolForTests(undefined); server.close(); await db.close(); },
  };
}

export const OK_ANSWER = { kind: "ok" as const, text: "Respuesta documental [D1].\n<!--FUENTES: D1-->", inputTokens: 100, outputTokens: 20 };
export const queueAnswers = (c: UiApp, n: number) => { for (let i = 0; i < n; i++) c.converse.on(M20, OK_ANSWER); };

export async function sessionToken(c: UiApp, ip = "1.1.1.1"): Promise<string> {
  const r = await fetch(`${c.base}/session`, { method: "POST", headers: { "x-forwarded-for": ip } });
  return (await r.json()).token as string;
}
export const post = (c: UiApp, path: string, tk: string, body: unknown, ip = "1.1.1.1") =>
  fetch(`${c.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tk}`, origin: ORIGIN, "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
export const authorize = async (c: UiApp, tk: string) =>
  (await (await post(c, "/conversations", tk, { autorizacion: true, policyVersion: POLICY })).json()).conversationId as string;
export const pairs = (n: number) => Array.from({ length: n }, (_, i) => ({ pregunta: `pregunta ${i}`, respuesta: `respuesta ${i}` }));
export const countRows = async (c: UiApp, table: string) =>
  (await c.db.migrator.query(`SELECT count(*)::int n FROM chat.${table}`)).rows[0].n as number;

/** Una consulta autorizada válida; devuelve su `responseId` auténtico. */
export async function authorizedAnswer(c: UiApp, tk: string, conversationId: string, pregunta = "¿Qué requisitos tiene?"): Promise<string> {
  const r = await post(c, "/chat", tk, { pregunta, conversationId });
  const b = await r.json();
  if (r.status !== 200 || !b.responseId) throw new Error(`sin responseId (${r.status})`);
  return b.responseId as string;
}
