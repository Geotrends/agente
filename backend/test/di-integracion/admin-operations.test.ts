import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatAdminDbWithKb } from "./chatAdminDb.js";
import { setAdminPoolForTests } from "../../src/admin/db.js";
import { hashPassword } from "../../src/admin/passwords.js";
import { adminClock } from "../../src/admin/sessions.js";
import { resetIpThrottle } from "../../src/admin/auth.js";
import { operations, NOTIFICATION_TYPES } from "../../src/admin/operations.js";
import adminAuthRouter from "../../src/routes/adminAuth.js";
import adminOperationsRouter from "../../src/routes/adminOperations.js";

const ORIGIN = "https://panel.ejemplo.gov.co";
process.env.CHAT_ALLOWED_ORIGINS = ORIGIN;

type Ctx = { db: Awaited<ReturnType<typeof createChatAdminDbWithKb>>; base: string; tec: Record<string, string>; ges: Record<string, string>; clock: { t: number }; close: () => Promise<void> };

async function start(): Promise<Ctx> {
  const db = await createChatAdminDbWithKb();
  setAdminPoolForTests(db.admin);
  resetIpThrottle(); operations.reset();
  const clock = { t: Date.UTC(2026, 9, 8, 12, 0, 0) };
  adminClock.now = () => clock.t;
  const app = express();
  app.use(express.json());
  app.use("/api", adminAuthRouter);
  app.use("/api", adminOperationsRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  for (const [email, perfil] of [["tec@x.co", "administrador técnico"], ["ges@x.co", "Gestor documental"]]) {
    await db.admin.query(`INSERT INTO admin.account (email, display_name, profile, password_phc, must_change_password) VALUES ($1,$1,$2,$3,false)`,
      [email, perfil, await hashPassword("contraseña-larga-123")]);
  }
  const sesion = async (email: string) => {
    const r = await fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email, password: "contraseña-larga-123" }) });
    const b = await r.json();
    return { "content-type": "application/json", origin: ORIGIN, cookie: r.headers.get("set-cookie")!.split(";")[0], "x-csrf-token": b.csrfToken };
  };
  return { db, base, clock, tec: await sesion("tec@x.co"), ges: await sesion("ges@x.co"),
    close: async () => { adminClock.now = () => Date.now(); setAdminPoolForTests(undefined); operations.reset(); server.close(); await db.close(); } };
}
const get = (c: Ctx, path: string, h = c.tec) => fetch(`${c.base}${path}`, { headers: h });
const estados = async (c: Ctx) => Object.fromEntries(((await (await get(c, "/status")).json()).componentes as Array<{ component: string; status: string }>).map(x => [x.component, x.status]));

test("5 estados forzados se ven de inmediato (<60 s) y la normalidad se restablece", async () => {
  const c = await start();
  try {
    assert.deepEqual(await estados(c), { "gpt-oss-20b": "no comprobado", "gpt-oss-120b": "no comprobado", reranker: "no comprobado", registro: "no comprobado", scraper: "no comprobado" });
    await operations.reportComponent("gpt-oss-20b", false, { reason: "timeout" });
    await operations.reportComponent("gpt-oss-120b", true);
    await operations.reportComponent("reranker", true, { degraded: true, thresholdApplied: false, reason: "reranker apagado" });
    await operations.reportComponent("registro", false, { reason: "escritura fallida" });
    await c.db.kb.query(`INSERT INTO kb.kb_corrida (id, iniciada_en, terminada_en, programada, completa, informe) VALUES (gen_random_uuid(), $1, $1, true, false, 'x')`, [new Date(c.clock.t - 3600_000)]);
    const t0 = Date.now();
    const s = await estados(c);
    assert.ok(Date.now() - t0 < 60_000);
    assert.deepEqual(s, { "gpt-oss-20b": "degradado", "gpt-oss-120b": "normal", reranker: "degradado", registro: "degradado", scraper: "degradado" });
    const full = (await (await get(c, "/status")).json()).componentes;
    const rr = full.find((x: { component: string }) => x.component === "reranker");
    assert.equal(rr.thresholdApplied, false);
    assert.ok(full.find((x: { component: string }) => x.component === "gpt-oss-20b").lastFailureAt);
    await operations.reportComponent("gpt-oss-20b", true);
    await operations.reportComponent("reranker", true);
    await operations.reportComponent("registro", true);
    const n = await estados(c);
    assert.equal(n["gpt-oss-20b"], "normal"); assert.equal(n.reranker, "normal"); assert.equal(n.registro, "normal");
    assert.ok(!JSON.stringify(full).match(/pregunta|password|select/i));
  } finally { await c.close(); }
});

