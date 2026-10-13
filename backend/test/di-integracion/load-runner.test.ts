import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildSequentialPlan, percentile, runSequential, runWaves, summarize } from "../../scripts/lib/loadRunner.js";
import { classify, NetCapture } from "../../scripts/lib/netCapture.js";


import {
  auditSequential, auditWave, bogotaDay, checkSequentialAudit, checkWaveAudit, LARGA_MAX_TOKENS, LARGA_MIN_TOKENS, LARGAS,
  validateBody, type LoadItem, type Sample,
} from "../../scripts/lib/loadRunner.js";
import { startInApp } from "../in-integracion/harness.js";

/** Servicio con cuota alta: estas pruebas validan el arnés, no la cuota de 60/min (N305 la prueba). */
async function appSinCuota() {
  process.env.CHAT_RATE_LIMIT_PER_MINUTE = "100000";
  return startInApp();
}

/** Párrafo fijo con ~25 tokens para componer respuestas largas respaldadas por una cita. */
const PARRAFO = "El trámite exige radicar la solicitud con los documentos del formato oficial, esperar la revisión técnica de la dirección responsable y atender los requerimientos dentro del plazo que fija el procedimiento. ";

function respuestaLarga(): { text: string; inputTokens: number; outputTokens: number } {
  // ~1.000 tokens visibles, dentro de [700, 2200], con una sola cita y declaración de fuentes.
  const cuerpo = Array.from({ length: 30 }, (_, i) => `${PARRAFO}Paso ${i + 1}.`).join("\n\n");
  return { text: `${cuerpo} [D1]\n<!--FUENTES: D1-->`, inputTokens: 200, outputTokens: 1_000 };
}
const respuestaCorta = (i: number) => ({ text: `Respuesta documental número ${i} sobre el trámite consultado [D1].\n<!--FUENTES: D1-->`, inputTokens: 20, outputTokens: 20 });

test("plan secuencial: 100 consultas 40/30/30, 10 autorizadas con 10 pares y 10 largas en posiciones distintas", () => {
  const plan = buildSequentialPlan(100);
  assert.equal(plan.length, 100);
  assert.deepEqual([plan.filter(p => p.kind === "simple").length, plan.filter(p => p.kind === "media").length, plan.filter(p => p.kind === "compleja").length], [40, 30, 30]);
  assert.equal(plan.filter(p => p.conHistorial).length, 10);
  assert.ok(plan.filter(p => p.conHistorial).every(p => p.autorizada), "el historial solo existe en autorizadas");
  assert.equal(plan.filter(p => p.larga).length, 10);
  assert.ok(plan.filter(p => p.larga).every(p => LARGAS.includes(p.pregunta)));
  assert.equal(plan.filter(p => p.larga && p.conHistorial).length, 0, "largas e historiales en casos distintos");
  assert.equal(new Set(plan.map(p => p.id)).size, 100);
  // Los niveles no vienen agrupados: ninguna racha de 20 del mismo nivel.
  let racha = 1; let max = 1;
  for (let i = 1; i < plan.length; i++) { racha = plan[i].kind === plan[i - 1].kind ? racha + 1 : 1; max = Math.max(max, racha); }
  assert.ok(max < 10, `racha máxima ${max}`);
  assert.equal(percentile([1, 2, 3, 4, 100], 95), 100);
  assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95, "nearest-rank: ceil(0,95·100) = 95.º");
  assert.equal(percentile([], 95), 0);
});

