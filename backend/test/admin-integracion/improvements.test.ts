/** US6 · Casos de mejora (RF-C4-AD-03..05): creación única, estados estrictos, evidencia verificable y retención. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GESTOR, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

let app: AdminApp;
let tec: Session;
let ges: Session;

test.before(async () => {
  app = await startAdminApp();
  await app.createAccount("tec.mej@prueba.gov.co", TECNICO, { name: "Técnico Mejoras" });
  await app.createAccount("ges.mej@prueba.gov.co", GESTOR);
  tec = await app.login("tec.mej@prueba.gov.co");
  ges = await app.login("ges.mej@prueba.gov.co");
});
test.after(async () => { await app.close(); });

async function interaccion(tipo: string, over: { cat?: string; pregunta?: string; hace?: string; val?: [string, string | null] } = {}): Promise<number> {
  const { rows: [i] } = await app.db.migrator.query(
    `INSERT INTO chat.interaction (response_id, received_at, category, question_text, answer_text, result_type, duration_ms, visible_output_tokens,
                                   model, input_tokens, output_tokens)
     VALUES ($1, now() - $2::interval, $3, $4, 'respuesta', $5, 100, 10, 'gpt-oss-20b', 1, 1) RETURNING row_id`,
    [randomUUID(), over.hace ?? "1 hour", over.cat ?? "Ecosistemas", over.pregunta ?? "Pregunta de prueba", tipo]);
  if (over.val) await app.db.migrator.query("INSERT INTO chat.valoracion (interaction_row_id, valoracion, motivo) VALUES ($1,$2,$3)", [i.row_id, over.val[0], over.val[1]]);
  return Number(i.row_id);
}
const casos = async (q = "") => (await tec.api("GET", `/improvements?limit=100${q}`)).json;
const caso = (id: number) => app.db.migrator.query("SELECT * FROM admin.improvement_case WHERE interaction_row_id = $1", [id]).then(r => r.rows[0]);

test("AD-C4-03: 8 interacciones → 5 casos (uno con dos orígenes), 0 de las respondidas y de la anónima; sin copia del texto", async () => {
  const antes = Number((await app.db.migrator.query("SELECT count(*) FROM admin.improvement_case")).rows[0].count);
  const a = await interaccion("sin información");
  const b = await interaccion("sin información");
  const c = await interaccion("respondida", { val: ["No útil", "Información incorrecta"] });
  const d = await interaccion("respondida", { val: ["No útil", "Difícil de entender"] });
  const ambas = await interaccion("sin información", { val: ["No útil", "No responde mi pregunta"] });
  const r1 = await interaccion("respondida", { val: ["Útil", null] });
  const r2 = await interaccion("respondida");
  await app.db.migrator.query("INSERT INTO chat.anonymous_usage (received_at, model, input_tokens, output_tokens, estimated_cost) VALUES (now(), 'gpt-oss-20b', 1, 1, 0.1)");
  const despues = Number((await app.db.migrator.query("SELECT count(*) FROM admin.improvement_case")).rows[0].count);
  assert.equal(despues - antes, 5);
  for (const id of [a, b, c, d, ambas]) assert.equal((await caso(id)).status, "Registrada");
  for (const id of [r1, r2]) assert.equal(await caso(id), undefined);
  assert.deepEqual((await caso(ambas)).origins, ["No útil", "sin información"]);
  assert.deepEqual((await caso(c)).origins, ["No útil"]);
  // Ningún texto copiado: el caso no tiene columnas de pregunta/respuesta/motivo.
  const cols = (await app.db.migrator.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'admin' AND table_name = 'improvement_case'")).rows.map(r => r.column_name);
  assert.ok(!cols.some(x => /question|answer|pregunta|respuesta|motivo|text/i.test(x)), cols.join(","));
  // El listado muestra categoría y motivo por JOIN.
  const det = (await tec.api("GET", `/improvements/${(await caso(c)).id}`)).json;
  assert.equal(det.motivoValoracion, "Información incorrecta");
  assert.equal(det.pregunta, "Pregunta de prueba");
  // Respaldo idempotente: volver a ejecutar no duplica ni cambia fechas.
  const fecha = (await caso(a)).created_at;
  await app.db.migrator.query(`INSERT INTO admin.improvement_case (interaction_row_id, origins, created_at)
    SELECT i.row_id, ARRAY[i.result_type], i.received_at FROM chat.interaction i WHERE i.result_type = 'sin información' ON CONFLICT (interaction_row_id) DO NOTHING`);
  assert.equal(Number((await app.db.migrator.query("SELECT count(*) FROM admin.improvement_case")).rows[0].count), despues);
  assert.equal(String((await caso(a)).created_at), String(fecha));
});

test("concurrencia: «sin información» y «No útil» de la misma interacción fusionan sus orígenes en un solo caso", async () => {
  const id = await interaccion("sin información");
  const mas = await Promise.all(Array.from({ length: 5 }, async () => {
    const c = await app.db.migrator.connect();
    try { await c.query("INSERT INTO admin.improvement_case (interaction_row_id, origins, created_at) VALUES ($1, ARRAY['No útil'], now()) ON CONFLICT (interaction_row_id) DO UPDATE SET origins = (SELECT array_agg(DISTINCT o ORDER BY o) FROM unnest(admin.improvement_case.origins || EXCLUDED.origins) o)", [id]); return "ok"; }
    finally { c.release(); }
  }));
  assert.deepEqual(mas, Array(5).fill("ok"));
  const filas = await app.db.migrator.query("SELECT origins FROM admin.improvement_case WHERE interaction_row_id = $1", [id]);
  assert.equal(filas.rowCount, 1);
  assert.deepEqual(filas.rows[0].origins, ["No útil", "sin información"]);
});

test("AD-C4-04: 3 casos recorren los 6 estados con usuario y fecha; 6 intentos inválidos se rechazan sin cambios", async () => {
  const idx = await tmpIndice([]);
  const ids = [await interaccion("sin información"), await interaccion("sin información"), await interaccion("sin información")];
  const cs = await Promise.all(ids.map(caso));
  const orden: Array<[string, Record<string, unknown>]> = [
    ["En análisis", {}], ["En ajuste", { failureType: "Datos" }], ["Ajustada", {}],
    ["Validada", { evidenceRefs: [] }], ["Cerrada", { note: "Documento corregido y validado" }],
  ];
  // Evidencia verificable generada a partir del índice (posterior al ajuste).
  for (const [n, c] of cs.entries()) {
    let det = (await tec.api("GET", `/improvements/${c.id}`)).json;
    for (const [estado, extra] of orden) {
      const cuerpo: Record<string, unknown> = { expectedRevision: det.revision, to: estado, ...extra };
      if (estado === "Validada") {
        const run = { runId: `run-${n}-${randomUUID().slice(0, 6)}`, sha256: "a".repeat(64), releaseId: "rel-1" };
        await indexar(idx, { ...run, finishedAt: new Date(app.clock.t + 60_000).toISOString(), status: "complete" });
        cuerpo.evidenceRefs = [run];
      }
      const r = await tec.api("POST", `/improvements/${c.id}/transitions`, cuerpo);
      assert.equal(r.status, 200, `${estado}: ${r.text}`);
      det = r.json;
      assert.equal(det.estado, estado);
    }
    assert.equal(det.historial.length, 5);
    for (const h of det.historial) assert.ok(h.usuarioId && h.fecha, "usuario y fecha en cada cambio");
    assert.equal(det.tipoFallo, "Datos");
  }
  // 6 intentos inválidos sobre un caso nuevo.
  const nuevo = await caso(await interaccion("sin información"));
  const pasar = (to: string, extra: Record<string, unknown> = {}, rev = String(nuevo.revision), s = tec) =>
    s.api("POST", `/improvements/${nuevo.id}/transitions`, { expectedRevision: rev, to, ...extra });
  assert.equal((await pasar("En ajuste")).status, 409, "saltar de estado");
  assert.equal((await pasar("Registrada")).status, 409, "no repite ni retrocede");
  assert.equal((await pasar("Cerrada", { note: "x" })).status, 409, "no salta a Cerrada");
  assert.equal((await pasar("En análisis", {}, "999")).status, 409, "revisión obsoleta");
  assert.equal((await pasar("En análisis", {}, String(nuevo.revision), ges)).status, 403, "Gestor denegado");
  assert.equal((await ges.api("GET", "/improvements")).status, 403);
  assert.equal((await caso(Number(nuevo.interaction_row_id))).status, "Registrada");
  const ok = await pasar("En análisis");
  assert.equal(ok.status, 200);
  // En ajuste sin tipo de fallo y cierre sin nota.
  assert.equal((await pasar("En ajuste", {}, String(ok.json.revision))).status, 422);
  const aj = await pasar("En ajuste", { failureType: "Recuperación" }, String(ok.json.revision));
  assert.equal(aj.status, 200);
  const ajd = await pasar("Ajustada", {}, String(aj.json.revision));
  assert.equal((await pasar("Validada", {}, String(ajd.json.revision))).status, 422, "la validación exige evidencia");
});

test("evidencia: sin índice, huella ajena o corrida anterior al ajuste se rechazan; el cierre exige nota y no cierra hallazgos", async () => {
  const c = await caso(await interaccion("sin información"));
  let rev = String(c.revision);
  const pasar = async (to: string, extra: Record<string, unknown> = {}) => {
    const r = await tec.api("POST", `/improvements/${c.id}/transitions`, { expectedRevision: rev, to, ...extra });
    if (r.status === 200) rev = r.json.revision;
    return r;
  };
  assert.equal((await pasar("En análisis", { findingRef: "VA-HALLAZGO-12" })).status, 200);
  assert.equal((await pasar("En ajuste", { failureType: "Modelo" })).status, 200);
  assert.equal((await pasar("Ajustada")).status, 200);
  const ref = { runId: "run-evidencia-1", sha256: "b".repeat(64), releaseId: "rel-9" };
  // Sin índice configurado.
  const previo = process.env.VALIDATION_EVIDENCE_INDEX;
  delete process.env.VALIDATION_EVIDENCE_INDEX;
  const sinIndice = await pasar("Validada", { evidenceRefs: [ref] });
  assert.equal(sinIndice.status, 422);
  assert.equal(sinIndice.json.error.campo, "evidenceRefs");
  const idx = await tmpIndice([]);
  process.env.VALIDATION_EVIDENCE_INDEX = idx;
  try {
    assert.equal((await pasar("Validada", { evidenceRefs: [ref] })).status, 422, "no está en el índice");
    await indexar(idx, { ...ref, sha256: "c".repeat(64), finishedAt: new Date(app.clock.t + 1000).toISOString(), status: "complete" });
    assert.equal((await pasar("Validada", { evidenceRefs: [ref] })).status, 422, "huella distinta");
    await indexar(idx, { ...ref, finishedAt: "2020-01-01T00:00:00Z", status: "complete" });
    assert.equal((await pasar("Validada", { evidenceRefs: [ref] })).status, 422, "anterior al ajuste");
    await indexar(idx, { ...ref, finishedAt: new Date(app.clock.t + 5000).toISOString(), status: "complete" });
    assert.equal((await pasar("Validada", { evidenceRefs: [{ ...ref, path: "/etc/passwd" }] })).status, 422, "no acepta rutas");
    assert.equal((await pasar("Validada", { evidenceRefs: [ref] })).status, 200);
    assert.equal((await pasar("Cerrada")).status, 422, "el cierre exige nota");
    const cerrado = await pasar("Cerrada", { note: "Contacté a la persona con cédula 1234567890 sin problema" });
    assert.equal(cerrado.status, 200);
    assert.ok(!JSON.stringify(cerrado.json.historial).includes("1234567890"), "la nota se sanea de datos personales");
    assert.equal(cerrado.json.hallazgoRef, "VA-HALLAZGO-12", "solo se relaciona: no se cierra el hallazgo");
  } finally { if (previo === undefined) delete process.env.VALIDATION_EVIDENCE_INDEX; else process.env.VALIDATION_EVIDENCE_INDEX = previo; }
});

test("AD-C4-05: 6 casos (2 cerrados, uno de 45 días): lista con 6, 3 filtros, contador 4 → 3 al cerrar uno; sin texto depurado", async () => {
  // Limpieza de pruebas: el superusuario desactiva un instante el disparador de solo anexado.
  await app.db.migrator.query("ALTER TABLE admin.improvement_transition DISABLE TRIGGER improvement_transition_append_only");
  await app.db.migrator.query("DELETE FROM admin.improvement_transition");
  await app.db.migrator.query("ALTER TABLE admin.improvement_transition ENABLE TRIGGER improvement_transition_append_only");
  await app.db.migrator.query("DELETE FROM admin.improvement_case");
  const sembrados: string[] = [];
  for (let k = 0; k < 6; k++) {
    const id = await interaccion("sin información", { cat: k % 2 ? "Bienestar Animal" : "Ecosistemas", hace: k === 5 ? "45 days" : "1 hour", pregunta: `PREGUNTA-SECRETA-${k}` });
    sembrados.push((await caso(id)).id);
  }
  await app.db.migrator.query("UPDATE admin.improvement_case SET status = 'Cerrada', failure_type = 'Datos' WHERE id = ANY($1)", [sembrados.slice(0, 2)]);
  await app.db.migrator.query("UPDATE admin.improvement_case SET status = 'En ajuste', failure_type = 'Modelo' WHERE id = $1", [sembrados[2]]);
  const todos = await casos();
  assert.equal(todos.total, 6);
  assert.equal(todos.items.length, 6);
  for (const c of todos.items) for (const campo of ["fecha", "categoria", "origenes", "tipoFallo", "estado", "antiguedadDias"]) assert.ok(campo in c, campo);
  assert.equal(todos.items.find((c: { id: string }) => c.id === sembrados[5]).antiguedadDias, 45);
  assert.equal((await casos("&estado=Cerrada")).total, 2);
  assert.equal((await casos("&tipoFallo=Modelo")).total, 1);
  assert.equal((await casos(`&desde=${new Date(Date.now() - 5 * 3_600_000 - 2 * 86_400_000).toISOString().slice(0, 10)}`)).total, 5);
  // Contador de no cerrados.
  assert.equal((await tec.api("GET", "/counters")).json.openImprovements, 4);
  await app.db.migrator.query("UPDATE admin.improvement_case SET status = 'Cerrada', failure_type = 'Datos' WHERE id = $1", [sembrados[3]]);
  assert.equal((await tec.api("GET", "/counters")).json.openImprovements, 3);
  assert.equal((await ges.api("GET", "/counters")).json.openImprovements, undefined);

  // Tras la purga de 12 meses el caso permanece, sin texto y sin recuperarlo.
  await app.db.migrator.query(
    `UPDATE chat.interaction SET question_text = NULL, answer_text = NULL, conversation_id = NULL, response_id = NULL, purged_at = now()
      WHERE row_id = (SELECT interaction_row_id FROM admin.improvement_case WHERE id = $1)`, [sembrados[4]]);
  const det = (await tec.api("GET", `/improvements/${sembrados[4]}`)).json;
  assert.equal(det.pregunta, null);
  assert.equal(det.disponibilidad, "depurada");
  const restos = await app.db.migrator.query("SELECT count(*)::int n FROM admin.improvement_transition WHERE note LIKE '%PREGUNTA-SECRETA%'");
  assert.equal(restos.rows[0].n, 0);
});

async function tmpIndice(runs: unknown[]): Promise<string> {
  const ruta = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evid-")), "indice.json");
  await fs.writeFile(ruta, JSON.stringify({ runs }));
  process.env.VALIDATION_EVIDENCE_INDEX = ruta;
  return ruta;
}
async function indexar(ruta: string, run: Record<string, unknown>): Promise<void> {
  const actual = JSON.parse(await fs.readFile(ruta, "utf8")) as { runs: Array<Record<string, unknown>> };
  actual.runs = actual.runs.filter(r => r.runId !== run.runId).concat(run);
  await fs.writeFile(ruta, JSON.stringify(actual));
}