test("8 tipos de aviso, agrupación, contador, 4 revisiones de 5 → 1 y nueva ocurrencia tras revisar", async () => {
  const c = await start();
  try {
    for (const [i, tipo] of NOTIFICATION_TYPES.entries()) await operations.notify(tipo, "componente", `obj-${i}`, `Aviso ${tipo}`);
    let lista = await (await get(c, "/notifications")).json();
    assert.equal(lista.noRevisadas, 8);
    // Repetido tipo+objeto sin revisar: se agrupa.
    await operations.notify("modelo_no_disponible", "componente", "obj-0", "Aviso modelo_no_disponible");
    lista = await (await get(c, "/notifications")).json();
    assert.equal(lista.avisos.length, 8);
    assert.equal(lista.avisos.find((a: { type: string }) => a.type === "modelo_no_disponible").repetitions, 2);
    assert.deepEqual(lista.avisos.map((a: { lastAt: string }) => a.lastAt), [...lista.avisos.map((a: { lastAt: string }) => a.lastAt)].sort().reverse(), "descendente por última ocurrencia");

    const revisar = (id: string, h = c.tec) => fetch(`${c.base}/notifications/${id}/review`, { method: "POST", headers: h, body: "{}" });
    // De 5 avisos se revisan 4 → contador 1 (se parte de 8: se revisan 7 de 8).
    const ids = lista.avisos.map((a: { id: string }) => a.id);
    for (const id of ids.slice(0, 7)) assert.equal((await revisar(id)).status, 200);
    assert.equal((await (await get(c, "/notifications")).json()).noRevisadas, 1);
    assert.equal((await revisar(ids[0])).status, 409, "se revisa una sola vez");
    assert.ok([403, 404].includes((await revisar(ids[0], c.ges)).status), "un aviso de sistema no es visible ni revisable por el Gestor");
    const todas = await (await get(c, "/notifications?estado=todas")).json();
    assert.equal(todas.avisos.length, 8, "revisar conserva la fila");
    const rev = todas.avisos.find((a: { id: string }) => a.id === ids[0]);
    assert.ok(rev.reviewedBy && rev.reviewedAt && rev.state === "revisada");
    // Tras revisar, una nueva ocurrencia del mismo tipo+objeto abre otro aviso.
    await operations.notify("modelo_no_disponible", "componente", "obj-0", "Aviso modelo_no_disponible");
    const despues = await (await get(c, "/notifications?estado=todas")).json();
    assert.equal(despues.avisos.filter((a: { type: string }) => a.type === "modelo_no_disponible").length, 2);
    assert.equal(despues.noRevisadas, 2);
    const aud = await c.db.admin.query("SELECT count(*)::int n FROM admin.audit WHERE action = 'aviso.revisar'");
    assert.equal(aud.rows[0].n, 7);
  } finally { await c.close(); }
});

test("avisos de la KB se integran con permisos precisos y se revisan con actor y fecha", async () => {
  const c = await start();
  try {
    await c.db.kb.query(`INSERT INTO kb.kb_notificacion (tipo, objeto, descripcion) SELECT t, 'doc-1', 'Documento cambió' FROM unnest(enum_range(NULL::kb.tipo_notificacion)) t LIMIT 1`);
    const lista = await (await get(c, "/notifications")).json();
    const kb = lista.avisos.find((a: { origen: string }) => a.origen === "kb");
    assert.ok(kb);
    assert.equal((await fetch(`${c.base}/notifications/${kb.id}/review`, { method: "POST", headers: c.tec, body: "{}" })).status, 200);
    const fila = (await c.db.kb.query("SELECT estado, revisada_por, revisada_en FROM kb.kb_notificacion")).rows[0];
    assert.equal(fila.estado, "revisada"); assert.ok(fila.revisada_por && fila.revisada_en);
    // Permisos exactos: el panel no puede borrar ni editar otros datos de la KB.
    await assert.rejects(c.db.admin.query("DELETE FROM kb.kb_notificacion"), /permission denied/);
    await assert.rejects(c.db.admin.query("UPDATE kb.kb_notificacion SET descripcion = 'x'"), /permission denied/);
    await assert.rejects(c.db.admin.query("SELECT * FROM kb.kb_elemento"), /permission denied/);
  } finally { await c.close(); }
});

