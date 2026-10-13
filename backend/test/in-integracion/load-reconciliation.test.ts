/**
 * T064 — Conciliación de registros de carga (N303, RF-C3-IN-05/07): 75 registros por día (45 + 30),
 * autorizados por identificador, anónimos por multiconjunto sin añadir ningún identificador.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { conciliar } from "../../scripts/lib/loadReconciliation.js";
import { runWaves } from "../../scripts/lib/loadRunner.js";
import { startInApp } from "./harness.js";

async function corrida() {
  process.env.CHAT_RATE_LIMIT_PER_MINUTE = "100000";
  const c = await startInApp();
  c.answerFor.fn = p => ({ text: `Respuesta documental ${p.length} [D1].\n<!--FUENTES: D1-->`, inputTokens: 30, outputTokens: 20 });
  const target = { baseUrl: c.base, policyVersion: "2026-10", origin: "https://geobot.ejemplo.gov.co", queriesPerMinute: 100000, sleep: async () => {} };
  const muestras = (await runWaves(target, 3, 25, 0)).flat();
  return { c, muestras };
}

test("un día de oleadas: 75 registros = 45 autorizados por ID + 30 anónimos por multiconjunto; conforme", async () => {
  const { c, muestras } = await corrida();
  try {
    assert.equal(muestras.length, 75);
    const r = await conciliar(c.db.migrator, muestras, { esperadosAutorizados: 45, esperadosAnonimos: 30 });
    assert.deepEqual(r.problemas, []);
    assert.equal(r.estado, "conforme");
    assert.deepEqual(r.autorizados, { esperados: 45, encontrados: 45, faltantes: 0, incoherentes: 0, duplicados: 0 });
    assert.deepEqual(r.anonimos, { esperados: 30, emparejados: 30, sinMuestra: 0, faltantes: 0, incompletos: 0 });
    assert.deepEqual(r.columnasAnonimas, ["estimated_cost", "input_tokens", "mode", "model", "output_tokens", "received_at"],
      "no se añadió traceId, hash ni IP a la tabla anónima");
  } finally { await c.close(); }
});

test("fallos detectados: registro autorizado faltante, anónimo faltante y fila ajena (pendiente, no conforme)", async () => {
  const { c, muestras } = await corrida();
  try {
    // Falta un autorizado y un anónimo.
    await c.db.migrator.query("DELETE FROM chat.interaction WHERE row_id = (SELECT min(row_id) FROM chat.interaction)");
    await c.db.migrator.query("DELETE FROM chat.anonymous_usage WHERE ctid = (SELECT ctid FROM chat.anonymous_usage LIMIT 1)");
    const r = await conciliar(c.db.migrator, muestras, { esperadosAutorizados: 45, esperadosAnonimos: 30 });
    assert.equal(r.estado, "fallo");
    assert.equal(r.autorizados.faltantes, 1);
    assert.equal(r.anonimos.faltantes, 1);
  } finally { await c.close(); }

  const otra = await corrida();
  try {
    // Tráfico ajeno dentro de la ventana: el conteo global ya no es evidencia → pendiente.
    const t = new Date(otra.muestras[0].inicioMs + 50);
    await otra.c.db.migrator.query("INSERT INTO chat.anonymous_usage (received_at, model, input_tokens, output_tokens, estimated_cost) VALUES ($1,'gpt-oss-20b',1,1,0)", [t]);
    const r = await conciliar(otra.c.db.migrator, otra.muestras, { esperadosAutorizados: 45, esperadosAnonimos: 30 });
    assert.equal(r.estado, "pendiente_trafico_ajeno");
    assert.equal(r.anonimos.sinMuestra, 1);
  } finally { await otra.c.close(); }
});
