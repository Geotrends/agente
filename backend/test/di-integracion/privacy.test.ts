import test from "node:test";
import assert from "node:assert/strict";
import { createChatAdminDb } from "./chatAdminDb.js";
import { handleChat } from "../../src/chat/handleChat.js";
import { Deadline } from "../../src/chat/deadline.js";
import { createConversation, loadConversation, saveClarification } from "../../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../../src/chat/records.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import { hit } from "../di-support.js";

const M20 = "openai.gpt-oss-20b-1:0";
const SECRETOS = ["43.256.789", "3104567890", "ana.perez@correo.com", "Carlos Gómez", "Calle 10 # 20 - 30"];
const PREGUNTA = "Mi cédula es 43.256.789, mi celular 3104567890, escríbame a ana.perez@correo.com. Mi vecino Carlos Gómez vive en la Calle 10 # 20 - 30. ¿Cómo denuncio?";

test("el dato personal no llega al proveedor, ni a ninguna tabla, ni al log; las anónimas no dejan rastro", async () => {
  const db = await createChatAdminDb();
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://p.gov.co', '300 111 2233', 'a@b.co')`);
    await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '604 555 0100', 'i@b.co', 'https://p.gov.co/c')`);
    await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('E','d','teléfono','123',1)`);
    await db.admin.query(`INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url) VALUES ($1,'us-east-1','USD',0.07,0.3,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`, [M20]);
    const enviado: string[] = [];
    const deps = {
      contacts: () => readContactSnapshot(db.chat),
      retrieve: async () => ({ hits: [hit(1)] }),
      adapter: { call: async (m: string, req: { system: string; pregunta: string; historial: unknown[] }) => {
        enviado.push(req.system + "\n" + req.pregunta + "\n" + JSON.stringify(req.historial));
        return { text: "Respuesta [D1].\n<!--FUENTES: D1-->", usage: { inputTokens: 10, outputTokens: 5 }, stopReason: "end_turn" as const, effectiveModel: m };
      } },
      loadConversation: (id: string, sub: string) => loadConversation(id, sub, db.chat),
      saveClarification: (id: string, p: boolean) => saveClarification(id, p, db.chat),
      saveInteraction: (rec: Parameters<typeof saveInteraction>[0], h: Parameters<typeof saveInteraction>[1]) => saveInteraction(rec, h, db.chat),
      saveAnonymousUsage: (rec: Parameters<typeof saveAnonymousUsage>[0], h: Parameters<typeof saveAnonymousUsage>[1]) => saveAnonymousUsage(rec, h, db.chat),
    };
    const conv = await createConversation("sub-sesion", "2026-10", db.chat);
    const auth = await handleChat({ pregunta: PREGUNTA, conversationId: conv, historial: [{ pregunta: "antes, mi correo ana.perez@correo.com", respuesta: "ok" }] }, "sub-sesion", deps, new Deadline());
    assert.equal(auth.status, 200);
    for (let i = 0; i < 5; i++) {
      assert.equal((await handleChat({ pregunta: `${PREGUNTA} (${i})`, historial: [] }, "sub-sesion", deps, new Deadline())).status, 200);
    }

    // 1) Proveedor: ningún secreto.
    for (const e of enviado) for (const s of SECRETOS) assert.ok(!e.includes(s), `al proveedor llegó ${s}`);
    // 2) Todas las tablas de chat y admin.
    const tablas = (await db.migrator.query("SELECT table_schema s, table_name t FROM information_schema.tables WHERE table_schema IN ('chat','admin') AND table_type='BASE TABLE'")).rows;
    for (const { s, t } of tablas) {
      const dump = JSON.stringify((await db.migrator.query(`SELECT row_to_json(x) j FROM ${s}.${t} x`)).rows);
      for (const secreto of SECRETOS) assert.ok(!dump.includes(secreto), `${s}.${t} contiene ${secreto}`);
      assert.ok(!dump.includes("sub-sesion"), `${s}.${t} contiene el sujeto de la sesión`);
    }
    // 3) El texto guardado de la autorizada está saneado y las anónimas no dejan texto ni identificador.
    const fila = (await db.migrator.query("SELECT question_text FROM chat.interaction")).rows;
    assert.equal(fila.length, 1);
    for (const etiqueta of ["[CÉDULA]", "[TELÉFONO]", "[CORREO]"]) assert.ok(fila[0].question_text.includes(etiqueta));
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.anonymous_usage")).rows[0].n, 5);
    // 4) Logs de la aplicación: nada de texto, datos ni cabeceras.
    const log = logs.join("\n");
    for (const s of [...SECRETOS, "Authorization", "Bearer "]) assert.ok(!log.includes(s), `el log contiene ${s}`);
    assert.ok(!log.includes("¿Cómo denuncio?"), "el log no contiene el texto de la pregunta");
  } finally {
    Object.assign(console, orig);
    await db.close();
  }
});

