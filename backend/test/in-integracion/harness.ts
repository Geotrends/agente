/**
 * Arnés de integración de SPEC005 (RF-C3-IN-04/08, RNF-C3-IN-04).
 *
 * Levanta la aplicación REAL (`createApp`, mismo orden de middleware que producción) sobre una base
 * PostgreSQL aislada con los roles/esquema de producción. Dobles explícitos y solo de prueba:
 * proveedor Bedrock, recuperación y demoras inyectables (cuerpo, búsqueda, modelo, contactos,
 * conversación, commit). Cada resultado se etiqueta `controlled`: NO acredita AWS, nginx ni portal.
 * Nunca toca volúmenes del usuario ni usa texto ciudadano real.
 *
 * Contadores seguros: solo cantidades y tiempos, jamás texto ni identificadores.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { createApp } from "../../src/app.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import { askBedrock, ModelError } from "../../src/bedrock/askBedrock.js";
import { setChatPoolForTests } from "../../src/chat/db.js";
import { setCanalesProvider } from "../../src/chat/errors.js";
import { chatWindow, prepWindow } from "../../src/chat/perimeter.js";
import { loadConversation, saveClarification } from "../../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../../src/chat/records.js";
import { setChatDepsForTests } from "../../src/routes/chat.js";
import { setAdminPoolForTests } from "../../src/admin/db.js";
import { operations } from "../../src/admin/operations.js";
import { productionDeps } from "../../src/chat/runtime.js";
import { writeEpisodes } from "../../src/chat/registryEpisode.js";
import { serviceEvents } from "../../src/admin/serviceEvents.js";
import { createChatAdminDb, type ChatAdminDb } from "../di-integracion/chatAdminDb.js";
import { FakeConverse } from "../di-integracion/harness.js";
import { hit } from "../di-support.js";
import type { RetrievedHit } from "../../src/chat/sources.js";

export const ORIGIN = "https://geobot.ejemplo.gov.co";
export const M20 = "openai.gpt-oss-20b-1:0";
export const M120 = "openai.gpt-oss-120b-1:0";
export const POLICY = "2026-10";
export const ADAPTER = "controlled" as const;

Object.assign(process.env, {
  AUTH_JWT_SECRET: "x".repeat(40), CHAT_ALLOWED_ORIGINS: ORIGIN, CONSENT_POLICY_VERSION: POLICY,
  CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica", CHAT_RATE_LIMIT_PER_MINUTE: "60", TRUST_PROXY: "1",
});

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Demoras (ms) que el arnés inserta en cada etapa; 0 = sin demora. */
export type Delays = { contacts: number; search: number; model: number; loadConversation: number; commit: number };

/** Contadores seguros: cantidades, nunca contenido. */
export type Counters = { modelCalls: number; searches: number; interactionWrites: number; anonymousWrites: number; finished: number; closedEarly: number };

export type InApp = {
  db: ChatAdminDb;
  base: string;
  port: number;
  converse: FakeConverse;
  delays: Delays;
  counters: Counters;
  adapter: typeof ADAPTER;
  /** Fragmentos que devuelve la recuperación (vacío = ausencia documental). */
  retrieval: { hits: RetrievedHit[] };
  /** Fuerza que la búsqueda falle (indisponibilidad de recuperación). */
  failSearch: { on: boolean };
  /** Fuerza que la escritura de interacciones falle (con `error`, el fallo trae ese mensaje exacto). */
  failRecording: { on: boolean; error?: Error };
  /** Respuesta por pregunta (para cargas concurrentes, donde un guion por orden no sirve). */
  answerFor: { fn?: (pregunta: string) => { text: string; inputTokens: number; outputTokens: number } };
  /** Si se define, el cliente Converse real (askBedrock) lanza este error: ejerce la clasificación y el log. */
  senderError: { error?: Error };
  close: () => Promise<void>;
};

export type StartOptions = { delays?: Partial<Delays>; seedContacts?: boolean };

