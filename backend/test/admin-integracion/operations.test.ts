/** US5 · Operación (RF-C3-AD-28..31, 40, 41, 48): avisos por propietario, contadores, pendientes, auditoría y estado. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { notificar } from "../../src/kb/notifications.js";
import { procesarCargasManuales } from "../../src/kb/manualUploads.js";
import { procesarOperaciones } from "../../src/kb/documentOperations.js";
import { operations } from "../../src/admin/operations.js";
import { crearPdf, RELLENO } from "./fixtures.js";
import { GESTOR, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

const SITIO = "https://ambientometroenvigado.com";
let app: AdminApp;
let tec: Session;
let gesA: Session;
let gesB: Session;
let idA = ""; let idB = "";

test.before(async () => {
  app = await startAdminApp({ qdrant: true });
  await app.createAccount("tec.ops@prueba.gov.co", TECNICO);
  idA = await app.createAccount("gesa.ops@prueba.gov.co", GESTOR, { name: "Gestora A" });
  idB = await app.createAccount("gesb.ops@prueba.gov.co", GESTOR, { name: "Gestor B" });
  tec = await app.login("tec.ops@prueba.gov.co");
  gesA = await app.login("gesa.ops@prueba.gov.co");
  gesB = await app.login("gesb.ops@prueba.gov.co");
});
test.after(async () => { await app.close(); });

const avisos = async (s: Session, q = "") => (await s.api("GET", `/notifications?limit=100${q}`)).json;
const contadores = async (s: Session) => (await s.api("GET", "/counters")).json;
const meta = () => ({ type: "Documento", title: `Doc ${randomUUID().slice(0, 6)}`, direction: "Ecosistemas", publicUrl: `${SITIO}/${randomUUID().slice(0, 8)}/`, associatedProcedure: "ninguno" });

test("AD28/29: 8 avisos de 8 tipos ordenados, contador 8 (y 7 al revisar uno), 0 correos; el Gestor no los ve y marcarlos se rechaza", async () => {
  const tipos = ["modelo_no_disponible", "doble_fallo_modelos", "reranker_degradado", "registro_no_disponible", "cuenta_bloqueada", "calibracion_pendiente", "publicacion_fallida", "tarifa_faltante"];
  for (const [i, t] of tipos.entries()) await operations.notify(t, "componente", `op-${i}`, `Aviso ${t}`);
  const l = await avisos(tec);
  assert.equal(l.items.length, 8);
  assert.equal(l.noRevisadas, 8);
  for (const a of l.items) for (const campo of ["type", "lastAt", "description", "state", "repetitions", "id"]) assert.ok(a[campo] !== undefined, campo);
  assert.deepEqual(l.items.map((a: { lastAt: string }) => a.lastAt), [...l.items.map((a: { lastAt: string }) => a.lastAt)].sort().reverse());
  assert.ok(l.items.every((a: { id: string }) => /^(adm|kb):[0-9a-f-]{36}$/.test(a.id)), "identificadores con espacio de nombres");
  // Contador visible en las tres pantallas (el cascarón lo pide en todas).
  assert.equal((await contadores(tec)).notifications, 8);
  // 4 revisiones una por vez: usuario, fecha y hora; el contador baja y siguen en la lista.
  const [a0, a1, a2, a3] = l.items;
  for (const [i, a] of [a0, a1, a2, a3].entries()) {
    const r = await tec.api("POST", `/notifications/${a.id}/review`, { expectedRevision: a.revision });
    assert.equal(r.status, 200);
    assert.equal(r.json.noRevisadas, 7 - i);
  }
  const todas = await avisos(tec, "&estado=todas");
  assert.equal(todas.items.length, 8, "siguen en la lista");
  const rev = todas.items.find((a: { id: string }) => a.id === a0.id);
  assert.ok(rev.reviewedBy && rev.reviewedAt && rev.state === "revisada");
  assert.equal((await contadores(tec)).notifications, 4);
  // Una revisión obsoleta no se aplica.
  assert.equal((await tec.api("POST", `/notifications/${l.items[4].id}/review`, { expectedRevision: "99" })).status, 409);
  // El Gestor no los ve ni los marca.
  assert.deepEqual((await avisos(gesA)).items, []);
  assert.equal((await gesA.api("POST", `/notifications/${l.items[5].id}/review`, {})).status, 404);
  assert.equal((await contadores(gesA)).notifications, 0);
  // Cero envíos externos: la base no tiene ninguna salida de correo ni webhook para avisos.
  const cols = await app.db.migrator.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'admin' AND table_name = 'notification'");
  assert.ok(!cols.rows.some(c => /mail|webhook|sent/i.test(c.column_name)));
});

test("AD30: 4 fallas del scraper sobre un enlace → 1 aviso con contador 4; otro enlace aparte; revisar y nueva falla → nuevo con 1", async () => {
  const falla = (url: string) => notificar(app.kb, "verificacion_fallida", url, `No se pudo verificar ${url}: timeout`);
  const e1 = `${SITIO}/enlace-roto-1`; const e2 = `${SITIO}/enlace-roto-2`;
  for (let i = 0; i < 4; i++) await falla(e1);
  await falla(e2);
  const filas = (await avisos(tec)).items.filter((a: { type: string }) => a.type === "verificacion_fallida");
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map((a: { repetitions: number }) => a.repetitions).sort(), [1, 4]);
  const antes = (await contadores(tec)).notifications;
  // El contador cuenta cada agrupada una vez.
  const primera = filas.find((a: { repetitions: number }) => a.repetitions === 4);
  assert.equal((await tec.api("POST", `/notifications/${primera.id}/review`, {})).status, 200);
  await falla(e1);
  const despues = (await avisos(tec)).items.filter((a: { type: string; description: string }) => a.type === "verificacion_fallida" && a.description.includes("enlace-roto-1"));
  assert.equal(despues.length, 1);
  assert.equal(despues[0].repetitions, 1, "nueva ocurrencia tras revisar");
  assert.equal((await contadores(tec)).notifications, antes, "−1 por revisar +1 por la nueva");
});

test("AD31: cada Gestor ve solo los avisos de carga propios; marcar uno ajeno o del sistema se rechaza; el rechazo muestra el motivo; el segundo descarte OCR se agrupa", async () => {
  const antesA = (await contadores(gesA)).notifications;
  const antesB = (await contadores(gesB)).notifications;
  const ocr = (doc: string, owner: string) => notificar(app.kb, "descarte_ocr", doc, `${doc} no se cargó: OCR bajo`, { propietario: owner });
  await ocr("doc-a1", idA); await ocr("doc-a2", idA);
  await notificar(app.kb, "formato_con_datos_personales", "doc-a3", "doc-a3 parece diligenciado", { propietario: idA });
  await ocr("doc-b1", idB);
  await notificar(app.kb, "verificacion_fallida", "sistema-1", "falla del sistema");
  await notificar(app.kb, "fuera_de_alcance", "sistema-2", "fuera de alcance");

  const a = await avisos(gesA);
  assert.equal(a.items.length - antesA, 3);
  assert.equal(a.noRevisadas - antesA, 3);
  assert.ok(a.items.every((x: { scope: string }) => x.scope === "carga"));
  const b = await avisos(gesB);
  assert.equal(b.items.length - antesB, 1);
  assert.ok(b.items.every((x: { description: string }) => !x.description.includes("doc-a")));

  // Marca una propia → baja a 2.
  const propio = a.items.find((x: { description: string }) => x.description.includes("doc-a1"));
  assert.equal((await gesA.api("POST", `/notifications/${propio.id}/review`, {})).status, 200);
  assert.equal((await contadores(gesA)).notifications - antesA, 2);
  // Ajena y del sistema: rechazadas.
  const ajena = b.items.find((x: { description: string }) => x.description.includes("doc-b1"));
  assert.ok([403, 404].includes((await gesA.api("POST", `/notifications/${ajena.id}/review`, {})).status));
  const sistema = (await avisos(tec)).items.find((x: { description: string }) => x.description.includes("falla del sistema"));
  assert.ok([403, 404].includes((await gesA.api("POST", `/notifications/${sistema.id}/review`, {})).status));
  // Segundo descarte por OCR del mismo documento: se agrupa (contador 2).
  await ocr("doc-a2", idA);
  const agrupado = (await avisos(gesA)).items.find((x: { description: string }) => x.description.includes("doc-a2"));
  assert.equal(agrupado.repetitions, 2);

  // El rechazo por el administrador llega con el motivo.
  const r = await gesB.upload(meta(), { bytes: crearPdf([RELLENO, "Dato RECHAZO1"]), name: "d.pdf" });
  assert.equal(r.status, 201);
  const doc = (await tec.api("GET", "/documents?limit=100")).json.items.find((d: { id: string }) => d.id === r.json.id);
  assert.equal((await tec.api("POST", `/documents/${doc.id}/reject`, { expectedRevision: doc.revision, motivo: "El documento está desactualizado" })).status, 202);
  await procesarCargasManuales(app.kb);
  await procesarOperaciones(app.kb);
  const rechazo = (await avisos(gesB)).items.find((x: { type: string }) => x.type === "carga_rechazada");
  assert.ok(rechazo.description.includes("El documento está desactualizado"));
  assert.equal((await avisos(gesA)).items.some((x: { type: string }) => x.type === "carga_rechazada"), false);
});

test("AD40: bandeja de 5 pendientes (3 documentos, uno de 40 días, y 2 propuestas) del más antiguo al más reciente; contador 5 → 4 al publicar", async () => {
  // Estado limpio de pendientes: se descartan los documentos previos de la prueba anterior.
  await app.kb.query("DELETE FROM kb.kb_elemento");
  await app.kb.query("DELETE FROM kb.link_proposal");
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await tec.upload(meta(), { bytes: crearPdf([RELLENO, `Dato PEND${i}`]), name: "d.pdf" });
    assert.equal(r.status, 201);
    ids.push(r.json.id);
  }
  await procesarCargasManuales(app.kb);
  await app.kb.query("UPDATE kb.kb_version SET subida_en = now() - interval '40 days' WHERE elemento_id = $1", [ids[0]]);
  for (let i = 0; i < 2; i++) assert.equal((await gesA.api("POST", "/link-proposals", { type: "add", url: `${SITIO}/pend-${i}/`, direction: "Ecosistemas", justification: "Relevante" })).status, 201);

  const p = (await tec.api("GET", "/pending")).json;
  assert.equal(p.total, 5);
  assert.equal(p.items.length, 5);
  assert.equal(p.items[0].tipo, "documento");
  assert.equal(p.items[0].dias, 40);
  assert.deepEqual(p.items.map((x: { fecha: string }) => x.fecha), [...p.items.map((x: { fecha: string }) => x.fecha)].sort(), "más antiguo primero");
  assert.ok(p.items.every((x: { dias: number }) => x.dias >= 0));
  assert.equal((await contadores(tec)).pending, 5);
  // Invisible al Gestor.
  assert.equal((await gesA.api("GET", "/pending")).status, 403);
  assert.equal((await contadores(gesA)).pending, undefined);

  // Publicar uno: baja a 4 solo cuando la operación termina (no al encolar).
  const d = (await tec.api("GET", "/documents?limit=100")).json.items.find((x: { id: string }) => x.id === ids[1]);
  assert.equal((await tec.api("POST", `/documents/${ids[1]}/publish`, { expectedRevision: d.revision })).status, 202);
  assert.equal((await contadores(tec)).pending, 5, "encolado ≠ efectivo");
  await procesarOperaciones(app.kb);
  assert.equal((await contadores(tec)).pending, 4);
});

test("AD41: 12 acciones de modificación y 1 recuperación → 13 filas con 5 datos, sin contraseñas ni contenido; 3 filtros; solo lectura; invisible al Gestor", async () => {
  await app.createAccount("tec.aud@prueba.gov.co", TECNICO, { name: "Técnico Auditoría" });
  const t = await app.login("tec.aud@prueba.gov.co");
  await app.createAccount("ges.aud@prueba.gov.co", GESTOR);
  const g = await app.login("ges.aud@prueba.gov.co");
  const rev = async () => (await t.api("GET", "/contacts")).json.revision as number;
  const lista = async () => (await t.api("GET", "/accounts?limit=100")).json.items as Array<{ id: string; revision: string }>;
  const rv = async (id: string) => (await lista()).find(c => c.id === id)!.revision;
  const SECRETO = "contraseña-secreta-AUD-77";
  // 12 acciones de modificación de tipos distintos.
  const n1 = await t.api("POST", "/accounts", { nombre: "Nueva", email: "nueva.aud@prueba.gov.co", perfil: GESTOR, password: SECRETO });
  await t.api("PATCH", `/accounts/${n1.json.id}`, { expectedRevision: await rv(n1.json.id), active: false });
  await t.api("PATCH", `/accounts/${n1.json.id}`, { expectedRevision: await rv(n1.json.id), active: true });
  await t.api("PATCH", `/accounts/${n1.json.id}`, { expectedRevision: await rv(n1.json.id), perfil: TECNICO });
  await t.api("POST", `/accounts/${n1.json.id}/temporary-password`, { expectedRevision: await rv(n1.json.id), password: SECRETO + "-temp" });
  await t.api("PUT", "/contacts/reception", { revision: await rev(), pqrsd: "https://p.gov.co", whatsapp: "300 1", email: "a@b.co" });
  await t.api("PUT", "/contacts/general", { revision: await rev(), phone: "604 1", email: "a@b.co", url: "https://p.gov.co" });
  await t.api("POST", "/contacts/immediate", { revision: await rev(), name: "Emergencia", description: "24 h", type: "teléfono", value: "123" });
  const up = await t.upload(meta(), { bytes: crearPdf([RELLENO, "CONTENIDOSECRETO-AUD"]), name: "d.pdf" });
  assert.equal(up.status, 201);
  const doc = (await t.api("GET", "/documents?limit=100")).json.items.find((d: { id: string }) => d.id === up.json.id);
  await t.api("PATCH", `/documents/${up.json.id}/metadata`, { expectedRevision: doc.revision, changes: { title: "Editado" } });
  const lr = (await t.api("GET", "/scraper-links")).json.listRevision;
  await t.api("POST", "/scraper-links", { url: `${SITIO}/aud/`, direction: "Ecosistemas", justification: "Auditoría", expectedListRevision: lr });
  assert.equal((await g.api("POST", "/link-proposals", { type: "add", url: `${SITIO}/aud2/`, direction: "Ecosistemas", justification: "x" })).status, 201);
  // 1 ejecución del procedimiento reservado.
  await app.db.migrator.query("ALTER ROLE contractor_recovery LOGIN PASSWORD 'recuperacion-aud-123'");
  const pg = (await import("pg")).default;
  const u = new URL(app.db.migratorUrl); u.username = "contractor_recovery"; u.password = "recuperacion-aud-123";
  const pool = new pg.Pool({ connectionString: u.toString(), max: 1 });
  const { recoverPassword } = await import("../../src/admin/recovery.js");
  assert.deepEqual(await recoverPassword(pool, "nueva.aud@prueba.gov.co", SECRETO + "-rec"), { ok: true });
  await pool.end();

  const aud = (await t.api("GET", "/audit?limit=100")).json;
  const recientes = aud.items.filter((x: { actor: { id: string | null; rol: string | null }; accion: string }) =>
    !x.accion.startsWith("sesion.") && (x.actor.id === t.accountId || x.actor.id === g.accountId || x.actor.rol === "contractor_recovery"));
  assert.equal(recientes.length, 13, JSON.stringify(recientes.map((x: { accion: string }) => x.accion)));
  for (const f of recientes) {
    for (const campo of ["accion", "objeto", "fecha", "resultado"]) assert.ok(f[campo], campo);
    assert.ok(f.actor.id || f.actor.rol, "actor cuenta o rol real");
  }
  assert.ok(recientes.some((x: { actor: { rol: string }; accion: string }) => x.actor.rol === "contractor_recovery" && x.accion === "cuenta.recuperacion"));
  assert.ok(recientes.some((x: { actor: { nombre: string } }) => x.actor.nombre === "Técnico Auditoría"));
  // Sin contraseñas ni contenido en ninguna fila (ni en la base de auditoría completa).
  const volcado = JSON.stringify(aud.items);
  for (const prohibido of [SECRETO, "CONTENIDOSECRETO", "argon2id"]) assert.ok(!volcado.includes(prohibido), prohibido);
  const enBase = await app.db.migrator.query("SELECT count(*)::int n FROM admin.audit WHERE (action || coalesce(object_id,'') || result) LIKE '%argon2id%' OR (action || coalesce(object_id,'')) LIKE $1", [`%${SECRETO}%`]);
  assert.equal(enBase.rows[0].n, 0);
  // Filtros: usuario, acción y fechas.
  const porUsuario = (await t.api("GET", `/audit?usuario=${t.accountId}&limit=100`)).json;
  assert.ok(porUsuario.items.length > 0 && porUsuario.items.every((x: { actor: { id: string } }) => x.actor.id === t.accountId));
  const porAccion = (await t.api("GET", "/audit?accion=cuenta.crear&limit=100")).json;
  assert.ok(porAccion.items.length >= 1 && porAccion.items.every((x: { accion: string }) => x.accion === "cuenta.crear"));
  const porFecha = (await t.api("GET", "/audit?desde=2026-01-01&hasta=2026-12-31&limit=100")).json;
  assert.equal(porFecha.total, aud.total);
  const unDia = (await t.api("GET", `/audit?desde=2026-10-12&hasta=2026-10-12&limit=100`)).json;
  assert.ok(unDia.total > 0 && unDia.total <= aud.total, "el rango inclusivo de un día filtra por fecha de Bogotá");
  assert.equal((await t.api("GET", "/audit?desde=2001-01-01&hasta=2001-01-02")).json.total, 0);
  // Solo lectura y sin acceso del Gestor.
  for (const [m, p] of [["PUT", "/audit"], ["PATCH", "/audit/1"], ["DELETE", "/audit/1"], ["POST", "/audit"]] as const) assert.equal((await t.api(m, p, {})).status, 404);
  assert.equal((await g.api("GET", "/audit")).status, 403);
});

test("AD48 + reinicio: 5 estados visibles al instante, normalidad explícita, persistencia tras reiniciar y reindexación visible", async () => {
  const estado = async () => (await tec.api("GET", "/status")).json;
  const c = (e: { componentes: Array<{ component: string; status: string; lastFailureAt?: string }> }, k: string) => e.componentes.find(x => x.component === k)!;
  await operations.reportComponent("gpt-oss-20b", false, { reason: "caído" });
  let e = await estado();
  assert.equal(c(e, "gpt-oss-20b").status, "degradado");
  await operations.reportComponent("gpt-oss-120b", false, { reason: "caído" });
  await operations.reportComponent("reranker", true, { degraded: true, thresholdApplied: false, reason: "apagado" });
  await operations.reportComponent("registro", false, { reason: "escritura fallida" });
  await app.kb.query(
    "INSERT INTO kb.kb_corrida (id, iniciada_en, terminada_en, programada, completa, informe) VALUES ($1, now(), now(), true, false, 'x.json')", [randomUUID()]);
  e = await estado();
  for (const k of ["gpt-oss-20b", "gpt-oss-120b", "reranker", "registro", "scraper"]) assert.equal(c(e, k).status, "degradado", k);
  // Reinicio del proceso: la memoria se pierde y el estado persistido se rehidrata (no «normal»).
  operations.reset();
  e = await estado();
  assert.equal(c(e, "gpt-oss-20b").status, "degradado");
  assert.ok(c(e, "gpt-oss-20b").lastFailureAt);
  // Todo normal se indica explícitamente.
  for (const k of ["gpt-oss-20b", "gpt-oss-120b", "reranker", "registro"] as const) await operations.reportComponent(k, true, k === "reranker" ? { thresholdApplied: true } : {});
  await app.kb.query("UPDATE kb.kb_corrida SET completa = true");
  e = await estado();
  for (const k of ["gpt-oss-20b", "gpt-oss-120b", "reranker", "registro", "scraper"]) assert.equal(c(e, k).status, "normal", k);
  // Invisible al Gestor.
  assert.equal((await gesA.api("GET", "/status")).status, 403);
  // Reindexación en curso/terminada con inicio y fin.
  const r = await tec.api("POST", "/reindexations", {});
  assert.equal(r.status, 202);
  assert.equal((await estado()).reindexacion.estado, "En curso");
  await procesarOperaciones(app.kb);
  const fin = (await estado()).reindexacion;
  assert.equal(fin.estado, "Terminada");
  assert.ok(fin.inicio && fin.fin);
});

test("revisar todos: el Gestor solo marca sus avisos de carga; el técnico marca todos los visibles, cada uno auditado", async () => {
  await notificar(app.kb, "descarte_ocr", "doc-todos-a", "doc-todos-a no se cargó: OCR bajo", { propietario: idA });
  await notificar(app.kb, "descarte_ocr", "doc-todos-b", "doc-todos-b no se cargó: OCR bajo", { propietario: idB });
  await operations.notify("modelo_no_disponible", "componente", "op-todos", "Aviso para revisar todos");
  const pendientesB = (await contadores(gesB)).notifications;
  assert.ok(pendientesB >= 1);
  const auditadas = async () => (await app.db.migrator.query("SELECT count(*)::int n FROM admin.audit WHERE action = 'aviso.revisar'")).rows[0].n as number;
  const auditoriaAntes = await auditadas();

  // El Gestor A no toca los avisos del Gestor B ni los del sistema.
  const ra = await gesA.api("POST", "/notifications/review-all", {});
  assert.equal(ra.status, 200, ra.text);
  assert.ok(ra.json.revisados >= 1);
  assert.equal(ra.json.noRevisadas, 0);
  assert.equal((await contadores(gesB)).notifications, pendientesB);

  // El técnico marca todo lo que ve; el contador queda en cero y cada aviso tiene su auditoría.
  const antes = (await contadores(tec)).notifications;
  assert.ok(antes >= 2);
  const rt = await tec.api("POST", "/notifications/review-all", {});
  assert.equal(rt.status, 200, rt.text);
  assert.equal(rt.json.revisados, antes);
  assert.equal(rt.json.noRevisadas, 0);
  assert.equal((await contadores(gesB)).notifications, 0);
  const todas = await avisos(tec, "&estado=todas");
  assert.ok(todas.items.filter((a: { id: string }) => !a.id.startsWith("volatil-")).every((a: { state: string; reviewedBy: string | null; reviewedAt: string | null }) =>
    a.state === "revisada" && a.reviewedBy && a.reviewedAt));
  assert.equal(await auditadas() - auditoriaAntes, ra.json.revisados + rt.json.revisados, "una entrada de auditoría por aviso");

  // Sin pendientes, no hace nada.
  assert.equal((await tec.api("POST", "/notifications/review-all", {})).json.revisados, 0);
});