// ── SPEC005 · C306 / C307 (T031) ─────────────────────────────────────────────────────────────

type Deps = Parameters<typeof handleChat>[2];

async function seeded() {
  const db = await createChatAdminDb();
  await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://pqrsd.prueba.gov.co', '+57 300 111 2233', 'pqrsd@prueba.gov.co')`);
  await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '(604) 555 0100', 'info@prueba.gov.co', 'https://prueba.gov.co/contacto')`);
  await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('E','d','teléfono','123',1)`);
  await db.admin.query(`INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url) VALUES ($1,'us-east-1','USD',0.07,0.3,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`, [M20]);
  const enviado: string[] = [];
  const deps = (answer: string, writeInteraction = true): Deps => ({
    contacts: () => readContactSnapshot(db.chat),
    retrieve: async () => ({ hits: [hit(1)] }),
    adapter: { call: async (m: string, req: { system: string; pregunta: string; historial: unknown[] }) => {
      enviado.push(`${req.pregunta}\n${JSON.stringify(req.historial)}`);
      return { text: answer, usage: { inputTokens: 10, outputTokens: 5 }, stopReason: "end_turn" as const, effectiveModel: m };
    } },
    loadConversation: (id: string, sub: string) => loadConversation(id, sub, db.chat),
    saveClarification: (id: string, p: boolean) => saveClarification(id, p, db.chat),
    saveInteraction: writeInteraction
      ? (rec, h) => saveInteraction(rec, h, db.chat)
      : async () => null,
    saveAnonymousUsage: (rec, h) => saveAnonymousUsage(rec, h, db.chat),
  });
  return { db, deps, enviado };
}

test("C306 · 14 consultas: 9 con datos llevan etiqueta y 0 apariciones; 5 sin datos idénticas; la respuesta no cambia", async () => {
  const { db, deps, enviado } = await seeded();
  try {
    // El modelo (doble) incluso reproduce un teléfono ajeno: el registro lo enmascara, la entrega no.
    const RESPUESTA = "Para el trámite, escriba al 3104567890 o use el canal oficial. [D1]\n<!--FUENTES: D1-->";
    const conDatos: Array<{ q: string; secretos: string[]; etiquetas: string[] }> = [
      { q: "Mi cédula es 43.256.789, ¿qué requisitos tiene el trámite?", secretos: ["43.256.789"], etiquetas: ["[CÉDULA]"] },
      { q: "Soy titular de la cédula 1017234567 y quiero saber el plazo", secretos: ["1017234567"], etiquetas: ["[CÉDULA]"] },
      { q: "Llámeme al 3104567890 para el permiso", secretos: ["3104567890"], etiquetas: ["[TELÉFONO]"] },
      { q: "Mi número es +57 300 123 4567, ¿dónde radico?", secretos: ["300 123 4567"], etiquetas: ["[TELÉFONO]"] },
      { q: "Respóndame a luis.mora@correo.com sobre el trámite", secretos: ["luis.mora@correo.com"], etiquetas: ["[CORREO]"] },
      { q: "Escríbame a ana_r@correo.co o al 3201112233", secretos: ["ana_r@correo.co", "3201112233"], etiquetas: ["[CORREO]", "[TELÉFONO]"] },
      { q: "Con la cédula 79123456 y el correo p.diaz@correo.com, ¿qué formato uso?", secretos: ["79123456", "p.diaz@correo.com"], etiquetas: ["[CÉDULA]", "[CORREO]"] },
      { q: "Mi teléfono fijo es (604) 555 01 23, ¿cuánto tarda?", secretos: ["(604) 555 01 23"], etiquetas: ["[TELÉFONO]"] },
      { q: "CC 52.987.654, tel 3159876543, mail rosa@correo.com: ¿qué necesito?", secretos: ["52.987.654", "3159876543", "rosa@correo.com"], etiquetas: ["[CÉDULA]", "[TELÉFONO]", "[CORREO]"] },
    ];
    const sinDatos = [
      "¿Qué dice la Ley 1581 de 2012 y el Decreto 1074 de 2015 sobre el tratamiento de datos?",
      "¿Qué requisitos pide el formato GT-F-012 del procedimiento GT-P-003?",
      "¿Sigue vigente la Resolución 40103 del 5 de marzo de 2020?",
      "El radicado 2026-004512 presentado el 15/03/2026, ¿en qué estado está?",
      "¿Cuánto es la asignación de $1.865.000 y el presupuesto de 30.000.000?",
    ];
    assert.equal(conDatos.length + sinDatos.length, 14);
    const conv = await createConversation("sub-c306", "2026-10", db.chat);
    for (const caso of conDatos) {
      const real = await handleChat({ pregunta: caso.q, conversationId: conv, historial: [] }, "sub-c306", deps(RESPUESTA), new Deadline());
      const sinEscritura = await handleChat({ pregunta: caso.q, conversationId: conv, historial: [] }, "sub-c306", deps(RESPUESTA, false), new Deadline());
      assert.equal(real.status, 200);
      assert.ok(real.status === 200 && sinEscritura.status === 200 && real.body.respuesta === sinEscritura.body.respuesta,
        "el saneamiento del registro no altera lo entregado");
      assert.ok(real.status === 200 && real.body.respuesta.includes("3104567890"), "la entrega conserva lo que dijo el modelo");
    }
    for (const q of sinDatos) {
      assert.equal((await handleChat({ pregunta: q, conversationId: conv, historial: [] }, "sub-c306", deps("Respuesta [D1].\n<!--FUENTES: D1-->"), new Deadline())).status, 200);
    }
    const filas = (await db.migrator.query("SELECT question_text, answer_text FROM chat.interaction ORDER BY row_id")).rows;
    assert.equal(filas.length, 9 + 5, "9 con datos (solo la corrida real escribe) + 5 sin datos");
    conDatos.forEach((caso, i) => {
      const f = filas[i];
      for (const e of caso.etiquetas) assert.ok(f.question_text.includes(e), `${caso.q} → etiqueta ${e}`);
      for (const s of caso.secretos) {
        assert.ok(!f.question_text.includes(s), `el registro aún trae ${s}`);
        assert.ok(!f.answer_text.includes(s), `la respuesta registrada aún trae ${s}`);
      }
      assert.ok(f.answer_text.includes("[TELÉFONO]") && !f.answer_text.includes("3104567890"), "la respuesta guardada enmascara el teléfono");
      // Los canales oficiales no son datos ciudadanos: se conservan intactos en el registro.
      assert.ok(f.answer_text.includes("pqrsd@prueba.gov.co") || f.answer_text.includes("+57 300 111 2233"), "canal oficial intacto");
    });
    sinDatos.forEach((q, i) => {
      assert.equal(filas[9 + i].question_text, q, "sin datos personales el texto es idéntico");
    });
    for (const e of enviado) for (const caso of conDatos) for (const s of caso.secretos) assert.ok(!e.includes(s), `al proveedor llegó ${s}`);
  } finally { await db.close(); }
});

