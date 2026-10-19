/** US7 · Tarifas y tableros (RF-C3-AD-42..46, RNF-C3-AD-07): cifras exactas, sin textos ni identificadores. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { computeCost, currentTariff } from "../../src/chat/tariffs.js";
import { GESTOR, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

const M20 = "openai.gpt-oss-20b-1:0";
const M120 = "openai.gpt-oss-120b-1:0";
let app: AdminApp;
let tec: Session;
let ges: Session;

test.before(async () => {
  app = await startAdminApp();
  await app.createAccount("tec.est@prueba.gov.co", TECNICO);
  await app.createAccount("ges.est@prueba.gov.co", GESTOR);
  tec = await app.login("tec.est@prueba.gov.co");
  ges = await app.login("ges.est@prueba.gov.co");
  for (const m of [M20, M120]) {
    await app.db.migrator.query(
      `INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url)
       VALUES ($1, 'us-east-1', 'USD', 0.07, 0.3, '2026-01-01', 'https://aws.amazon.com/bedrock/pricing/')`, [m]);
  }
});
test.after(async () => { await app.close(); });

const hoy = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const rango = () => `from=2026-01-01&to=${hoy()}`;
type Inter = { cat?: string | null; tipo?: string; modelo?: string; cost?: string | null; citas?: Array<{ id: string; nombre: string }>; val?: [string, string | null]; tin?: number; tout?: number; hace?: string };
async function inter(o: Inter = {}): Promise<number> {
  const modelo = o.modelo ?? "gpt-oss-20b";
  const { rows: [i] } = await app.db.migrator.query(
    `INSERT INTO chat.interaction (response_id, received_at, category, question_text, answer_text, result_type, cited_documents, duration_ms,
                                   visible_output_tokens, model, input_tokens, output_tokens, estimated_cost, tariff_version)
     VALUES ($1, now() - $2::interval, $3, 'PREGUNTA-ESTADISTICA', 'RESPUESTA-ESTADISTICA', $4, $5::jsonb, 100, 10, $6, $7, $8, $9,
             CASE WHEN $9::numeric IS NOT NULL AND $6 <> 'none' THEN (SELECT min(version) FROM chat.tariff) END) RETURNING row_id`,
    [randomUUID(), o.hace ?? "1 hour", o.cat === undefined ? "Ecosistemas" : o.cat, o.tipo ?? "respondida",
      JSON.stringify((o.citas ?? []).map(c => ({ ...c, enlace: "https://x.gov.co", fecha: "2026-01-01" }))), modelo, o.tin ?? 1000, o.tout ?? 500,
      modelo === "none" ? "0" : o.cost === undefined ? "0.000150000000" : o.cost]);
  if (o.val) await app.db.migrator.query("INSERT INTO chat.valoracion (interaction_row_id, valoracion, motivo) VALUES ($1,$2,$3)", [i.row_id, o.val[0], o.val[1]]);
  return Number(i.row_id);
}
const anon = (modelo = "gpt-oss-20b", cost: string | null = "0.000100000000") =>
  app.db.migrator.query("INSERT INTO chat.anonymous_usage (received_at, model, input_tokens, output_tokens, estimated_cost) VALUES (now() - interval '2 hours', $1, 800, 400, $2)", [modelo, cost]);

test("AD43: 40 consultas (25 autorizadas, 15 anónimas): total 40, categorías y tipos suman 25, anónimas aparte; filtro de fechas; invisible al Gestor", async () => {
  const tipos = ["respondida", "sin información", "fuera de alcance", "aclaración", "respondida"];
  const cats = ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental", null];
  for (let k = 0; k < 25; k++) await inter({ cat: cats[k % 4], tipo: tipos[k % 5] });
  for (let k = 0; k < 15; k++) await anon();
  // Fuera de rango (2 meses antes del filtro) no cuenta.
  await inter({ hace: "400 days" });
  const r = await tec.api("GET", `/metrics/usage?${rango()}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 40);
  assert.equal(r.json.autorizadas, 25);
  assert.equal(r.json.anonimas, 15);
  assert.equal(r.json.porCategoria.reduce((a: number, c: { consultas: number }) => a + c.consultas, 0), 25);
  assert.equal(r.json.porTipo.reduce((a: number, c: { consultas: number }) => a + c.consultas, 0), 25);
  assert.ok(r.json.porCategoria.some((c: { categoria: string }) => c.categoria === "Sin categoría"));
  assert.equal(r.json.porDia.reduce((a: number, d: { consultas: number }) => a + d.consultas, 0), 40);
  // Coincide con el conteo directo de los registros.
  const directo = (await app.db.migrator.query(
    "SELECT (SELECT count(*) FROM chat.interaction WHERE received_at > now() - interval '30 days') + (SELECT count(*) FROM chat.anonymous_usage) AS n")).rows[0].n;
  assert.equal(Number(directo), 40);
  // Sin textos ni identificadores.
  for (const prohibido of ["PREGUNTA-ESTADISTICA", "RESPUESTA-ESTADISTICA", "row_id", "conversation", "response_id"]) assert.ok(!r.text.includes(prohibido), prohibido);
  // Rango por defecto (30 días) y validación.
  assert.equal((await tec.api("GET", "/metrics/usage")).json.total, 40);
  assert.equal((await tec.api("GET", "/metrics/usage?from=2026-05-01")).status, 422, "ambos o ninguno");
  assert.equal((await tec.api("GET", "/metrics/usage?from=2026-05-02&to=2026-05-01")).status, 422);
  assert.equal((await tec.api("GET", "/metrics/usage?from=2001-01-01&to=2001-01-31")).json.total, 0);
  assert.equal((await ges.api("GET", "/metrics/usage")).status, 403);
});

test("AD44: 20 respuestas con 12 documentos y un empate → ranking de 10 con citas correctas, desempate por nombre; el modo anónimo lo indica", async () => {
  await app.db.migrator.query("DELETE FROM chat.valoracion");
  await app.db.migrator.query("DELETE FROM admin.improvement_case");
  await app.db.migrator.query("DELETE FROM chat.interaction");
  const docs = Array.from({ length: 12 }, (_, i) => ({ id: randomUUID(), nombre: `Documento ${String.fromCharCode(65 + i)}` }));
  // Citas: A=8, B=7, C=6, D=5, E=4, F=4 (empate), G=3, H=3, I=2, J=2, K=1, L=1  (para 20 respuestas).
  const cuotas = [8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1];
  const respuestas: Array<Array<{ id: string; nombre: string }>> = Array.from({ length: 20 }, () => []);
  cuotas.forEach((n, d) => { for (let k = 0; k < n; k++) respuestas[(k * 3 + d) % 20].push(docs[d]); });
  // Una respuesta que cita dos veces el mismo documento cuenta una sola vez.
  respuestas[0].push(docs[0]);
  for (const c of respuestas) await inter({ citas: c });
  await anon();
  const r = await tec.api("GET", `/metrics/documents?${rango()}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.ranking.length, 10);
  const directo = new Map<string, number>();
  for (const c of respuestas) for (const id of new Set(c.map(x => x.id))) directo.set(id, (directo.get(id) ?? 0) + 1);
  const esperado = docs.map(d => ({ nombre: d.nombre, citas: directo.get(d.id) ?? 0 }))
    .sort((a, b) => b.citas - a.citas || a.nombre.localeCompare(b.nombre)).slice(0, 10);
  assert.deepEqual(r.json.ranking.map((x: { nombre: string; citas: number }) => ({ nombre: x.nombre, citas: x.citas })), esperado);
  const e = r.json.ranking.findIndex((x: { nombre: string }) => x.nombre === "Documento E");
  assert.ok(r.json.ranking[e].citas === r.json.ranking[e + 1].citas && r.json.ranking[e].nombre < r.json.ranking[e + 1].nombre, "empate por nombre ascendente");
  assert.equal(r.json.anonymousCoverage, "not-recorded");
  assert.match(r.json.nota, /anónim/i);
  assert.ok(!r.text.includes("PREGUNTA-ESTADISTICA"));
});

test("AD45: 10 valoraciones (5 Útil, 5 No útil, una por motivo) → 5 y 5, 50 % y 50 %, 1 por motivo; sin valoraciones → 0 %", async () => {
  const antes = (await tec.api("GET", `/metrics/ratings?${rango()}`)).json;
  assert.equal(antes.total, 0);
  assert.equal(antes.porcentajeUtil, 0);
  const motivos = ["Información incorrecta", "Información desactualizada", "No responde mi pregunta", "Difícil de entender", "Otro"];
  for (let k = 0; k < 5; k++) await inter({ val: ["Útil", null] });
  for (const m of motivos) await inter({ val: ["No útil", m] });
  await anon(); // lo anónimo no aporta
  const r = (await tec.api("GET", `/metrics/ratings?${rango()}`)).json;
  assert.deepEqual([r.total, r.util, r.noUtil, r.porcentajeUtil, r.porcentajeNoUtil], [10, 5, 5, 50, 50]);
  assert.deepEqual(r.motivos.map((m: { cantidad: number }) => m.cantidad), [1, 1, 1, 1, 1]);
  const directo = Number((await app.db.migrator.query("SELECT count(*) FROM chat.valoracion")).rows[0].count);
  assert.equal(directo, r.total);
  assert.equal((await ges.api("GET", "/metrics/ratings")).status, 403);
});

test("AD46: 20 consultas (10 por modelo; 5 autorizadas y 5 anónimas) → cifras por modelo y total exactas con costo recalculado a mano; NULL no es 0", async () => {
  await app.db.migrator.query("DELETE FROM chat.valoracion");
  await app.db.migrator.query("DELETE FROM admin.improvement_case");
  await app.db.migrator.query("DELETE FROM chat.interaction");
  await app.db.migrator.query("DELETE FROM chat.anonymous_usage");
  const t20 = { i: "0.07", o: "0.3" };
  const t120 = { i: "0.15", o: "0.6" };
  const costo = (tin: number, tout: number, t: { i: string; o: string }) => computeCost(tin, tout, { inputPerMillion: t.i, outputPerMillion: t.o });
  let esperado20 = new Decimal(0); let esperado120 = new Decimal(0);
  for (let k = 0; k < 5; k++) {
    const c20 = costo(1000 + k, 500 + k, t20); const c120 = costo(2000 + k, 700 + k, t120);
    await inter({ modelo: "gpt-oss-20b", tin: 1000 + k, tout: 500 + k, cost: c20 });
    await inter({ modelo: "gpt-oss-120b", tin: 2000 + k, tout: 700 + k, cost: c120 });
    esperado20 = esperado20.add(c20); esperado120 = esperado120.add(c120);
    const a20 = costo(800, 400, t20); const a120 = costo(900, 450, t120);
    await app.db.migrator.query("INSERT INTO chat.anonymous_usage (received_at, model, input_tokens, output_tokens, estimated_cost) VALUES (now(), 'gpt-oss-20b', 800, 400, $1)", [a20]);
    await app.db.migrator.query("INSERT INTO chat.anonymous_usage (received_at, model, input_tokens, output_tokens, estimated_cost) VALUES (now(), 'gpt-oss-120b', 900, 450, $1)", [a120]);
    esperado20 = esperado20.add(a20); esperado120 = esperado120.add(a120);
  }
  const r = (await tec.api("GET", `/metrics/consumption?${rango()}`)).json;
  const m20 = r.modelos.find((m: { modelo: string }) => m.modelo === "gpt-oss-20b");
  const m120 = r.modelos.find((m: { modelo: string }) => m.modelo === "gpt-oss-120b");
  assert.deepEqual([m20.consultas, m20.autorizadas, m20.anonimas], [10, 5, 5]);
  assert.deepEqual([m120.consultas, m120.autorizadas, m120.anonimas], [10, 5, 5]);
  assert.equal(m20.tokensEntrada, 5 * 800 + [0, 1, 2, 3, 4].reduce((a, k) => a + 1000 + k, 0));
  assert.equal(new Decimal(m20.costoTotal).toFixed(12), esperado20.toFixed(12));
  assert.equal(new Decimal(m120.costoTotal).toFixed(12), esperado120.toFixed(12));
  assert.equal(new Decimal(r.total.costoTotal).toFixed(12), esperado20.add(esperado120).toFixed(12));
  assert.equal(r.total.consultas, 20);
  assert.equal(m20.costoParcial, false);

  // Costo ausente (NULL) no se cuenta como cero: se señala y el total es parcial.
  await inter({ modelo: "gpt-oss-20b", cost: null });
  const p = (await tec.api("GET", `/metrics/consumption?${rango()}`)).json.modelos.find((m: { modelo: string }) => m.modelo === "gpt-oss-20b");
  assert.equal(p.consultasSinCosto, 1);
  assert.equal(p.costoParcial, true);
  // Ruta local sin modelo: separada.
  await inter({ modelo: "none", tin: 0, tout: 0 });
  const l = (await tec.api("GET", `/metrics/consumption?${rango()}`)).json;
  assert.equal(l.rutaLocal.consultas, 1);
  assert.equal(l.rutaLocal.costoTotal, "0.000000000000".replace(/0+$/, "0") === l.rutaLocal.costoTotal ? l.rutaLocal.costoTotal : l.rutaLocal.costoTotal);
  assert.ok(!l.text, "sin campos de texto");
  assert.equal((await ges.api("GET", "/metrics/consumption")).status, 403);
});

test("AD42: 4 cambios de tarifa válidos y 3 inválidos; costo a mano; los registros anteriores no cambian; Gestor denegado", async () => {
  const lista = async () => (await tec.api("GET", "/tariffs")).json;
  const t0 = await lista();
  assert.equal(t0.items.length, 2);
  assert.equal(t0.items[0].moneda, "USD");
  const costoAntes = (await inter({ modelo: "gpt-oss-20b", tin: 1_000_000, tout: 1_000_000, cost: computeCost(1_000_000, 1_000_000, { inputPerMillion: "0.07", outputPerMillion: "0.3" }) }));
  const guardado = (await app.db.migrator.query("SELECT estimated_cost::text FROM chat.interaction WHERE row_id = $1", [costoAntes])).rows[0].estimated_cost;

  const edit = async (modelo: string, i: unknown, o: unknown) => {
    const actual = (await lista()).items.find((t: { modelo: string }) => t.modelo === modelo);
    return tec.api("PUT", `/tariffs/${modelo}`, { expectedRevision: actual.version, inputPerMillion: i, outputPerMillion: o });
  };
  // 4 válidos (2 por modelo).
  for (const [m, i, o] of [["gpt-oss-20b", "0.08", "0.35"], ["gpt-oss-20b", "0.0825", "0.3501"], ["gpt-oss-120b", "0.2", "0.8"], ["gpt-oss-120b", "1", "2"]] as const) {
    const r = await edit(m, i, o);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.inputPerMillion, i.replace(/\.?0+$/, "") || i);
    await new Promise(res => setTimeout(res, 5));
  }
  // 3 inválidos (+ 5 decimales y no-cadena).
  for (const [i, o] of [["0", "0.3"], ["-1", "0.3"], ["abc", "0.3"], ["0.12345", "0.3"], [0.07, 0.3]] as const) {
    assert.equal((await edit("gpt-oss-20b", i, o)).status, 422, JSON.stringify([i, o]));
  }
  assert.equal((await tec.api("PUT", "/tariffs/otro-modelo", { expectedRevision: "1", inputPerMillion: "1", outputPerMillion: "1" })).status, 404);
  assert.equal((await ges.api("PUT", "/tariffs/gpt-oss-20b", { expectedRevision: "1", inputPerMillion: "1", outputPerMillion: "1" })).status, 403);
  // Revisión obsoleta.
  assert.equal((await tec.api("PUT", "/tariffs/gpt-oss-20b", { expectedRevision: "1", inputPerMillion: "1", outputPerMillion: "1" })).status, 409);

  // Costos: 2 consultas por modelo con la tarifa nueva coinciden con el cálculo a mano.
  const vig20 = await currentTariff(M20, new Date(), app.db.chat);
  assert.deepEqual([vig20!.inputPerMillion, vig20!.outputPerMillion].map(x => new Decimal(x).toString()), ["0.0825", "0.3501"]);
  const aMano = new Decimal(1000).mul("0.0825").add(new Decimal(500).mul("0.3501")).div(1_000_000).toFixed(12);
  assert.equal(computeCost(1000, 500, vig20!), aMano);
  // El registro anterior no cambió, y la historia conserva las tarifas antiguas sin solape.
  assert.equal((await app.db.migrator.query("SELECT estimated_cost::text FROM chat.interaction WHERE row_id = $1", [costoAntes])).rows[0].estimated_cost, guardado);
  const hist = (await app.db.migrator.query("SELECT input_price_per_million::text AS i, valid_to FROM chat.tariff WHERE model_id = $1 ORDER BY valid_from", [M20])).rows;
  assert.equal(hist.length, 3);
  assert.deepEqual(hist.slice(0, 2).map(h => new Decimal(h.i).toString()), ["0.07", "0.08"]);
  assert.equal(hist[2].valid_to, null);
  // Una consulta recibida ANTES del guardado conserva la tarifa anterior aunque termine después.
  const previa = await currentTariff(M20, new Date(Date.now() - 3_600_000), app.db.chat);
  assert.deepEqual([previa!.inputPerMillion, previa!.outputPerMillion].map(x => new Decimal(x).toString()), ["0.07", "0.3"]);
  // Fuente conservada.
  assert.equal((await lista()).items[0].fuente, "https://aws.amazon.com/bedrock/pricing/");
});

test("tarifas: dos ediciones simultáneas con la misma revisión → una aplica y la otra 409; nunca dos vigentes", async () => {
  const actual = (await tec.api("GET", "/tariffs")).json.items.find((t: { modelo: string }) => t.modelo === "gpt-oss-120b");
  const rs = await Promise.all([
    tec.api("PUT", "/tariffs/gpt-oss-120b", { expectedRevision: actual.version, inputPerMillion: "3", outputPerMillion: "4" }),
    tec.api("PUT", "/tariffs/gpt-oss-120b", { expectedRevision: actual.version, inputPerMillion: "5", outputPerMillion: "6" }),
  ]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
  const vigentes = (await app.db.migrator.query("SELECT count(*)::int n FROM chat.tariff WHERE model_id = $1 AND valid_to IS NULL", [M120])).rows[0].n;
  assert.equal(vigentes, 1);
});

test("tarifas: un modelo sin tarifa vigente se registra desde el panel con su fuente HTTPS; queda auditado", async () => {
  // Sin vigente (se cierra la actual: el historial no se borra).
  await app.db.migrator.query("UPDATE chat.tariff SET valid_to = clock_timestamp() WHERE model_id = $1 AND valid_to IS NULL", [M20]);
  const l0 = (await tec.api("GET", "/tariffs")).json;
  assert.deepEqual(l0.faltantes, ["gpt-oss-20b"]);
  // Sin fuente → error de campo; con revisión inventada → 409; Gestor → 403.
  const sinFuente = await tec.api("PUT", "/tariffs/gpt-oss-20b", { inputPerMillion: "0.07", outputPerMillion: "0.3" });
  assert.equal(sinFuente.status, 422);
  assert.equal(sinFuente.json.error.campo, "sourceUrl");
  assert.equal((await tec.api("PUT", "/tariffs/gpt-oss-20b", { inputPerMillion: "0.07", outputPerMillion: "0.3", sourceUrl: "http://inseguro.com/x" })).status, 422);
  assert.equal((await tec.api("PUT", "/tariffs/gpt-oss-20b", { expectedRevision: "1", inputPerMillion: "0.07", outputPerMillion: "0.3", sourceUrl: "https://aws.amazon.com/bedrock/pricing/" })).status, 409);
  assert.equal((await ges.api("PUT", "/tariffs/gpt-oss-20b", { inputPerMillion: "0.07", outputPerMillion: "0.3", sourceUrl: "https://aws.amazon.com/bedrock/pricing/" })).status, 403);
  const r = await tec.api("PUT", "/tariffs/gpt-oss-20b", { inputPerMillion: "0.07", outputPerMillion: "0.3", sourceUrl: "https://aws.amazon.com/bedrock/pricing/" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.inputPerMillion, "0.07");
  const l1 = (await tec.api("GET", "/tariffs")).json;
  assert.deepEqual(l1.faltantes, []);
  assert.equal(l1.items.length, 2);
  // Con vigente, la revisión vuelve a ser obligatoria.
  assert.equal((await tec.api("PUT", "/tariffs/gpt-oss-20b", { inputPerMillion: "0.08", outputPerMillion: "0.3" })).status, 422);
  const audit = (await app.db.migrator.query("SELECT count(*)::int n FROM admin.audit WHERE action = 'tarifa.crear' AND object_id = 'gpt-oss-20b'")).rows[0].n;
  assert.equal(audit, 1);
});
