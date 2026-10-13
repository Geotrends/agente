/**
 * T032 — Episodios de falla del registro (RF-C3-IN-08).
 *
 * 6 consultas con la escritura fallando (4 anónimas + 2 en conversación) y 2 con escritura
 * restablecida: todas se responden completas, las 2 de conversación salen sin `responseId`, hay UNA
 * notificación con fecha, hora y modo, y el registro vuelve a normal al primer éxito. Un segundo
 * episodio abre otro aviso aunque el primero siga sin revisar; el drenaje del buffer seguro es
 * serializado aunque la base operativa estuviera caída.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { setAdminPoolForTests } from "../../src/admin/db.js";
import { operations } from "../../src/admin/operations.js";
import { authorize, countRows, post, queueAnswers, sessionToken, startInApp, type InApp } from "./harness.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function withApp(fn: (c: InApp) => Promise<void>): Promise<void> {
  const c = await startInApp();
  try { await fn(c); } finally { await c.close(); }
}
const registroStatus = async () => (await operations.status()).find(s => s.component === "registro")!.status;
const avisosRegistro = async () => (await operations.list("no_revisada")).avisos.filter(a => a.type === "registro_no_disponible");

test("6 fallas (4 anónimas + 2 en conversación) y 2 recuperadas: respuestas completas, 2 sin ID, 1 aviso con fecha/modo, vuelve a normal", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    queueAnswers(c, 8);
    c.failRecording.on = true;
    const cuerpos = [
      { pregunta: "consulta en conversación 1", conversationId: conv },
      { pregunta: "anónima 1" }, { pregunta: "anónima 2" }, { pregunta: "anónima 3" }, { pregunta: "anónima 4" },
      { pregunta: "consulta en conversación 2", conversationId: conv },
    ];
    const salidas = [];
    for (const b of cuerpos) {
      const r = await post(c, "/chat", tk, b);
      assert.equal(r.status, 200);
      salidas.push(await r.json());
    }
    assert.ok(salidas.every(s => s.tipo === "respondida" && s.respuesta.length > 0 && s.fuentes.length === 1), "las seis se responden completas");
    assert.equal(salidas.filter(s => s.modo === "conversación" && !("responseId" in s)).length, 2, "2 en conversación sin identificador");
    assert.equal(salidas.filter(s => s.modo === "anónima").length, 4);
    assert.equal(await countRows(c, "interaction"), 0);
    assert.equal(await countRows(c, "anonymous_usage"), 0);
    await sleep(200);

    // UNA sola notificación, con fecha, hora y modo, sin texto de consulta.
    const avisos = await avisosRegistro();
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].repetitions, 1, "la falla continuada no incrementa avisos");
    assert.match(avisos[0].description, /modo conversación/);
    assert.match(avisos[0].description, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} hora de Colombia/);
    assert.ok(!/consulta en conversación|anónima \d/.test(avisos[0].description));
    assert.equal(await registroStatus(), "degradado");

    // Escritura restablecida: 2 consultas registradas y estado normal al primer éxito.
    c.failRecording.on = false;
    const a = await (await post(c, "/chat", tk, { pregunta: "ya con registro 1", conversationId: conv })).json();
    const b = await (await post(c, "/chat", tk, { pregunta: "ya con registro 2" })).json();
    assert.match(a.responseId, /^[0-9a-f-]{36}$/);
    assert.equal(b.modo, "anónima");
    await sleep(200);
    assert.equal(await countRows(c, "interaction"), 1);
    assert.equal(await countRows(c, "anonymous_usage"), 1);
    assert.equal(await registroStatus(), "normal");
    assert.equal((await avisosRegistro()).length, 1, "restablecer no abre ni cierra avisos");
  });
});

test("segundo episodio: aviso nuevo con su modo aunque el primero siga sin revisar", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    queueAnswers(c, 4);
    c.failRecording.on = true;
    await post(c, "/chat", tk, { pregunta: "anónima durante el primer episodio" });
    await sleep(150);
    c.failRecording.on = false;
    await post(c, "/chat", tk, { pregunta: "recuperada" });
    await sleep(150);
    assert.equal(await registroStatus(), "normal");
    const conv = await authorize(c, tk);
    c.failRecording.on = true;
    await post(c, "/chat", tk, { pregunta: "segundo episodio", conversationId: conv });
    await sleep(150);
    const avisos = await avisosRegistro();
    assert.equal(avisos.length, 2, "dos episodios, dos avisos sin revisar");
    const modos = avisos.map(a => /modo (conversación|anónima)/.exec(a.description)![1]).sort();
    assert.deepEqual(modos, ["anónima", "conversación"]);
    assert.equal(await registroStatus(), "degradado");
  });
});

test("base operativa caída durante el episodio: buffer seguro visible y drenaje serializado sin duplicar ni perder", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    queueAnswers(c, 3);
    // La base del panel no responde: el aviso queda en memoria (solo metadatos) y se ve igual.
    const caida = new pg.Pool({ connectionString: "postgres://x:y@127.0.0.1:1/nada", max: 1, connectionTimeoutMillis: 200 });
    caida.on("error", () => {});
    setAdminPoolForTests(caida);
    c.failRecording.on = true;
    await post(c, "/chat", tk, { pregunta: "anónima con panel caído" });
    await sleep(500);
    const enMemoria = await avisosRegistro();
    assert.equal(enMemoria.length, 1);
    assert.ok(enMemoria[0].id.startsWith("volatil-"));
    assert.ok(!JSON.stringify(enMemoria).includes("anónima con panel caído"));
    // Una repetición del mismo aviso mientras la base sigue caída se agrupa en memoria (no abre otro).
    assert.equal(enMemoria[0].repetitions, 1);

    // Vuelve la base: varios drenajes simultáneos escriben el aviso UNA sola vez.
    setAdminPoolForTests(c.db.admin);
    await Promise.all([operations.flushVolatile(), operations.flushVolatile(), operations.reportComponent("registro", false), operations.flushVolatile()]);
    const { rows } = await c.db.migrator.query("SELECT object_id, repetitions FROM admin.notification WHERE type = 'registro_no_disponible'");
    const delEpisodio = rows.filter(r => String(r.object_id).startsWith("registro:"));
    assert.equal(delEpisodio.length, 1, "un solo aviso persistido por el episodio");
    assert.equal(delEpisodio[0].repetitions, 1, "sin duplicación al drenar en paralelo");
    assert.equal((await avisosRegistro()).filter(a => a.id.startsWith("volatil-")).length, 0, "el buffer quedó vacío");
    void caida.end().catch(() => {});
  });
});
