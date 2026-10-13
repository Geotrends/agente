/**
 * US2 · Protocolo de publicación (R04): fases durables, reinicios, idempotencia, concurrencia,
 * alias como espejo y validación SQL por consulta. PostgreSQL y Qdrant reales.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { orchestrate, ChatFailure } from "../../src/chat/orchestrator.js";
import { procesarCargasManuales } from "../../src/kb/manualUploads.js";
import { procesarOperaciones } from "../../src/kb/documentOperations.js";
import { reconciliarAlias } from "../../src/kb/publicationManifest.js";
import { crearColeccion } from "../../src/kb/indexer.js";
import { aliasKb, coleccionDelAlias, qdrant } from "../../src/services/qdrant.js";
import { hybridSearch } from "../../src/services/search.js";
import { crearPdf, RELLENO } from "./fixtures.js";
import { startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

const SITIO = "https://ambientometroenvigado.com";
let app: AdminApp;
let tec: Session;
let n = 0;

test.before(async () => {
  app = await startAdminApp({ qdrant: true });
  await app.createAccount("tec.pub@prueba.gov.co", TECNICO);
  tec = await app.login("tec.pub@prueba.gov.co");
});
test.after(async () => { await app.close(); });

const meta = (over: Record<string, unknown> = {}) => ({
  type: "Documento", title: `Documento ${++n}`, direction: "Ecosistemas", publicUrl: `${SITIO}/pub-${n}/`, associatedProcedure: "ninguno", ...over,
});
async function cargarProcesado(dato: string, over: Record<string, unknown> = {}): Promise<{ id: string; revision: string }> {
  const r = await tec.upload(meta(over), { bytes: crearPdf([RELLENO, dato]), name: "d.pdf" });
  assert.equal(r.status, 201, r.text);
  await procesarCargasManuales(app.kb);
  const m = (await tec.api("GET", "/documents?limit=100")).json.items as Array<{ id: string; revision: string }>;
  return m.find(d => d.id === r.json.id)!;
}
const publicar = (id: string, revision: string, key?: string) =>
  tec.api("POST", `/documents/${id}/publish`, { expectedRevision: revision }, key ? { "idempotency-key": key } : {});
const activa = async () => (await app.kb.query("SELECT collection_name, generation_id, revision::int AS rev, manifest_hash FROM kb.active_generation")).rows[0];
const op = async (id: string) => (await app.kb.query("SELECT * FROM kb.document_operation WHERE id = $1", [id])).rows[0];

test("la generación activa y el manifiesto son la autoridad; el alias es un espejo reconciliable", async () => {
  const a = await cargarProcesado("Dato MANIFIESTO1101.");
  const p = await publicar(a.id, a.revision);
  await procesarOperaciones(app.kb);
  const g = await activa();
  assert.equal(await coleccionDelAlias(), g.collection_name, "el alias refleja la generación activa");
  const manifiesto = (await app.kb.query("SELECT element_id, version_id FROM kb.generation_manifest WHERE generation_id = $1", [g.generation_id])).rows;
  const pub = (await app.kb.query("SELECT id, version_publicada_id FROM kb.kb_elemento WHERE estado = 'publicado'")).rows;
  assert.deepEqual(manifiesto.map(m => `${m.element_id}:${m.version_id}`).sort(), pub.map(e => `${e.id}:${e.version_publicada_id}`).sort());
  assert.equal((await op(p.json.operationId)).phase, "complete");

  // Si el alias apunta a otra colección, la consulta NO lo sigue: lee la generación activa.
  const vacia = `${aliasKb()}_vacia`;
  await crearColeccion(vacia);
  await qdrant().updateCollectionAliases({ actions: [{ delete_alias: { alias_name: aliasKb() } }, { create_alias: { collection_name: vacia, alias_name: aliasKb() } }] as never });
  const r = await hybridSearch("MANIFIESTO1101 dato");
  assert.ok(r.hits.some(h => h.snippet.includes("MANIFIESTO1101")), "sigue sirviendo la generación activa");
  // Reconciliación idempotente: devuelve el alias a la generación activa.
  assert.equal(await reconciliarAlias(app.kb, aliasKb()), "movido");
  assert.equal(await reconciliarAlias(app.kb, aliasKb()), "ok");
  assert.equal(await coleccionDelAlias(), g.collection_name);
  await qdrant().deleteCollection(vacia);
});

test("reinicio durante la preparación: la candidata parcial se elimina y se verifica antes del reintento", async () => {
  const a = await cargarProcesado("Dato REINICIOPREP2201.");
  const p = await publicar(a.id, a.revision);
  const parcial = `${aliasKb()}_parcial_${randomUUID().slice(0, 8)}`;
  await crearColeccion(parcial);
  // Simula un worker caído a mitad de la preparación (intento 1 consumido).
  await app.kb.query(
    "UPDATE kb.document_operation SET phase = 'preparing', attempts = 1, candidate_collection = $2, started_at = now() WHERE id = $1",
    [p.json.operationId, parcial]);
  await procesarOperaciones(app.kb);
  const o = await op(p.json.operationId);
  assert.equal(o.phase, "complete");
  assert.equal(o.attempts, 2, "la preparación interrumpida cuenta como intento");
  const { collections } = await qdrant().getCollections();
  assert.ok(!collections.some(c => c.name === parcial), "candidata parcial eliminada");
  const recibo = (await app.kb.query("SELECT verified_absent FROM kb.cleanup_receipt WHERE operation_id = $1 AND object_ref = $2", [p.json.operationId, parcial])).rows;
  assert.deepEqual(recibo.map(r => r.verified_absent), [true]);
});

test("reinicio después del commit: reconcilia el alias, limpia la colección anterior y termina sin repetir la indexación", async () => {
  const a = await cargarProcesado("Dato REINICIOCOMMIT3301.");
  const p = await publicar(a.id, a.revision);
  await procesarOperaciones(app.kb);
  const g = await activa();
  // Estado de un worker que murió tras el commit: colección anterior sin limpiar y alias desfasado.
  const previa = `${aliasKb()}_previa_${randomUUID().slice(0, 8)}`;
  await crearColeccion(previa);
  await app.kb.query(
    "UPDATE kb.document_operation SET phase = 'cleaning', finished_at = NULL, previous_collection = $2, cleanup_pending = true, error_code = 'limpieza_pendiente' WHERE id = $1",
    [p.json.operationId, previa]);
  await qdrant().updateCollectionAliases({ actions: [{ delete_alias: { alias_name: aliasKb() } }, { create_alias: { collection_name: previa, alias_name: aliasKb() } }] as never });
  const intentos = (await op(p.json.operationId)).attempts;
  await procesarOperaciones(app.kb);
  const o = await op(p.json.operationId);
  assert.equal(o.phase, "complete");
  assert.equal(o.attempts, intentos, "no se vuelve a indexar");
  assert.equal(await coleccionDelAlias(), g.collection_name);
  const { collections } = await qdrant().getCollections();
  assert.ok(!collections.some(c => c.name === previa));
  assert.ok(collections.some(c => c.name === g.collection_name), "la activa nunca se borra");
});

test("idempotencia: misma clave y cuerpo → misma operación; otro cuerpo → 409; dos reindexaciones simultáneas → una 202 y una 409", async () => {
  const a = await cargarProcesado("Dato IDEMPOTENTE4401.");
  const k = `clave-${randomUUID()}`;
  const p1 = await publicar(a.id, a.revision, k);
  const p2 = await publicar(a.id, a.revision, k);
  assert.equal(p1.status, 202);
  assert.equal(p2.status, 202);
  assert.equal(p2.json.operationId, p1.json.operationId);
  assert.equal(Number((await app.kb.query("SELECT count(*) FROM kb.document_operation WHERE element_id = $1", [a.id])).rows[0].count), 1);
  const otro = await tec.api("POST", `/documents/${a.id}/reject`, { expectedRevision: a.revision, motivo: "x" }, { "idempotency-key": k });
  assert.equal(otro.status, 409);
  // Otra publicación del mismo documento mientras hay una activa.
  const mismo = await publicar(a.id, a.revision);
  assert.equal(mismo.status, 409);
  assert.equal(mismo.json.error.codigo, "OPERACION_EN_CURSO");
  await procesarOperaciones(app.kb);

  const rs = await Promise.all([tec.api("POST", "/reindexations", {}), tec.api("POST", "/reindexations", {})]);
  assert.deepEqual(rs.map(r => r.status).sort(), [202, 409]);
  await procesarOperaciones(app.kb);
});

test("una revisión obsoleta o un documento sin candidata no encola nada", async () => {
  const a = await cargarProcesado("Dato OBSOLETO5501.");
  const antes = Number((await app.kb.query("SELECT count(*) FROM kb.document_operation")).rows[0].count);
  assert.equal((await publicar(a.id, "999")).status, 409);
  assert.equal((await tec.api("POST", `/documents/${randomUUID()}/publish`, { expectedRevision: "1" })).status, 404);
  assert.equal((await tec.api("POST", `/documents/${a.id}/publish`, { expectedRevision: a.revision, force: true })).status, 422, "claves desconocidas (force) rechazadas");
  assert.equal((await tec.api("POST", `/documents/${a.id}/withdraw`, { expectedRevision: a.revision, motivo: "x", confirmedDocumentId: a.id })).status, 409, "no está publicado");
  assert.equal(Number((await app.kb.query("SELECT count(*) FROM kb.document_operation")).rows[0].count), antes);
  // Sin procesar: no es publicable todavía.
  const r = await tec.upload(meta(), { bytes: crearPdf([RELLENO, "Dato EN COLA"]), name: "d.pdf" });
  const enCola = (await tec.api("GET", "/documents?limit=100")).json.items.find((d: { id: string }) => d.id === r.json.id);
  const np = await publicar(enCola.id, enCola.revision);
  assert.equal(np.status, 409);
  assert.equal(np.json.error.codigo, "NO_PUBLICABLE");
  await procesarCargasManuales(app.kb);
});

test("lo retirado o vencido que quedó en la colección no se recupera (validación SQL por consulta)", async () => {
  const a = await cargarProcesado("Dato RESIDUAL6601 de prueba.");
  const p = await publicar(a.id, a.revision);
  await procesarOperaciones(app.kb);
  assert.ok((await hybridSearch("RESIDUAL6601")).hits.some(h => h.snippet.includes("RESIDUAL6601")));
  // Exclusión inmediata por SQL, sin tocar Qdrant (simula la ventana antes de la limpieza física).
  await app.kb.query("UPDATE kb.kb_elemento SET retirado_en = now() WHERE id = $1", [a.id]);
  assert.equal((await hybridSearch("RESIDUAL6601")).hits.filter(h => h.snippet.includes("RESIDUAL6601")).length, 0);
  assert.ok(p.json.operationId);
  await app.kb.query("UPDATE kb.kb_elemento SET retirado_en = NULL WHERE id = $1", [a.id]);
  // Versión distinta de la publicada (punto huérfano de una generación anterior).
  await app.kb.query("UPDATE kb.kb_version SET id = id WHERE id = (SELECT version_publicada_id FROM kb.kb_elemento WHERE id = $1)", [a.id]);
  const { rows: [v] } = await app.kb.query(
    `INSERT INTO kb.kb_version (elemento_id, hash_contenido, contenido_md, fecha_acceso) VALUES ($1, $2, 'otro', now()) RETURNING id`, [a.id, "f".repeat(64)]);
  const viejaId = (await app.kb.query("SELECT version_publicada_id FROM kb.kb_elemento WHERE id = $1", [a.id])).rows[0].version_publicada_id;
  await app.kb.query("UPDATE kb.kb_elemento SET version_publicada_id = $2 WHERE id = $1", [a.id, v.id]);
  assert.equal((await hybridSearch("RESIDUAL6601")).hits.filter(h => h.snippet.includes("RESIDUAL6601")).length, 0, "punto de otra versión: no se sirve");
  await app.kb.query("UPDATE kb.kb_elemento SET version_publicada_id = $2 WHERE id = $1", [a.id, viejaId]);
  assert.ok((await hybridSearch("RESIDUAL6601")).hits.some(h => h.snippet.includes("RESIDUAL6601")));
});

test("sin poder validar en SQL la consulta falla (indisponibilidad), nunca responde «sin información»", async () => {
  const { ponerLectorManifiestoParaPruebas } = await import("../../src/services/manifest.js");
  const pg = (await import("pg")).default;
  const caida = new pg.Pool({ connectionString: "postgres://x:y@127.0.0.1:1/nada", max: 1, connectionTimeoutMillis: 300 });
  caida.on("error", () => {});
  ponerLectorManifiestoParaPruebas(caida);
  try {
    await assert.rejects(hybridSearch("cualquier cosa"), /no está disponible/);
  } finally {
    ponerLectorManifiestoParaPruebas(undefined);
    await caida.end().catch(() => {});
  }
});

test("revalidación antes de entregar: si la evidencia cambió se busca una vez más; si vuelve a cambiar, error seguro", async () => {
  const contactos = {
    revision: 1, recepcion: { pqrsd: "https://p.gov.co", whatsapp: "+57 300", email: "a@b.co" },
    general: { phone: "1", email: "a@b.co", url: "https://p.gov.co" },
    inmediatos: [{ name: "Emergencias", description: "24 h", type: "teléfono", value: "123" }],
  } as never;
  const hit = { path: "https://x.gov.co/a", snippet: "Texto citable", sourceUrl: "https://x.gov.co/a", fechaActualizacion: "2026-01-01", documentId: "doc-1", versionId: "v1", title: "Doc" };
  const base = (revalidate: (h: unknown[]) => Promise<boolean>) => {
    let busquedas = 0; let modelos = 0;
    return {
      cuentas: () => ({ busquedas, modelos }),
      deps: {
        retrieve: async () => { busquedas++; return { hits: [hit] }; },
        contacts: async () => contactos,
        model: async () => { modelos++; return { text: "Respuesta con base [D1].\n<!--FUENTES: D1-->", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", effectiveModel: "m" } as never; },
        revalidate: revalidate as never,
      },
    };
  };
  const input = { pregunta: "¿Cuál es el plazo del trámite?", historial: [], categoria: undefined } as never;

  let llamadas = 0;
  const unaVez = base(async () => ++llamadas > 1);
  const ok = await orchestrate(input, unaVez.deps);
  assert.equal(ok.tipo, "respondida");
  assert.deepEqual(unaVez.cuentas(), { busquedas: 2, modelos: 2 });

  const siempre = base(async () => false);
  await assert.rejects(orchestrate(input, siempre.deps), (e: unknown) => e instanceof ChatFailure && e.kind === "busqueda_fallida");
  assert.deepEqual(siempre.cuentas(), { busquedas: 2, modelos: 2 });

  const normal = base(async () => true);
  await orchestrate(input, normal.deps);
  assert.deepEqual(normal.cuentas(), { busquedas: 1, modelos: 1 });
  void fs; void path;
});