test("C307 · 6 anónimas: 6 registros con exactamente 6 campos técnicos, 0 coincidencias en toda la base y 0 conversaciones", async () => {
  const { db, deps } = await seeded();
  try {
    const consultas = [
      "Mi cédula es 43.256.789, ¿cuánto cuesta el trámite?", "¿Qué documentos pide el permiso de vertimientos?",
      "Escríbame a ana.perez@correo.com, ¿cuándo atienden?", "¿Cómo registro una mascota en el RUM?",
      "El vecino Carlos Gómez tiene un perro sin vacunas, ¿a quién reporto?", "¿Qué dice el Decreto 1074 de 2015?",
    ];
    const antes = (await db.migrator.query("SELECT count(*)::int n FROM chat.conversation")).rows[0].n;
    for (const q of consultas) {
      const r = await handleChat({ pregunta: q, historial: [] }, "sub-anon", deps("Respuesta [D1].\n<!--FUENTES: D1-->"), new Deadline());
      assert.equal(r.status, 200);
      assert.ok(r.status === 200 && r.body.modo === "anónima");
    }
    const filas = (await db.migrator.query("SELECT * FROM chat.anonymous_usage")).rows;
    assert.equal(filas.length, 6);
    for (const f of filas) assert.deepEqual(Object.keys(f).sort(), ["estimated_cost", "input_tokens", "mode", "model", "output_tokens", "received_at"]);
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.conversation")).rows[0].n, antes);
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.interaction")).rows[0].n, 0);
    // 0 coincidencias de los textos en TODA la base (esquemas chat y admin, incluidos avisos).
    const tablas = (await db.migrator.query("SELECT table_schema s, table_name t FROM information_schema.tables WHERE table_schema IN ('chat','admin') AND table_type='BASE TABLE'")).rows;
    for (const { s, t } of tablas) {
      const dump = JSON.stringify((await db.migrator.query(`SELECT row_to_json(x) j FROM ${s}.${t} x`)).rows);
      for (const q of consultas) assert.ok(!dump.includes(q.slice(0, 20)), `${s}.${t} contiene texto de una anónima`);
      for (const secreto of ["43.256.789", "ana.perez@correo.com", "Carlos Gómez", "sub-anon"]) assert.ok(!dump.includes(secreto), `${s}.${t} contiene ${secreto}`);
    }
  } finally { await db.close(); }
});