test("Gestor documental: 403 sin datos en estado; en avisos solo ve los propios (ninguno del sistema)", async () => {
  const c = await start();
  try {
    const estado = await get(c, "/status", c.ges);
    assert.equal(estado.status, 403);
    assert.ok(!(await estado.text()).includes("componentes"));
    // SPEC007 AD31: el Gestor ve únicamente avisos de carga propios; los de sistema no aparecen.
    await operations.notify("registro_no_disponible", "componente", "registro", "Fallo de escritura del registro");
    const avisos = await get(c, "/notifications", c.ges);
    assert.equal(avisos.status, 200);
    const cuerpo = await avisos.json();
    assert.deepEqual(cuerpo.avisos, []);
    assert.equal(cuerpo.noRevisadas, 0);
    assert.equal((await fetch(`${c.base}/status`)).status, 401);
  } finally { await c.close(); }
});

test("base de datos caída: 503 sin datos para ambos perfiles, sin login ni mutaciones; los avisos volátiles no abren acceso", async () => {
  const c = await start();
  try {
    await get(c, "/status"); // la sesión técnica queda registrada con la base viva
    await c.db.admin.end();   // cae la base para el panel
    const caida = new (await import("pg")).default.Pool({ connectionString: "postgres://x:y@127.0.0.1:1/nada", max: 1, connectionTimeoutMillis: 300 });
    setAdminPoolForTests(caida);
    await operations.notify("registro_no_disponible", "componente", "registro", "Fallo de escritura del registro");
    await operations.reportComponent("registro", false, { reason: "base caída" });

    // Plan SPEC007: la sesión no puede validarse → 503 uniforme, sin copia en memoria ni datos.
    for (const headers of [c.tec, c.ges]) {
      const s = await get(c, "/status", headers);
      assert.equal(s.status, 503);
      assert.ok(!(await s.text()).includes("componentes"));
      assert.equal((await get(c, "/notifications", headers)).status, 503);
    }
    const login = await fetch(`${c.base}/session`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email: "tec@x.co", password: "contraseña-larga-123" }) });
    assert.notEqual(login.status, 200);
    const rev = await fetch(`${c.base}/notifications/00000000-0000-4000-8000-000000000000/review`, { method: "POST", headers: c.tec, body: "{}" });
    assert.equal(rev.status, 503);
    await caida.end();
  } finally { setAdminPoolForTests(undefined); await c.close().catch(() => {}); }
});

test("al volver la base se persisten los avisos volátiles, sin ningún texto de consulta", async () => {
  const c = await start();
  try {
    const caida = new (await import("pg")).default.Pool({ connectionString: "postgres://x:y@127.0.0.1:1/nada", max: 1, connectionTimeoutMillis: 300 });
    setAdminPoolForTests(caida);
    await operations.notify("registro_no_disponible", "componente", "registro", "Fallo de escritura del registro");
    await operations.notify("registro_no_disponible", "componente", "registro", "Fallo de escritura del registro");
    await caida.end();
    setAdminPoolForTests(c.db.admin);
    await operations.flushVolatile();
    const { rows } = await c.db.admin.query("SELECT type, repetitions, safe_description FROM admin.notification");
    assert.deepEqual(rows, [{ type: "registro_no_disponible", repetitions: 2, safe_description: "Fallo de escritura del registro" }]);
    assert.equal((await operations.list("no_revisada")).avisos.length, 1);
  } finally { await c.close(); }
});
