/**
 * T023 — Resultados, fuentes y registros (RF-C3-IN-03, RF-C3-IN-05).
 *
 * Diez consultas (6 autorizadas / 4 anónimas) con los cuatro tipos; ocho registros completos con
 * los nueve campos del contrato más modelo efectivo, tokens y costo (DI16); fuentes exactas y
 * únicas; fallo o commit indeterminado sin `responseId`; fecha y duración desde la recepción.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { hit } from "../di-support.js";
import { authorize, countRows, M20, post, queueAnswers, rawRequest, sessionToken, startInApp, type InApp } from "./harness.js";

async function withApp(fn: (c: InApp) => Promise<void>, opts?: Parameters<typeof startInApp>[0]): Promise<void> {
  const c = await startInApp(opts);
  try { await fn(c); } finally { await c.close(); }
}

const ACLARA = { kind: "ok" as const, text: "¿Sobre qué trámite necesita saber?\n<!--TIPO: aclaracion-->", inputTokens: 40, outputTokens: 10 };
const CAMPOS = ["conversation_id", "response_id", "received_at", "category", "question_text", "answer_text", "result_type",
  "cited_documents", "duration_ms", "visible_output_tokens", "model", "input_tokens", "output_tokens", "tariff_version", "estimated_cost"] as const;

test("10 consultas (6 autorizadas / 4 anónimas): cuatro tipos con fuentes exactas, únicas y vacías en no respondidas", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    const casos: Array<{ auth: boolean; q: string; tipo: string; fuentes: number; hits?: boolean; script?: "aclara" | "ok" }> = [
      { auth: true, q: "¿Qué requisitos tiene el trámite?", tipo: "respondida", fuentes: 1, script: "ok" },
      { auth: true, q: "¿Y el costo del trámite?", tipo: "respondida", fuentes: 1, script: "ok" },
      { auth: true, q: "Necesito un permiso", tipo: "aclaración", fuentes: 0, script: "aclara" },
      { auth: true, q: "Calcula una regresión lineal de mis datos", tipo: "fuera de alcance", fuentes: 0 },
      { auth: true, q: "¿Qué dice la norma sobre drones?", tipo: "sin información", fuentes: 0, hits: false },
      { auth: true, q: "¿Dónde radico el documento?", tipo: "respondida", fuentes: 1, script: "ok" },
      { auth: false, q: "¿Qué requisitos pide la licencia?", tipo: "respondida", fuentes: 1, script: "ok" },
      { auth: false, q: "¿Qué dice la norma sobre drones?", tipo: "sin información", fuentes: 0, hits: false },
      { auth: false, q: "Dame el pronóstico de lluvias", tipo: "fuera de alcance", fuentes: 0 },
      { auth: false, q: "¿Cómo registro una mascota?", tipo: "respondida", fuentes: 1, script: "ok" },
    ];
    assert.equal(casos.length, 10);
    assert.equal(casos.filter(x => x.auth).length, 6);
    const tiposVistos = new Set<string>();
    const responseIds: string[] = [];
    for (const k of casos) {
      c.retrieval.hits = k.hits === false ? [] : [hit(1)];
      if (k.script === "aclara") c.converse.on(M20, ACLARA); else if (k.script === "ok") queueAnswers(c, 1);
      const r = await post(c, "/chat", tk, k.auth ? { pregunta: k.q, conversationId: conv } : { pregunta: k.q });
      assert.equal(r.status, 200, k.q);
      const b = await r.json();
      assert.equal(b.tipo, k.tipo, k.q);
      assert.equal(b.modo, k.auth ? "conversación" : "anónima");
      assert.equal(b.fuentes.length, k.fuentes);
      if (k.fuentes) {
        assert.deepEqual(b.fuentes[0], { id: "doc-1", nombre: "Documento 1", enlace: "https://prueba.gov.co/doc-1.pdf", fecha: "2026-03-15" });
        assert.equal(new Set(b.fuentes.map((f: { id: string }) => f.id)).size, b.fuentes.length, "una entrada por documento citado");
      }
      if (k.auth) { assert.match(b.responseId, /^[0-9a-f-]{36}$/); responseIds.push(b.responseId); }
      else assert.ok(!("responseId" in b) && !("conversationId" in b));
      tiposVistos.add(b.tipo);
    }
    assert.deepEqual([...tiposVistos].sort(), ["aclaración", "fuera de alcance", "respondida", "sin información"]);
    assert.equal(new Set(responseIds).size, 6, "cada respuesta autorizada con su ID único");
    assert.equal(await countRows(c, "interaction"), 6);
    assert.equal(await countRows(c, "anonymous_usage"), 4);
    // Fuentes persistidas coinciden con las entregadas; en no respondidas, vacías.
    const { rows } = await c.db.migrator.query("SELECT result_type, cited_documents FROM chat.interaction ORDER BY row_id");
    for (const row of rows) {
      assert.equal((row.cited_documents as unknown[]).length, row.result_type === "respondida" ? 1 : 0, row.result_type);
    }
  });
});

test("8 éxitos autorizados: 8 registros con los 9 campos + modelo efectivo, tokens y costo (DI16)", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    queueAnswers(c, 8);
    const entregado: Array<{ responseId: string; fuentes: unknown[] }> = [];
    for (let i = 0; i < 8; i++) {
      const r = await post(c, "/chat", tk, { pregunta: `consulta registrada ${i}`, conversationId: conv, ...(i % 2 ? { categoria: "Ecosistemas" } : {}) });
      assert.equal(r.status, 200);
      entregado.push(await r.json());
    }
    const { rows } = await c.db.migrator.query("SELECT *, estimated_cost::text AS cost FROM chat.interaction ORDER BY row_id");
    assert.equal(rows.length, 8);
    rows.forEach((row, i) => {
      for (const f of CAMPOS) {
        if (f === "category") continue; // la categoría es opcional para la persona
        assert.notEqual(row[f], null, `${f} presente en el registro ${i}`);
      }
      assert.equal(row.response_id, entregado[i].responseId, "el ID entregado coincide con el registrado");
      assert.deepEqual(row.cited_documents, entregado[i].fuentes, "las fuentes registradas son las entregadas");
      assert.equal(row.model, "gpt-oss-20b");
      assert.equal(row.input_tokens, 100);
      assert.equal(row.output_tokens, 20);
      // (100×0.07 + 20×0.3) / 1e6 = 0.000013
      assert.equal(row.cost, "0.000013000000");
      assert.equal(row.category, i % 2 ? "Ecosistemas" : null);
      assert.ok(row.duration_ms >= 0 && row.visible_output_tokens > 0);
    });
  });
});

test("fallo de escritura: la respuesta sale completa sin responseId y sin retener el texto", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    queueAnswers(c, 2);
    c.failRecording.on = true;
    const r = await post(c, "/chat", tk, { pregunta: "¿Qué requisitos tiene el trámite?", conversationId: conv });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.tipo, "respondida");
    assert.ok(b.respuesta.length > 0 && b.fuentes.length === 1, "orientación completa y fuentes");
    assert.ok(!("responseId" in b), "sin ID público: no hay fila confirmada");
    assert.equal(await countRows(c, "interaction"), 0);
    // Al volver el registro, la siguiente consulta sí queda registrada y nada del texto perdido se reenvía.
    c.failRecording.on = false;
    const ok = await (await post(c, "/chat", tk, { pregunta: "segunda consulta", conversationId: conv })).json();
    assert.match(ok.responseId, /^[0-9a-f-]{36}$/);
    const filas = (await c.db.migrator.query("SELECT question_text FROM chat.interaction")).rows;
    assert.deepEqual(filas.map(f => f.question_text), ["segunda consulta"]);
  });
});

test("commit indeterminado en el servicio: respuesta sin ID y ningún reenvío", async () => {
  await withApp(async c => {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    queueAnswers(c, 1);
    // Trigger diferido que demora el COMMIT más que el presupuesto restante de la solicitud.
    await c.db.migrator.query(`CREATE FUNCTION public.demora_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(8); RETURN NEW; END $$`);
    await c.db.migrator.query("CREATE CONSTRAINT TRIGGER t_demora AFTER INSERT ON chat.interaction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.demora_commit()");
    const prev = process.env.CHAT_DEADLINE_MS;
    process.env.CHAT_DEADLINE_MS = "5000";
    try {
      const t0 = Date.now();
      const r = await post(c, "/chat", tk, { pregunta: "¿Qué requisitos tiene el trámite?", conversationId: conv });
      const elapsed = Date.now() - t0;
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.ok(!("responseId" in b), "un commit que no se confirmó a tiempo no emite ID");
      assert.ok(elapsed < 5_000, `salió dentro del plazo (${elapsed} ms)`);
    } finally { if (prev === undefined) delete process.env.CHAT_DEADLINE_MS; else process.env.CHAT_DEADLINE_MS = prev; }
  });
});

test("fecha desde la recepción: una consulta que espera en cola conserva su llegada y suma la espera", async () => {
  await withApp(async c => {
    const prev = process.env.CHAT_MAX_CONCURRENT;
    process.env.CHAT_MAX_CONCURRENT = "1";
    try {
      const tk = await sessionToken(c);
      const conv = await authorize(c, tk);
      c.delays.model = 500;
      queueAnswers(c, 2);
      const t0 = Date.now();
      const body = (q: string) => ({ pregunta: q, conversationId: conv });
      const [a, b] = await Promise.all([
        rawRequest(c, { path: "/chat", headers: { authorization: `Bearer ${tk}` }, chunks: [JSON.stringify(body("primera"))] }),
        (async () => { await new Promise(r => setTimeout(r, 50)); return rawRequest(c, { path: "/chat", headers: { authorization: `Bearer ${tk}` }, chunks: [JSON.stringify(body("segunda"))] }); })(),
      ]);
      assert.equal(a.status, 200); assert.equal(b.status, 200);
      const { rows } = await c.db.migrator.query("SELECT question_text, received_at, duration_ms FROM chat.interaction ORDER BY question_text DESC");
      const segunda = rows.find(r => r.question_text === "segunda")!;
      const lag = new Date(segunda.received_at).getTime() - t0;
      assert.ok(lag < 300, `received_at es la llegada, no la salida de la cola (${lag} ms)`);
      assert.ok(segunda.duration_ms >= 900, `la duración incluye la espera en cola (${segunda.duration_ms} ms)`);
    } finally { if (prev === undefined) delete process.env.CHAT_MAX_CONCURRENT; else process.env.CHAT_MAX_CONCURRENT = prev; }
  });
});
