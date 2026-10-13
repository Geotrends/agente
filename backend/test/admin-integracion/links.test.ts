/** US3 · Enlaces y propuestas (RF-C3-AD-14..19, 33, 34): hosts permitidos, decisiones, quita con documentos. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { publicarSnapshot, rutaSnapshot, sembrarEnlaces } from "../../src/kb/managedLinks.js";
import { reconstruirColeccion } from "../../src/kb/service.js";
import { embedderSintetico } from "../kb-integracion/qdrantPruebas.js";
import { GESTOR, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

const A = "https://ambientometroenvigado.com";
let app: AdminApp;
let tec: Session;
let gesA: Session;
let gesB: Session;

test.before(async () => {
  app = await startAdminApp({ qdrant: true });
  process.env.GEOTRENDS_DOCUMENTS_ROOT = app.uploadDir;
  await app.createAccount("tec.links@prueba.gov.co", TECNICO, { name: "Técnico Enlaces" });
  await app.createAccount("gesa.links@prueba.gov.co", GESTOR, { name: "Gestora A" });
  await app.createAccount("gesb.links@prueba.gov.co", GESTOR, { name: "Gestor B" });
  tec = await app.login("tec.links@prueba.gov.co");
  gesA = await app.login("gesa.links@prueba.gov.co");
  gesB = await app.login("gesb.links@prueba.gov.co");
  await sembrarEnlaces(app.kb); // semillas de la configuración desplegada
});
test.after(async () => { await app.close(); });

const lista = async () => (await tec.api("GET", "/scraper-links")).json as { items: Array<{ id: string; url: string; fuente: string; revision: string }>; listRevision: string };
const firma = async () => { const l = await lista(); return JSON.stringify([l.listRevision, l.items.map(i => i.url).sort()]); };
const propuesta = (s: Session, over: Record<string, unknown> = {}) =>
  s.api("POST", "/link-proposals", { type: "add", url: `${A}/propuesta-${randomUUID().slice(0, 8)}/`, direction: "Ecosistemas", justification: "Contenido relevante", ...over });
const accion = async (s: Session, id: string, tipo: "approve" | "reject" | "withdraw", extra: Record<string, unknown> = {}) => {
  const p = (await app.kb.query("SELECT revision FROM kb.link_proposal WHERE id = $1", [id])).rows[0];
  return s.api("POST", `/link-proposals/${id}/${tipo}`, { expectedRevision: String(p.revision), ...extra });
};
const md = async (clave: string, url: string, origen: "scraper" | "manual" = "scraper", estado = "publicado") => {
  const { rows: [e] } = await app.kb.query(
    `INSERT INTO kb.kb_elemento (clave, nombre, tipo, direccion, url_origen, estado, formato_original, procedimientos_origen, fuente, origen)
     VALUES ($1,$2,'pagina','ecosistemas',$3,$4,'html',$5,$6,$7) RETURNING id`,
    [clave, `Doc ${clave}`, url, estado, origen === "manual" ? [] : ["Ambientómetro"], origen === "manual" ? "manual" : "ambientometro", origen]);
  const { rows: [v] } = await app.kb.query(
    `INSERT INTO kb.kb_version (elemento_id, hash_contenido, contenido_md, fecha_acceso, origen) VALUES ($1,$2,$3,now(),$4) RETURNING id`,
    [e.id, randomUUID().replace(/-/g, "").padEnd(64, "0"), `# ${clave}\n\nContenido de ${clave} para enlaces.`, origen]);
  await app.kb.query("UPDATE kb.kb_elemento SET version_publicada_id = $2 WHERE id = $1", [e.id, v.id]);
  return e.id as string;
};

test("las semillas iniciales se siembran una sola vez desde la configuración desplegada", async () => {
  const antes = (await lista()).items.length;
  assert.ok(antes >= 12, `semillas: ${antes}`);
  assert.equal(await sembrarEnlaces(app.kb), 0, "idempotente");
  assert.equal((await lista()).items.length, antes);
});

test("AD14: 8 propuestas — 3 válidas quedan pendientes con la lista idéntica; 5 inválidas indican el campo y no se guardan", async () => {
  const antes = await firma();
  const n0 = Number((await app.kb.query("SELECT count(*) FROM kb.link_proposal")).rows[0].count);
  for (const over of [{}, { type: "remove", url: "https://ambientometroenvigado.com/observatorio/" }, { direction: "Bienestar Animal" }]) {
    const r = await propuesta(gesA, over);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.estado, "Pendiente de validación");
  }
  const invalidas: Array<[Record<string, unknown>, string]> = [
    [{ justification: "" }, "justification"], [{ direction: undefined }, "direction"], [{ type: undefined }, "type"],
    [{ url: "http://ambientometroenvigado.com/x/" }, "url"], [{ url: "https://sinpunto/x" }, "url"],
  ];
  for (const [over, campo] of invalidas) {
    const cuerpo: Record<string, unknown> = { type: "add", url: `${A}/inv-${randomUUID().slice(0, 6)}/`, direction: "Ecosistemas", justification: "ok", ...over };
    for (const k of Object.keys(cuerpo)) if (cuerpo[k] === undefined) delete cuerpo[k];
    const r = await gesA.api("POST", "/link-proposals", cuerpo);
    assert.equal(r.status, 422, JSON.stringify(cuerpo));
    assert.equal(r.json.error.campo, campo);
  }
  assert.equal(Number((await app.kb.query("SELECT count(*) FROM kb.link_proposal")).rows[0].count), n0 + 3);
  assert.equal(await firma(), antes, "la lista de enlaces no cambió");
});

test("AD15: hosts permitidos (6 aceptados, 8 rechazados con motivo) y la lista de hosts no es editable desde el panel", async () => {
  const permitidos = [
    "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000099999", "https://envigado.gov.co/nuevo-tema",
    "https://www.envigado.gov.co/nuevo", "https://www.concejoenvigado.gov.co/acuerdos", "https://observatorioenvigado.geotrends.co/otra",
    `${A}/enlace-nuevo-15/`,
  ];
  const l0 = (await lista());
  for (const [i, url] of permitidos.entries()) {
    const r = await tec.api("POST", "/scraper-links", { url, direction: "Ecosistemas", justification: "Prueba de host", expectedListRevision: (await lista()).listRevision });
    assert.equal(r.status, 201, `${url}: ${r.text}`);
    void i;
  }
  const rechazados = [
    "http://ambientometroenvigado.com/x", "https://envigado.gov.co.evil.com/x", "https://www.minambiente.gov.co/x",
    "https://concejoenvigado.gov.co/x", "https://sub.observatorioenvigado.geotrends.co/x", "https://ambientometroenvigado.com.evil.org/x",
    "ftp://ambientometroenvigado.com/x", "https://localhost/x",
  ];
  for (const url of rechazados) {
    const r = await tec.api("POST", "/scraper-links", { url, direction: "Ecosistemas", justification: "x", expectedListRevision: (await lista()).listRevision });
    assert.equal(r.status, 422, url);
    assert.equal(r.json.error.campo, "url");
    assert.ok(r.json.error.mensaje.length > 10, "con motivo");
    // También como propuesta de un Gestor.
    assert.equal((await gesA.api("POST", "/link-proposals", { type: "add", url, direction: "Ecosistemas", justification: "x" })).status, 422);
  }
  assert.equal((await lista()).items.length, l0.items.length + 6);
  // Ninguna función del panel edita los hosts.
  for (const [m, p] of [["GET", "/allowed-hosts"], ["PUT", "/allowed-hosts"], ["POST", "/hosts"], ["PATCH", "/scraper-hosts"]] as const) {
    assert.equal((await tec.api(m, p, m === "GET" ? undefined : {})).status, 404, `${m} ${p}`);
  }
});

test("AD16: la lista cambia solo al aprobar; 2 rechazos con motivo visibles al Gestor; rechazo sin motivo y decisión del Gestor denegados", async () => {
  const base = await firma();
  const pAdd = (await propuesta(gesA, { url: `${A}/aprobar-add/` })).json.id as string;
  const pRej1 = (await propuesta(gesA, { url: `${A}/rechazar-1/` })).json.id as string;
  const pRej2 = (await propuesta(gesA, { url: `${A}/rechazar-2/` })).json.id as string;
  const destino = (await lista()).items.find(i => i.url.includes("biblioteca-boletines"))!;
  const pRem = (await propuesta(gesA, { type: "remove", url: destino.url })).json.id as string;
  assert.equal(await firma(), base, "sin cambios hasta aprobar");

  assert.equal((await accion(gesA, pAdd, "approve")).status, 403, "el Gestor no decide");
  assert.equal((await accion(tec, pRej1, "reject", { motivo: "   " })).status, 422);
  assert.equal((await accion(tec, pRej1, "reject", { motivo: "No está en el alcance de la base" })).status, 200);
  assert.equal((await accion(tec, pRej2, "reject", { motivo: "Duplica un enlace existente" })).status, 200);
  assert.equal(await firma(), base, "rechazar no modifica la lista");

  const aprobada = await accion(tec, pAdd, "approve");
  assert.equal(aprobada.status, 200, aprobada.text);
  assert.equal(aprobada.json.propuesta.estado, "Aprobada");
  assert.equal(aprobada.json.propuesta.decididaPor, "Técnico Enlaces");
  assert.ok(aprobada.json.propuesta.decididaEn);
  assert.ok((await lista()).items.some(i => i.url === `${A}/aprobar-add/`));
  // El snapshot que lee el scraper en la siguiente corrida incluye el enlace agregado.
  await publicarSnapshot(app.kb, app.uploadDir);
  let snap = JSON.parse(await fs.readFile(rutaSnapshot(app.uploadDir), "utf8"));
  assert.ok(snap.links.some((l: { url: string }) => l.url === `${A}/aprobar-add/`));

  const quitada = await accion(tec, pRem, "approve");
  assert.equal(quitada.status, 200);
  assert.ok(!(await lista()).items.some(i => i.url === destino.url));
  await publicarSnapshot(app.kb, app.uploadDir);
  snap = JSON.parse(await fs.readFile(rutaSnapshot(app.uploadDir), "utf8"));
  assert.ok(snap.removed.includes(destino.url), "el scraper excluye el enlace quitado");
  assert.ok(!snap.links.some((l: { url: string }) => l.url === destino.url));

  // El Gestor ve el motivo; una segunda decisión no cambia el estado final.
  const propias = (await gesA.api("GET", "/link-proposals?limit=100")).json.items as Array<{ id: string; estado: string; motivoRechazo: string | null }>;
  assert.equal(propias.find(p => p.id === pRej1)!.motivoRechazo, "No está en el alcance de la base");
  assert.equal((await accion(tec, pRej1, "approve")).status, 409);
});

test("AD17: 2 acciones directas válidas con usuario/fecha; 4 inválidas, 2 con Gestor denegadas y la lista intacta", async () => {
  const antes = await firma();
  const rev = async () => (await lista()).listRevision;
  const ok1 = await tec.api("POST", "/scraper-links", { url: `${A}/directo-1/`, direction: "Gestión Ambiental", justification: "Fuente de calidad del aire", expectedListRevision: await rev() });
  assert.equal(ok1.status, 201);
  const fila = (await lista()).items.find(i => i.url === `${A}/directo-1/`)!;
  const row = (await app.kb.query("SELECT changed_by_name, changed_at FROM kb.scraper_link WHERE id = $1", [fila.id])).rows[0];
  assert.equal(row.changed_by_name, "Técnico Enlaces");
  assert.ok(row.changed_at);
  const quita = await tec.api("DELETE", `/scraper-links/${fila.id}`, {
    direction: "Gestión Ambiental", justification: "Ya no es relevante", expectedRevision: fila.revision, expectedListRevision: await rev() });
  assert.equal(quita.status, 200, quita.text);
  const despuesValidas = await firma();
  const inval: Array<Record<string, unknown>> = [
    { url: `${A}/x1/`, direction: "Ecosistemas", justification: "" },
    { url: `${A}/x2/`, justification: "ok" },
    { url: "https://www.minambiente.gov.co/x", direction: "Ecosistemas", justification: "ok" },
    { url: `http://ambientometroenvigado.com/x`, direction: "Ecosistemas", justification: "ok" },
  ];
  for (const c of inval) assert.equal((await tec.api("POST", "/scraper-links", { ...c, expectedListRevision: await rev() })).status, 422);
  for (const s of [gesA, gesB]) {
    assert.equal((await s.api("POST", "/scraper-links", { url: `${A}/g/`, direction: "Ecosistemas", justification: "ok", expectedListRevision: "1" })).status, 403);
  }
  assert.equal(await firma(), despuesValidas);
  assert.notEqual(antes, despuesValidas);
  // Revisión de lista obsoleta → 409 sin cambios.
  assert.equal((await tec.api("POST", "/scraper-links", { url: `${A}/obsoleta/`, direction: "Ecosistemas", justification: "ok", expectedListRevision: "1" })).status, 409);
});

test("AD18/19: quitar un enlace conserva lo publicado, avisa con 5 datos solo al técnico y marca; reagregar la retira", async () => {
  // Enlace con 3 documentos del scraper + 1 manual bajo el mismo camino; otro con 2; otro sin documentos; y 3 intactos.
  const l3 = `${A}/seccion-tres/`; const l2 = `${A}/seccion-dos/`; const l0 = `${A}/seccion-cero/`; const lx = `${A}/seccion-intacta/`;
  for (const url of [l3, l2, l0, lx]) {
    const r = await tec.api("POST", "/scraper-links", { url, direction: "Ecosistemas", justification: "Sección de prueba", expectedListRevision: (await lista()).listRevision });
    assert.equal(r.status, 201, r.text);
  }
  const ids3 = [await md("s3-a", `${l3}a`), await md("s3-b", `${l3}b`), await md("s3-c", `${l3}c`)];
  const manual = await md("s3-manual", `${l3}manual`, "manual");
  const ids2 = [await md("s2-a", `${l2}a`), await md("s2-b", `${l2}b`)];
  const intactos = [await md("sx-a", `${lx}a`), await md("sx-b", `${lx}b`), await md("sx-c", `${lx}c`)];

  const e3 = (await lista()).items.find(i => i.url === l3)!;
  const quitaDirecta = await tec.api("DELETE", `/scraper-links/${e3.id}`, {
    direction: "Ecosistemas", justification: "Sección retirada", expectedRevision: e3.revision, expectedListRevision: (await lista()).listRevision });
  assert.equal(quitaDirecta.status, 200);
  assert.equal(quitaDirecta.json.documentosAfectados, 3);
  // Por aprobación de una propuesta.
  const pr = (await propuesta(gesA, { type: "remove", url: l2 })).json.id as string;
  assert.equal((await accion(tec, pr, "approve")).status, 200);
  // Sin documentos.
  const e0 = (await lista()).items.find(i => i.url === l0)!;
  const sin = await tec.api("DELETE", `/scraper-links/${e0.id}`, { direction: "Ecosistemas", justification: "Sin uso", expectedRevision: e0.revision, expectedListRevision: (await lista()).listRevision });
  assert.equal(sin.json.documentosAfectados, 0);

  const avisos = (await app.kb.query("SELECT objeto, descripcion, alcance, estado FROM kb.kb_notificacion WHERE tipo = 'fuente_retirada' ORDER BY objeto")).rows;
  assert.deepEqual(avisos.map(a => a.objeto), [l2, l3].sort(), "aviso en los dos casos con documentos y ninguno sin documentos");
  const d3 = avisos.find(a => a.objeto === l3)!.descripcion as string;
  assert.ok(d3.includes(l3) && /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(d3) && d3.includes("Técnico Enlaces"), d3);
  for (const clave of ["s3-a", "s3-b", "s3-c"]) assert.ok(d3.includes(clave));
  assert.ok(!d3.includes("s3-manual"));
  assert.ok(avisos.every(a => a.alcance === "sistema"), "invisible al Gestor (solo avisos de sistema)");

  // Siguen publicados; marca solo en los 5 afectados; el manual y los intactos no la tienen.
  const m = (await tec.api("GET", "/documents?limit=100")).json.items as Array<{ id: string; estado: string; sinActualizacionAutomatica: boolean }>;
  const f = (id: string) => m.find(d => d.id === id)!;
  for (const id of [...ids3, ...ids2]) { assert.equal(f(id).estado, "Publicado"); assert.equal(f(id).sinActualizacionAutomatica, true); }
  for (const id of [manual, ...intactos]) assert.equal(f(id).sinActualizacionAutomatica, false);

  // Revisar el aviso no quita la marca.
  await app.kb.query("UPDATE kb.kb_notificacion SET estado = 'revisada', revisada_en = now() WHERE tipo = 'fuente_retirada'");
  assert.equal(((await tec.api("GET", "/documents?limit=100")).json.items as Array<{ id: string; sinActualizacionAutomatica: boolean }>).find(d => d.id === ids3[0])!.sinActualizacionAutomatica, true);

  // Reagregar el enlace retira la marca de sus documentos.
  const re = await tec.api("POST", "/scraper-links", { url: l3, direction: "Ecosistemas", justification: "Se reactiva", expectedListRevision: (await lista()).listRevision });
  assert.equal(re.status, 201, re.text);
  const m2 = (await tec.api("GET", "/documents?limit=100")).json.items as Array<{ id: string; sinActualizacionAutomatica: boolean }>;
  for (const id of ids3) assert.equal(m2.find(d => d.id === id)!.sinActualizacionAutomatica, false);
  for (const id of ids2) assert.equal(m2.find(d => d.id === id)!.sinActualizacionAutomatica, true, "los de la otra sección siguen marcados");

  // Reemplazo: publicar una versión nueva retira la marca.
  const { rows: [v2] } = await app.kb.query(
    `INSERT INTO kb.kb_version (elemento_id, hash_contenido, contenido_md, fecha_acceso, origen) VALUES ($1,$2,'# s2-a\n\nContenido nuevo.',now(),'scraper') RETURNING id`,
    [ids2[0], randomUUID().replace(/-/g, "").padEnd(64, "1")]);
  await app.kb.query("UPDATE kb.kb_elemento SET version_pendiente_id = $2 WHERE id = $1", [ids2[0], v2.id]);
  await reconstruirColeccion(app.kb, "cli:prueba", { promover: ["s2-a"], embedder: embedderSintetico });
  const m3 = (await tec.api("GET", "/documents?limit=100")).json.items as Array<{ id: string; sinActualizacionAutomatica: boolean }>;
  assert.equal(m3.find(d => d.id === ids2[0])!.sinActualizacionAutomatica, false);
  assert.equal(m3.find(d => d.id === ids2[1])!.sinActualizacionAutomatica, true);
});

test("AD33/34: cada Gestor ve solo sus propuestas con los 5 datos; retirar solo la pendiente propia; lo ajeno no se revela", async () => {
  const pA1 = (await propuesta(gesA, { url: `${A}/a1/` })).json.id as string;
  const pA2 = (await propuesta(gesA, { url: `${A}/a2/` })).json.id as string;
  const pA3 = (await propuesta(gesA, { url: `${A}/a3/` })).json.id as string;
  const pA4 = (await propuesta(gesA, { url: `${A}/a4/` })).json.id as string;
  const pB = (await propuesta(gesB, { url: `${A}/b1/` })).json.id as string;
  assert.equal((await accion(tec, pA1, "approve")).status, 200);
  assert.equal((await accion(tec, pA2, "reject", { motivo: "Fuera de alcance" })).status, 200);

  const a = (await gesA.api("GET", "/link-proposals?limit=100")).json.items as Array<Record<string, unknown>>;
  const propiasA = a.filter(p => [pA1, pA2, pA3, pA4].includes(p.id as string));
  assert.equal(propiasA.length, 4);
  assert.ok(!a.some(p => p.id === pB), "no ve las de otros");
  const p2 = a.find(p => p.id === pA2)!;
  assert.deepEqual([p2.estado, p2.motivoRechazo], ["Rechazada", "Fuera de alcance"]);
  for (const p of propiasA) for (const campo of ["tipo", "url", "creadaEn", "estado", "direccion"]) assert.ok(p[campo], campo);
  const b = (await gesB.api("GET", "/link-proposals?limit=100")).json.items as Array<{ id: string }>;
  assert.deepEqual(b.map(p => p.id), [pB]);

  // Llamada directa a una ajena: no se revela (404) y no cambia.
  assert.equal((await accion(gesA, pB, "withdraw")).status, 404);
  assert.equal((await app.kb.query("SELECT state FROM kb.link_proposal WHERE id = $1", [pB])).rows[0].state, "Pendiente de validación");
  // Retirar aprobada y rechazada: rechazado.
  assert.equal((await accion(gesA, pA1, "withdraw")).status, 409);
  assert.equal((await accion(gesA, pA2, "withdraw")).status, 409);
  // Retirar la pendiente propia.
  const listaAntes = await firma();
  assert.equal((await accion(gesA, pA3, "withdraw")).status, 200);
  assert.equal((await app.kb.query("SELECT state FROM kb.link_proposal WHERE id = $1", [pA3])).rows[0].state, "Retirada");
  assert.equal(await firma(), listaAntes);
  const pendientes = (await tec.api("GET", "/link-proposals?state=Pendiente%20de%20validaci%C3%B3n&limit=100")).json.items as Array<{ id: string }>;
  assert.ok(!pendientes.some(p => p.id === pA3), "el administrador ya no la ve por validar");
  assert.ok(pendientes.some(p => p.id === pA4), "la otra pendiente sigue pendiente");
  // El técnico ve el propietario.
  assert.ok(pendientes[0]);
});