test("la validación de 200 exige contrato: modo/IDs coherentes, tipo, fuentes y tope de tokens", () => {
  const anon: LoadItem = { id: "x", kind: "simple", pregunta: "p", autorizada: false, conHistorial: false, larga: false };
  const aut: LoadItem = { ...anon, autorizada: true };
  const ctx = { token: "t", conversationId: "11111111-1111-4111-8111-111111111111" };
  const ok = { modo: "anónima", tipo: "respondida", respuesta: "Texto [D1]", fuentes: [{ id: "a" }] };
  assert.equal(validateBody(anon, { token: "t" }, ok).ok, true);
  const motivo = (item: LoadItem, c: typeof ctx | { token: string }, b: unknown) => { const r = validateBody(item, c as never, b); return r.ok ? "ok" : r.motivo; };
  assert.equal(motivo(anon, { token: "t" }, { ...ok, respuesta: "" }), "respuesta_vacia");
  assert.equal(motivo(anon, { token: "t" }, { ...ok, tipo: "otra" }), "tipo_invalido");
  assert.equal(motivo(anon, { token: "t" }, { ...ok, fuentes: undefined }), "fuentes_invalidas");
  assert.equal(motivo(anon, { token: "t" }, { ...ok, tipo: "sin información" }), "fuentes_en_no_respondida");
  assert.match(motivo(aut, ctx, ok), /modo_anónima_esperado_conversación/);
  assert.equal(motivo(anon, { token: "t" }, { ...ok, conversationId: ctx.conversationId }), "anonima_con_id");
  assert.equal(motivo(aut, ctx, { ...ok, modo: "conversación", conversationId: "otra" }), "conversationId_distinto");
  assert.equal(motivo(aut, ctx, { ...ok, modo: "conversación", conversationId: ctx.conversationId, responseId: "r1" }), "responseId_invalido");
  assert.equal(motivo(anon, { token: "t" }, { ...ok, respuesta: "palabra ".repeat(2_500) }), "respuesta_supera_2200_tokens");
  assert.equal(motivo(anon, { token: "t" }, "no es objeto"), "cuerpo_no_json");
});

test("100 secuenciales contra el servicio real: 10 historiales efectivos y 10 largas validadas; 200 sin contrato no cuenta", async () => {
  const c = await appSinCuota();
  try {
    const larga = new Set(LARGAS);
    let n = 0;
    c.answerFor.fn = p => (larga.has(p) ? respuestaLarga() : respuestaCorta(++n));
    const target = { baseUrl: c.base, policyVersion: "2026-10", origin: "https://geobot.ejemplo.gov.co", queriesPerMinute: 100000 };
    const muestras = await runSequential(target, buildSequentialPlan(100));
    const audit = auditSequential(muestras);
    assert.deepEqual(checkSequentialAudit(audit), [], JSON.stringify(audit));
    assert.equal(audit.historiasEfectivas, 10);
    assert.equal(audit.largasValidadas, 10);
    for (const s of muestras.filter(m => m.larga)) assert.ok((s.tokens ?? 0) >= LARGA_MIN_TOKENS && (s.tokens ?? 0) <= LARGA_MAX_TOKENS, `larga con ${s.tokens} tokens`);
    const sum = summarize(muestras);
    assert.equal(sum.total, 100); assert.equal(sum.errores, 0); assert.equal(sum.superan40s, 0);
    // El servicio recibió 10 historiales de exactamente 10 pares y 10 conversaciones autorizadas registradas.
    assert.equal((await c.db.migrator.query("SELECT count(*)::int n FROM chat.interaction")).rows[0].n, 10);
    assert.equal((await c.db.migrator.query("SELECT count(*)::int n FROM chat.anonymous_usage")).rows[0].n, 90);
  } finally { await c.close(); }
});

