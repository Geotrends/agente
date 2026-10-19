import test from "node:test";
import assert from "node:assert/strict";
import { createChatAdminDb, type ChatAdminDb } from "./chatAdminDb.js";
import { FakeConverse } from "./harness.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import { ChatFailure, orchestrate, type OrchestratorDeps } from "../../src/chat/orchestrator.js";
import type { PreguntaValidada } from "../../src/chat/contracts.js";
import { hit } from "../di-support.js";

const M20 = "openai.gpt-oss-20b-1:0";

async function seed(db: ChatAdminDb, whatsapp: string): Promise<void> {
  await db.admin.query(
    `INSERT INTO admin.contact_reception VALUES (1, 'https://pqrsd.prueba.gov.co', $1, 'pqrsd@prueba.gov.co')
       ON CONFLICT (id) DO UPDATE SET whatsapp = EXCLUDED.whatsapp`, [whatsapp]);
  await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '(604) 000 2222', 'info@prueba.gov.co', 'https://prueba.gov.co/contacto') ON CONFLICT (id) DO NOTHING`);
  const { rowCount } = await db.admin.query("SELECT 1 FROM admin.contact_immediate");
  if (!rowCount) await db.admin.query("INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('Emergencias','24 h','teléfono','123',1)");
}

const pregunta = (p: string): PreguntaValidada => ({ pregunta: p, historial: [] });

function deps(db: ChatAdminDb, converse: FakeConverse, hits = [hit(1), hit(2), hit(3)]): OrchestratorDeps & { retrieved: string[] } {
  const retrieved: string[] = [];
  return {
    retrieved,
    retrieve: async q => { retrieved.push(q); return { hits }; },
    contacts: () => readContactSnapshot(db.chat),
    model: async req => {
      const r = await converse.send({ modelId: M20, system: req.system, messages: [req.pregunta], maxTokens: 2200, temperature: 0 });
      if (r.kind === "error") throw new Error(r.message);
      return { text: r.text, usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens }, stopReason: r.stopReason ?? "end_turn", effectiveModel: M20 };
    },
  };
}

test("US1 por contrato: 5 presentes con fuentes y fechas; 5 ausentes con texto exacto y sin llamar al modelo", async () => {
  const db = await createChatAdminDb();
  try {
    await seed(db, "+57 300 111 0000");
    for (let i = 0; i < 5; i++) {
      const converse = new FakeConverse().on(M20, { kind: "ok", text: `Presente el formato [D1] y la solicitud [D2].\n<!--FUENTES: D1|D2|D3-->`, inputTokens: 100, outputTokens: 20 });
      const out = await orchestrate(pregunta(`¿Qué necesito para el trámite ${i}?`), deps(db, converse));
      assert.equal(out.tipo, "respondida");
      assert.deepEqual(out.fuentes.map(f => f.id), ["doc-1", "doc-2"], "la fuente sobrante D3 no aparece");
      assert.ok(!/según|actualizado el|consultado el/.test(out.respuesta), "la cita no va dentro del texto");
      assert.ok(out.respuesta.includes("+57 300 111 0000"), "cierre con el canal del registro");
      assert.ok(!/<!--|\[D\d/.test(out.respuesta));
      assert.ok(out.interno && !JSON.stringify({ r: out.respuesta, f: out.fuentes }).includes("gpt-oss"), "nada del modelo llega al ciudadano");
      assert.ok(converse.calls[0].system.includes("+57 300 111 0000"), "el prompt lleva el snapshot vigente");
    }
    for (let i = 0; i < 5; i++) {
      const converse = new FakeConverse();
      const out = await orchestrate(pregunta("¿Cuál es el trámite inexistente?"), deps(db, converse, []));
      assert.equal(out.tipo, "sin información");
      assert.ok(out.respuesta.startsWith("No encontré información validada…"));
      assert.deepEqual(out.fuentes, []);
      assert.equal(converse.calls.length, 0);
    }
  } finally { await db.close(); }
});

test("el cambio de contactos se ve en la consulta siguiente, sin redespliegue", async () => {
  const db = await createChatAdminDb();
  try {
    await seed(db, "+57 300 111 0000");
    const texto = "Dato [D1].\n<!--FUENTES: D1-->";
    const ask = async () => (await orchestrate(pregunta("consulta"),
      deps(db, new FakeConverse().on(M20, { kind: "ok", text: texto, inputTokens: 1, outputTokens: 1 })))).respuesta;
    assert.ok((await ask()).includes("+57 300 111 0000"));
    await db.admin.query("UPDATE admin.contact_reception SET whatsapp = '+57 322 999 8888'");
    const despues = await ask();
    assert.ok(despues.includes("+57 322 999 8888") && !despues.includes("111 0000"));
  } finally { await db.close(); }
});

test("fallos nunca se disfrazan de ausencia: búsqueda, datos de fuente, modelo, fuente inválida, contactos", async () => {
  const db = await createChatAdminDb();
  try {
    const ok = { kind: "ok" as const, text: "x [D1]\n<!--FUENTES: D1-->", inputTokens: 1, outputTokens: 1 };
    // Sin contactos oficiales cargados: servicio no preparado.
    await assert.rejects(orchestrate(pregunta("q"), deps(db, new FakeConverse().on(M20, ok))), (e: ChatFailure) => e.kind === "contactos_no_disponibles");
    await seed(db, "+57 300 111 0000");

    const base = deps(db, new FakeConverse().on(M20, ok));
    await assert.rejects(orchestrate(pregunta("q"), { ...base, retrieve: async () => { throw new Error("qdrant caído"); } }), (e: ChatFailure) => e.kind === "busqueda_fallida");
    await assert.rejects(orchestrate(pregunta("q"), deps(db, new FakeConverse().on(M20, ok), [hit(1, { fechaActualizacion: undefined })])), (e: ChatFailure) => e.kind === "datos_fuente");
    await assert.rejects(orchestrate(pregunta("q"), deps(db, new FakeConverse())), (e: ChatFailure) => e.kind === "modelo_fallido");
    const sinFuente = new FakeConverse().on(M20, { kind: "ok", text: "Hecho sin cita.\n<!--FUENTES: /ruta/interna.pdf-->", inputTokens: 1, outputTokens: 1 });
    await assert.rejects(orchestrate(pregunta("q"), deps(db, sinFuente)), (e: ChatFailure) => e.kind === "sin_fuente_valida");
  } finally { await db.close(); }
});

test("decisión pedida: leyenda exacta y responsable; informativa: sin leyenda", async () => {
  const db = await createChatAdminDb();
  try {
    await seed(db, "+57 300 111 0000");
    const texto = "La decisión la toma la Dirección de Ecosistemas [D1].\n<!--FUENTES: D1-->";
    const ask = (q: string) => orchestrate(pregunta(q), deps(db, new FakeConverse().on(M20, { kind: "ok", text: texto, inputTokens: 1, outputTokens: 1 })));
    assert.ok((await ask("¿Me aprueban el permiso de poda?")).respuesta.includes("no reemplaza asesoría técnica ni jurídica formal"));
    assert.ok(!(await ask("¿Qué requisitos tiene el permiso de poda?")).respuesta.includes("no reemplaza asesoría"));
  } finally { await db.close(); }
});
