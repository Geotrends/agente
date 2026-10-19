/**
 * US5 de extremo a extremo con recuperación REAL (Qdrant + embeddings + reranker locales),
 * modelo de lenguaje doble y PostgreSQL real: evidencia y seguimientos con pregunta saneada y
 * plantilla común (RF-C3-DI-04/05/07/08/15, RNF-C3-DI-01).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { reconstruirColeccion } from "../../src/kb/service.js";
import { calibrateCollection } from "../../src/kb/calibrateCollection.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import { Deadline } from "../../src/chat/deadline.js";
import { handleChat, type ChatDeps } from "../../src/chat/handleChat.js";
import { loadConversation, saveClarification, createConversation } from "../../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../../src/chat/records.js";
import { embed } from "../../src/services/embeddings.js";
import { hybridSearch, prepareIndex } from "../../src/services/search.js";
import { resetCalibrationCache } from "../../src/services/calibration.js";
import { qdrant } from "../../src/services/qdrant.js";
import { prepararQdrantDePrueba } from "../kb-integracion/qdrantPruebas.js";
import { createChatAdminDbWithKb } from "./chatAdminDb.js";
import { DOCS, ORO, sembrar } from "./kbCorpus.js";

let db: Awaited<ReturnType<typeof createChatAdminDbWithKb>>;
let alias: string;
const M20 = "openai.gpt-oss-20b-1:0";

before(async () => {
  db = await createChatAdminDbWithKb();
  alias = prepararQdrantDePrueba();
  process.env.APP_DATABASE_URL = (await import("./chatAdminDb.js")).ADMIN_URL.replace(/\/[^/]*$/, `/${db.name}`);
  process.env.RETRIEVAL_WORKER = "false";
  await sembrar(db.kb);
  await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://pqrsd.prueba.gov.co', '+57 300 000 1111', 'pqrsd@prueba.gov.co')`);
  await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '(604) 000 2222', 'info@prueba.gov.co', 'https://prueba.gov.co/contacto')`);
  await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('Emergencias','24 h','teléfono','123',1)`);
  await db.admin.query(`INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url) VALUES ($1,'us-east-1','USD',0.07,0.3,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`, [M20]);
  await reconstruirColeccion(db.kb, "cli:prueba", { embedder: embed, calibrar: (c, i) => calibrateCollection(c, ORO, "oro", i) });
  resetCalibrationCache();
  await prepareIndex();
});

after(async () => {
  await db?.close();
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

function deps(capture: { colas: Array<string | undefined>; modelo: number; contextos: string[] }): ChatDeps {
  return {
    contacts: () => readContactSnapshot(db.chat),
    retrieve: async (pregunta, cola) => { capture.colas.push(cola); const r = await hybridSearch(pregunta, cola); return { hits: r.hits }; },
    adapter: { call: async (m, req) => {
      capture.modelo++; capture.contextos.push(req.system);
      return { text: "Según los documentos, estos son los requisitos [D1].\n<!--FUENTES: D1-->", usage: { inputTokens: 100, outputTokens: 20 }, stopReason: "end_turn", effectiveModel: m };
    } },
    loadConversation: (id, sub) => loadConversation(id, sub, db.chat),
    saveClarification: (id, p) => saveClarification(id, p, db.chat),
    saveInteraction: (rec, h) => saveInteraction(rec, h, db.chat),
    saveAnonymousUsage: (rec, h) => saveAnonymousUsage(rec, h, db.chat),
  };
}
const cap = () => ({ colas: [] as Array<string | undefined>, modelo: 0, contextos: [] as string[] });

test("5 presentes: respondidas con fuente, fecha y enlace https; 5 ausentes: texto exacto sin llamar al modelo", async () => {
  const presentes = ["¿Qué necesito para registrar una mascota en el RUM?", "¿Cómo denuncio el maltrato animal?", "¿Qué exige la adopción de una mascota?",
    "¿Qué se necesita para podar un árbol en espacio público?", "¿Necesito licencia ambiental para un proyecto?"];
  const ausentes = ["¿Cuál es la receta del sancocho antioqueño?", "¿Cuánto cuesta un pasaje aéreo a Bogotá?", "¿Cómo se juega el ajedrez?",
    "¿Cuál es la capital de Mongolia?", "¿Cuánto mide el monte Everest?"];
  for (const p of presentes) {
    const c = cap();
    const r = await handleChat({ pregunta: p, historial: [] }, "s", deps(c), new Deadline());
    assert.equal(r.status, 200);
    if (r.status !== 200) return;
    assert.equal(r.body.tipo, "respondida", p);
    assert.ok(r.body.fuentes.length >= 1);
    for (const f of r.body.fuentes) {
      assert.match(f.enlace, /^https:\/\//);
      assert.match(f.fecha, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(!/\[D\d+\]/.test(r.body.respuesta), "sin marcadores técnicos: la fuente viaja aparte, en `fuentes`");
    }
    assert.ok(c.contextos[0].includes("ID: D1"));
  }
  for (const p of ausentes) {
    const c = cap();
    const r = await handleChat({ pregunta: p, historial: [] }, "s", deps(c), new Deadline());
    assert.equal(r.status, 200);
    if (r.status !== 200) return;
    assert.equal(r.body.tipo, "sin información", p);
    assert.ok(r.body.respuesta.startsWith("No encontré información validada…"));
    assert.deepEqual(r.body.fuentes, []);
    assert.equal(c.modelo, 0, "ni un token de LLM cuando no hay evidencia");
  }
});

test("seguimientos: la cola ≤500 solo alimenta la búsqueda, no el contexto del modelo; las autónomas no la usan; anónimas jamás", async () => {
  const conv = await createConversation("s", "2026-10", db.chat);
  const previa = "¿Qué necesito para registrar una mascota en el RUM?";
  const historial = [{ pregunta: previa, respuesta: "Presente la cédula, el carnet y una foto." }];

  const c1 = cap();
  const seg = await handleChat({ pregunta: "¿y el costo de eso?", conversationId: conv, historial }, "s", deps(c1), new Deadline());
  assert.equal(seg.status, 200);
  assert.equal(c1.colas[0], previa, "la cola de la pregunta previa viaja a la búsqueda");
  assert.ok(!c1.contextos[0]?.includes("Presente la cédula") || c1.modelo === 0, "el historial no entra al system prompt");

  const c2 = cap();
  await handleChat({ pregunta: "¿Cómo denuncio el maltrato animal en Envigado?", conversationId: conv, historial }, "s", deps(c2), new Deadline());
  assert.equal(c2.colas[0], undefined, "una pregunta autónoma no recibe cola");

  const c3 = cap();
  await handleChat({ pregunta: "¿y el costo de eso?", historial: [] }, "s", deps(c3), new Deadline());
  assert.equal(c3.colas[0], undefined, "una anónima no amplía nada");
});

test("la fuente publicada coincide con la matriz: nombre y fecha del payload", async () => {
  const c = cap();
  const r = await handleChat({ pregunta: "¿Qué necesito para registrar una mascota en el RUM?", historial: [] }, "s", deps(c), new Deadline());
  assert.ok(r.status === 200);
  if (r.status !== 200) return;
  const { rows } = await db.kb.query("SELECT nombre, url_origen FROM kb.kb_elemento WHERE nombre = $1", [DOCS[0].nombre]);
  assert.ok(r.body.fuentes.some(f => f.nombre === rows[0].nombre && f.enlace === rows[0].url_origen));
});