test("3 oleadas de 25 (15 autorizadas de 5 conversaciones + 10 anónimas) con preparación fuera del cronómetro", async () => {
  const c = await appSinCuota();
  try {
    c.answerFor.fn = p => respuestaCorta(p.length);
    const pausas: number[] = [];
    const target = { baseUrl: c.base, policyVersion: "2026-10", origin: "https://geobot.ejemplo.gov.co", queriesPerMinute: 100000, sleep: async (ms: number) => { pausas.push(ms); } };
    const oleadas = await runWaves(target, 3, 25, 120_000);
    assert.equal(oleadas.length, 3);
    for (const o of oleadas) {
      const a = auditWave(o);
      assert.deepEqual(checkWaveAudit(a), [], JSON.stringify(a));
      const s = summarize(o);
      assert.equal(s.total, 25); assert.equal(s.errores, 0);
      // Cada conversación recibió 3 consultas simultáneas.
      const porConv = new Map<number, number>();
      for (const m of o.filter(x => x.grupo === "autorizada")) porConv.set(m.conversacion!, (porConv.get(m.conversacion!) ?? 0) + 1);
      assert.deepEqual([...porConv.values()].sort(), [3, 3, 3, 3, 3]);
    }
    assert.deepEqual(pausas, [120_000, 120_000], "pausa de 2 minutos entre oleadas");
    // 75 registros: 45 autorizados + 30 anónimos.
    assert.equal((await c.db.migrator.query("SELECT count(*)::int n FROM chat.interaction")).rows[0].n, 45);
    assert.equal((await c.db.migrator.query("SELECT count(*)::int n FROM chat.anonymous_usage")).rows[0].n, 30);
  } finally { await c.close(); }
});

test("el criterio rechaza un arnés defectuoso: 5 historiales efectivos, respuestas fijas, oleadas todas anónimas, 200 malformados", () => {
  // Arnés anterior: marcaba 10 historiales pero solo 5 llegaban efectivos; oleadas todas anónimas.
  const mala: Sample[] = Array.from({ length: 100 }, (_, i) => ({
    id: `S${i}`, kind: i < 40 ? "simple" : i < 70 ? "media" : "compleja", ms: 100, status: 200, ok: true, autorizada: i % 20 === 0,
    historial: i % 20 === 0 ? 10 : 0, larga: i % 10 === 5, tipo: "respondida", tokens: 50, huella: "misma", inicioMs: 0,
  }));
  const problemas = checkSequentialAudit(auditSequential(mala));
  assert.ok(problemas.some(p => /historiales efectivos/.test(p)), problemas.join("; "));
  assert.ok(problemas.some(p => /largas validadas/.test(p)));
  assert.ok(problemas.some(p => /degenerada/.test(p)));
  const olaVieja: Sample[] = Array.from({ length: 25 }, (_, i) => ({
    id: `W${i}`, kind: "simple", ms: 50, status: 200, ok: true, autorizada: false, historial: 0, larga: false, inicioMs: 0, grupo: "anonima",
  }));
  const wp = checkWaveAudit(auditWave(olaVieja));
  assert.ok(wp.some(p => /autorizadas/.test(p)) && wp.some(p => /conversaciones/.test(p)), wp.join("; "));
  assert.match(bogotaDay(new Date("2026-10-11T03:00:00Z")), /^2026-10-10$/, "fecha local de Bogotá (UTC-5)");
});

test("captura de red: clasifica Bedrock, credenciales e infraestructura, y marca lo demás como NO autorizado", async () => {
  assert.equal(classify("bedrock-runtime.us-east-1.amazonaws.com", "us-east-1"), "bedrock");
  assert.equal(classify("169.254.169.254", "us-east-1"), "credenciales");
  assert.equal(classify("sts.us-east-1.amazonaws.com", "us-east-1"), "credenciales");
  assert.equal(classify("localhost", "us-east-1"), "infraestructura");
  assert.equal(classify("qdrant", "us-east-1", ["qdrant"]), "infraestructura");
  for (const h of ["api.openai.com", "generativelanguage.googleapis.com", "api.groq.com", "api.deepseek.com", "bedrock-runtime.us-west-2.amazonaws.com"]) {
    assert.equal(classify(h, "us-east-1"), "NO_AUTORIZADO", h);
  }
  const srv = http.createServer((_q, r) => r.end("ok")).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => srv.once("listening", resolve));
  const cap = new NetCapture(); cap.start();
  try {
    await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/`).then(r => r.text());
  } finally { cap.stop(); srv.close(); }
  const d = cap.destinations("us-east-1");
  assert.ok(d.some(x => x.host === "127.0.0.1" && x.clase === "infraestructura"));
  assert.ok(!JSON.stringify(d).includes("ok"), "solo host y puerto, nunca contenido");
});