export async function startInApp(opts: StartOptions = {}): Promise<InApp> {
  const db = await createChatAdminDb();
  setChatPoolForTests(db.chat);
  setAdminPoolForTests(db.admin);
  operations.reset();
  writeEpisodes.reset();
  serviceEvents.reset();
  setCanalesProvider(async budget => (await readContactSnapshot(db.chat, budget))?.inmediatos ?? []);
  chatWindow.reset();
  prepWindow.reset();
  if (opts.seedContacts !== false) {
    await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://pqrsd.prueba.gov.co', '+57 300 000 1111', 'pqrsd@prueba.gov.co')`);
    await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '(604) 000 2222', 'info@prueba.gov.co', 'https://prueba.gov.co/contacto')`);
    await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('Emergencias','24 h','teléfono','123',1)`);
  }
  for (const m of [M20, M120]) {
    await db.admin.query(
      `INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url)
       VALUES ($1,'us-east-1','USD',0.07,0.3,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`, [m]);
  }

  const converse = new FakeConverse();
  const delays: Delays = { contacts: 0, search: 0, model: 0, loadConversation: 0, commit: 0, ...opts.delays };
  const counters: Counters = { modelCalls: 0, searches: 0, interactionWrites: 0, anonymousWrites: 0, finished: 0, closedEarly: 0 };
  const retrieval = { hits: [hit(1)] as RetrievedHit[] };
  const failSearch = { on: false };
  // Pool sin base alcanzable: hace fallar la escritura de verdad (conexión rechazada).
  const deadPool = new pg.Pool({ connectionString: "postgres://x:y@127.0.0.1:1/nada", max: 2, connectionTimeoutMillis: 300 });
  deadPool.on("error", () => { /* conexiones muertas esperadas */ });
  const throwingPool = (error: Error): pg.Pool => ({ connect: async () => { throw error; } }) as unknown as pg.Pool;
  const failRecording: { on: boolean; error?: Error } = { on: false };
  const senderError: { error?: Error } = {};
  const answerFor: InApp["answerFor"] = {};

  // Avisos y estado reales del panel: los mismos ganchos de producción (episodios, doble fallo).
  const prod = productionDeps();
  setChatDepsForTests({
    onRegistryFailureEpisode: prod.onRegistryFailureEpisode,
    onRegistryNormal: prod.onRegistryNormal,
    onModelsUnavailable: prod.onModelsUnavailable,
    contacts: async budget => { if (delays.contacts) await sleep(delays.contacts); return readContactSnapshot(db.chat, budget); },
    retrieve: async () => {
      counters.searches++;
      if (delays.search) await sleep(delays.search);
      if (failSearch.on) throw new Error("busqueda_no_disponible");
      return { hits: retrieval.hits };
    },
    adapter: {
      call: async (modelId, req) => {
        counters.modelCalls++;
        if (senderError.error) {
          const e = senderError.error;
          return askBedrock(modelId, req, { send: async () => { throw e; } });
        }
        if (delays.model) await sleep(delays.model);
        if (answerFor.fn) {
          const a = answerFor.fn(req.pregunta);
          return { text: a.text, usage: { inputTokens: a.inputTokens, outputTokens: a.outputTokens }, stopReason: "end_turn", effectiveModel: modelId };
        }
        const r = await converse.send({ modelId, system: req.system, messages: [req.pregunta], maxTokens: 2200, temperature: 0 });
        if (r.kind === "error") throw new ModelError("network", true, "sin_guion");
        return { text: r.text, usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens }, stopReason: "end_turn", effectiveModel: modelId };
      },
    },
    loadConversation: async (id, sub, budget) => {
      if (delays.loadConversation) await sleep(delays.loadConversation);
      return loadConversation(id, sub, db.chat, budget);
    },
    saveClarification: (id, p, budget) => saveClarification(id, p, db.chat, new Date(), budget),
    saveInteraction: async (rec, hooks, budget) => {
      if (delays.commit) await sleep(delays.commit);
      // Con `failRecording` la escritura real falla contra un pool sin base: ejerce el episodio real.
      if (failRecording.on) return saveInteraction(rec, hooks, failRecording.error ? throwingPool(failRecording.error) : deadPool, budget);
      counters.interactionWrites++;
      return saveInteraction(rec, hooks, db.chat, budget);
    },
    saveAnonymousUsage: async (rec, hooks, budget) => {
      if (delays.commit) await sleep(delays.commit);
      if (failRecording.on) return saveAnonymousUsage(rec, hooks, failRecording.error ? throwingPool(failRecording.error) : deadPool, budget);
      counters.anonymousWrites++;
      return saveAnonymousUsage(rec, hooks, db.chat, budget);
    },
  });

  // Envoltorio que cuenta salidas terminales: cada solicitud debe terminar exactamente una vez.
  const outer = express();
  outer.use((_req, res, next) => {
    res.on("finish", () => { counters.finished++; });
    res.on("close", () => { if (!res.writableFinished) counters.closedEarly++; });
    next();
  });
  outer.use(createApp());
  const server = outer.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    db, converse, delays, counters, retrieval, failSearch, failRecording, senderError, answerFor, adapter: ADAPTER, port,
    base: `http://127.0.0.1:${port}/api`,
    close: async () => {
      void deadPool.end().catch(() => {});
      setChatDepsForTests(undefined);
      setAdminPoolForTests(undefined);
      operations.reset();
      writeEpisodes.reset();
      serviceEvents.reset();
      setChatPoolForTests(undefined);
      server.closeAllConnections?.();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await db.close();
    },
  };
}

