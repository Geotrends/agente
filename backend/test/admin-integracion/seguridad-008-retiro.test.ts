/**
 * SPEC008 US3 (NV-07, NV-08, NV-09): retiros reanudables, cola que no se atasca y rechazo que no
 * borra la versión vigente. PostgreSQL y Qdrant reales; las fallas se inducen apuntando el cliente
 * de Qdrant a un puerto cerrado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { procesarCargasManuales } from "../../src/kb/manualUploads.js";
import { procesarOperaciones } from "../../src/kb/documentOperations.js";
import { resolverReferencia } from "../../src/kb/documentFiles.js";
import { hybridSearch } from "../../src/services/search.js";
import { crearPdf, RELLENO } from "./fixtures.js";
import { GESTOR, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

const SITIO = "https://ambientometroenvigado.com";
let app: AdminApp;
let tec: Session;
let ges: Session;
let n = 0;

test.before(async () => {
  app = await startAdminApp({ qdrant: true });
  await app.createAccount("tec.s008r@prueba.gov.co", TECNICO);
  await app.createAccount("ges.s008r@prueba.gov.co", GESTOR);
  tec = await app.login("tec.s008r@prueba.gov.co");
  ges = await app.login("ges.s008r@prueba.gov.co");
});
test.after(async () => { await app.close(); });

const meta = (url: string) => ({ type: "Documento", title: `Documento S008R ${++n}`, direction: "Ecosistemas", publicUrl: url, associatedProcedure: "ninguno" });
const urlNueva = () => `${SITIO}/s008r-${++n}-${Math.random().toString(36).slice(2, 8)}/`;

async function cargar(dato: string): Promise<{ id: string; revision: string; url: string }> {
  const url = urlNueva();
  const r = await tec.upload(meta(url), { bytes: crearPdf([RELLENO, dato]), name: "d.pdf" });
  assert.equal(r.status, 201, r.text);
  await procesarCargasManuales(app.kb);
  const m = (await tec.api("GET", "/documents?limit=200")).json.items as Array<{ id: string; revision: string }>;
  return { ...m.find(d => d.id === r.json.id)!, url };
}
async function publicado(dato: string): Promise<{ id: string; url: string }> {
  const d = await cargar(dato);
  assert.equal((await tec.api("POST", `/documents/${d.id}/publish`, { expectedRevision: d.revision })).status, 202);
  await procesarOperaciones(app.kb);
  return { id: d.id, url: d.url };
}
const revision = async (id: string) => String((await app.kb.query("SELECT revision::text AS r FROM kb.kb_elemento WHERE id = $1", [id])).rows[0].r);
const retirar = async (id: string) =>
  tec.api("POST", `/documents/${id}/withdraw`, { expectedRevision: await revision(id), motivo: "Prueba", confirmedDocumentId: id });
const operacion = async (id: string) => (await app.kb.query(
  "SELECT phase, error_code, cleanup_attempts, needs_attention, next_attempt_at, next_attempt_at > now() AS futura FROM kb.document_operation WHERE id = $1", [id])).rows[0];
const adelantar = (id: string) => app.kb.query("UPDATE kb.document_operation SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [id]);

async function conQdrantCaido<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.QDRANT_URL;
  process.env.QDRANT_URL = "http://127.0.0.1:9";
  const warn = console.error; console.error = () => {};
  try { return await fn(); } finally { process.env.QDRANT_URL = original; console.error = warn; }
}

test("NV-07: un fallo transitorio durante el retiro se reintenta, no queda terminal y el contenido no es recuperable", async () => {
  const p = await publicado("Dato RETIRO0901");
  const w = await retirar(p.id);
  assert.equal(w.status, 202, w.text);
  await conQdrantCaido(() => procesarOperaciones(app.kb));
  const o = await operacion(w.json.operationId);
  assert.notEqual(o.phase, "failed", "no es un fallo terminal");
  assert.equal(o.cleanup_attempts, 1);
  assert.equal(o.futura, true, "reintento programado");
  const e = (await app.kb.query("SELECT retirado_en FROM kb.kb_elemento WHERE id = $1", [p.id])).rows[0];
  assert.ok(e.retirado_en, "excluido de inmediato");
  const hits = (await hybridSearch("RETIRO0901 dato")).hits.filter(h => h.snippet.includes("RETIRO0901"));
  assert.equal(hits.length, 0, "no es recuperable por el ciudadano");

  await adelantar(w.json.operationId);
  await procesarOperaciones(app.kb);
  assert.equal((await operacion(w.json.operationId)).phase, "complete");
  assert.equal((await app.kb.query("SELECT 1 FROM kb.kb_elemento WHERE id = $1", [p.id])).rowCount, 0, "limpieza física terminada");
});

test("NV-07: al agotar los 5 reintentos rápidos pasa a «requiere atención» con un solo aviso y sigue reintentando con espera larga", async () => {
  const p = await publicado("Dato RETIRO0911");
  const w = await retirar(p.id);
  for (let i = 0; i < 6; i++) {
    await conQdrantCaido(() => procesarOperaciones(app.kb));
    await adelantar(w.json.operationId);
  }
  const o = await operacion(w.json.operationId);
  assert.equal(o.cleanup_attempts, 6);
  assert.equal(o.needs_attention, true);
  assert.notEqual(o.phase, "failed");
  const avisos = (await app.kb.query(
    "SELECT repeticiones FROM kb.kb_notificacion WHERE tipo = 'indexacion_fallida' AND objeto = $1", [`operacion:${w.json.operationId}`])).rows;
  assert.equal(avisos.length, 1, "un único aviso agrupado");
  // El 6.º fallo programa la espera larga (≈1 h), no la rápida.
  await conQdrantCaido(() => procesarOperaciones(app.kb));
  const largo = (await app.kb.query(
    "SELECT extract(epoch FROM next_attempt_at - now()) AS s FROM kb.document_operation WHERE id = $1", [w.json.operationId])).rows[0].s;
  assert.ok(Number(largo) > 3000 && Number(largo) <= 3600, `espera larga de ~1 h (fue ${largo}s)`);
  // El panel lo muestra y se puede reanudar de inmediato.
  const dto = await tec.api("GET", `/document-operations/${w.json.operationId}`);
  assert.equal(dto.json.requiereAtencion, true);
  assert.equal(dto.json.estado, "En curso");
  assert.ok(dto.json.proximoIntento);
  const r = await tec.api("POST", `/document-operations/${w.json.operationId}/resume`, {});
  assert.equal(r.status, 200, r.text);
  await procesarOperaciones(app.kb);
  assert.equal((await operacion(w.json.operationId)).phase, "complete");
});

test("NV-08: una operación en espera no bloquea la cola: la siguiente avanza", async () => {
  const x = await publicado("Dato COLA0921");
  const w = await retirar(x.id);
  await conQdrantCaido(() => procesarOperaciones(app.kb));
  assert.equal((await operacion(w.json.operationId)).futura, true);
  const y = await cargar("Dato COLA0922");
  const pub = await tec.api("POST", `/documents/${y.id}/publish`, { expectedRevision: y.revision });
  assert.equal(pub.status, 202, pub.text);
  await procesarOperaciones(app.kb);
  assert.equal((await operacion(pub.json.operationId)).phase, "complete", "la publicación posterior terminó");
  assert.notEqual((await operacion(w.json.operationId)).phase, "complete", "la que espera sigue pendiente");
});

test("resume: solo el técnico, y no sobre una operación terminada", async () => {
  const p = await publicado("Dato RESUME0931");
  const w = await retirar(p.id);
  await procesarOperaciones(app.kb);
  assert.equal((await operacion(w.json.operationId)).phase, "complete");
  assert.equal((await ges.api("POST", `/document-operations/${w.json.operationId}/resume`, {})).status, 403);
  assert.equal((await tec.api("POST", `/document-operations/${w.json.operationId}/resume`, {})).status, 409);
  assert.equal((await tec.api("POST", `/document-operations/00000000-0000-4000-8000-000000000000/resume`, {})).status, 404);
});

test("NV-09: rechazar con pendiente == publicada (derogado reactivado) no borra la versión vigente ni su archivo", async () => {
  const p = await publicado("Dato DEROGADO0941");
  const { rows: [antes] } = await app.kb.query(
    "SELECT e.version_publicada_id AS v, ver.archivo_ref FROM kb.kb_elemento e JOIN kb.kb_version ver ON ver.id = e.version_publicada_id WHERE e.id = $1", [p.id]);
  assert.ok(antes.archivo_ref);
  // Estado que produce el scraper al reactivar un derogado cuya huella no cambió.
  await app.kb.query("UPDATE kb.kb_elemento SET version_pendiente_id = version_publicada_id, estado = 'pendiente_aprobacion' WHERE id = $1", [p.id]);
  const rev = await revision(p.id);
  const r = await tec.api("POST", `/documents/${p.id}/reject`, { expectedRevision: rev, motivo: "Prueba" });
  assert.equal(r.status, 202, r.text);
  await procesarOperaciones(app.kb);
  const { rows: [despues] } = await app.kb.query("SELECT version_publicada_id, version_pendiente_id FROM kb.kb_elemento WHERE id = $1", [p.id]);
  assert.equal(despues.version_publicada_id, antes.v, "la versión publicada sigue referenciada");
  assert.equal(despues.version_pendiente_id, null);
  assert.equal((await app.kb.query("SELECT 1 FROM kb.kb_version WHERE id = $1", [antes.v])).rowCount, 1, "la versión existe");
  await fs.stat(resolverReferencia(antes.archivo_ref));
});

test("NV-09: no se puede borrar directamente la versión que es la publicada de un elemento", async () => {
  const p = await publicado("Dato RESTRICT0951");
  const { rows: [e] } = await app.kb.query("SELECT version_publicada_id AS v FROM kb.kb_elemento WHERE id = $1", [p.id]);
  await assert.rejects(app.kb.query("DELETE FROM kb.kb_version WHERE id = $1", [e.v]), /version_publicada_fk|viola|violates/);
  // El retiro (que borra el elemento y sus versiones) sigue funcionando con la FK en RESTRICT.
  const w = await retirar(p.id);
  await procesarOperaciones(app.kb);
  assert.equal((await operacion(w.json.operationId)).phase, "complete");
});