export const OK_ANSWER = { kind: "ok" as const, text: "Respuesta documental [D1].\n<!--FUENTES: D1-->", inputTokens: 100, outputTokens: 20 };
export const queueAnswers = (c: InApp, n: number, model = M20): void => { for (let i = 0; i < n; i++) c.converse.on(model, OK_ANSWER); };

export async function sessionToken(c: InApp, ip = "1.1.1.1"): Promise<string> {
  const r = await fetch(`${c.base}/session`, { method: "POST", headers: { "x-forwarded-for": ip, origin: ORIGIN } });
  return (await r.json()).token as string;
}

/** POST con Origin explícito del ChatBot (el arnés nunca depende de «sin Origin»). */
export const post = (c: InApp, path: string, tk: string | null, body: unknown, extra: Record<string, string> = {}) =>
  fetch(`${c.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "1.1.1.1",
      ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...extra },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export async function authorize(c: InApp, tk: string): Promise<string> {
  return (await (await post(c, "/conversations", tk, { autorizacion: true, policyVersion: POLICY })).json()).conversationId as string;
}

export const countRows = async (c: InApp, table: string): Promise<number> =>
  (await c.db.migrator.query(`SELECT count(*)::int n FROM chat.${table}`)).rows[0].n as number;

export type RawResult = { status: number; headers: http.IncomingHttpHeaders; body: string; elapsedMs: number; socketClosed: boolean };

/**
 * Petición HTTP con cuerpo entregado por trozos con pausa (cuerpo lento) o con cierre anticipado.
 * Mide el tiempo hasta la respuesta completa o hasta el cierre del socket.
 */
export function rawRequest(c: InApp, opts: {
  method?: string; path: string; headers?: Record<string, string>; chunks?: string[]; gapMs?: number; declareLength?: number;
  /** Otro destino (p. ej. nginx) en lugar de la app directa. */
  port?: number;
}): Promise<RawResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const payload = (opts.chunks ?? []).join("");
    const req = http.request({
      host: "127.0.0.1", port: opts.port ?? c.port, method: opts.method ?? "POST", path: `/api${opts.path}`,
      headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "1.1.1.1",
        ...(opts.chunks ? { "content-length": String(opts.declareLength ?? Buffer.byteLength(payload)) } : {}), ...opts.headers },
    }, res => {
      const parts: Buffer[] = [];
      res.on("data", d => parts.push(d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts).toString("utf8"),
        elapsedMs: Date.now() - started, socketClosed: false }));
      res.on("error", reject);
    });
    req.on("error", e => {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ECONNRESET" || code === "EPIPE") {
        resolve({ status: 0, headers: {}, body: "", elapsedMs: Date.now() - started, socketClosed: true });
      } else reject(e);
    });
    void (async () => {
      for (const part of opts.chunks ?? []) {
        if (!req.writable) return;
        req.write(part);
        if (opts.gapMs) await sleep(opts.gapMs);
      }
      req.end();
    })();
  });
}

/** Resultado de comprobar que cada solicitud terminó exactamente una vez. */
export const singleTerminal = (c: InApp, expectedRequests: number): boolean =>
  c.counters.finished + c.counters.closedEarly >= expectedRequests && c.counters.finished <= expectedRequests;
