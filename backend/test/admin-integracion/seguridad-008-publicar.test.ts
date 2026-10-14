/**
 * SPEC008 US2 (NV-02, NV-03, NV-10): la publicación promueve exactamente la versión aprobada y
 * una carga recibida durante la operación se aplaza. PostgreSQL y Qdrant reales.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { procesarCargasManuales } from "../../src/kb/manualUploads.js";
import { procesarOperaciones } from "../../src/kb/documentOperations.js";
import { resolverReferencia } from "../../src/kb/documentFiles.js";
import { embed } from "../../src/services/embeddings.js";
import { hybridSearch } from "../../src/services/search.js";
import { crearPdf, RELLENO } from "./fixtures.js";
import { startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

const SITIO = "https://ambientometroenvigado.com";
let app: AdminApp;
let tec: Session;
let n = 0;

test.before(async () => {
  app = await startAdminApp({ qdrant: true });
  await app.createAccount("tec.s008p@prueba.gov.co", TECNICO);
  tec = await app.login("tec.s008p@prueba.gov.co");
});
test.after(async () => { await app.close(); });

const meta = (url: string, over: Record<string, unknown> = {}) => ({
  type: "Documento", title: `Documento S008 ${++n}`, direction: "Ecosistemas", publicUrl: url, associatedProcedure: "ninguno", ...over,
});
const urlNueva = () => `${SITIO}/s008-${++n}-${Math.random().toString(36).slice(2, 8)}/`;

async function cargar(url: string, dato: string): Promise<{ id: string; revision: string }> {
  const r = await tec.upload(meta(url), { bytes: crearPdf([RELLENO, dato]), name: "d.pdf" });
  assert.equal(r.status, 201, r.text);
  await procesarCargasManuales(app.kb);
  const m = (await tec.api("GET", "/documents?limit=200")).json.items as Array<{ id: string; revision: string }>;
  return m.find(d => d.id === r.json.id)!;
}
const publicar = (id: string, revision: string) => tec.api("POST", `/documents/${id}/publish`, { expectedRevision: revision });
const elemento = async (id: string) => (await app.kb.query(
  `SELECT e.version_publicada_id, e.version_pendiente_id, e.version_aplazada_id, e.estado, e.revision::int AS rev
     FROM kb.kb_elemento e WHERE e.id = $1`, [id])).rows[0];
const operacion = async (id: string) => (await app.kb.query("SELECT * FROM kb.document_operation WHERE id = $1", [id])).rows[0];
const hashDe = async (versionId: string) => (await app.kb.query("SELECT hash_contenido FROM kb.kb_version WHERE id = $1", [versionId])).rows[0]?.hash_contenido as string | undefined;

/** Publica una primera versión y deja el documento vigente. */
async function publicado(dato: string): Promise<{ id: string; url: string; v1: string }> {
  const url = urlNueva();
  const d = await cargar(url, dato);
  assert.equal((await publicar(d.id, d.revision)).status, 202);
  await procesarOperaciones(app.kb);
  const e = await elemento(d.id);
  assert.equal(e.estado, "publicado");
  return { id: d.id, url, v1: e.version_publicada_id };
}

test("NV-02: una carga recibida con la publicación en cola se aplaza y no cambia el objetivo", async () => {
  const p = await publicado("Dato VIGENTE0801");
  const a = await cargar(p.url, "Dato APROBADA0802");
  const ea = await elemento(p.id);
  const objetivo = ea.version_pendiente_id as string;
  const pub = await publicar(p.id, String(ea.rev));
  assert.equal(pub.status, 202, pub.text);
  assert.equal((await operacion(pub.json.operationId)).target_version_id, objetivo, "objetivo fijado al encolar");

  // Llega otra versión mientras la operación está en curso (carga manual al mismo documento).
  const b = await tec.upload(meta(p.url), { bytes: crearPdf([RELLENO, "Dato NOAPROBADA0803"]), name: "d2.pdf" });
  assert.equal(b.status, 201, b.text);
  const durante = await elemento(p.id);
  assert.equal(durante.version_pendiente_id, objetivo, "el objetivo no cambia");
  assert.ok(durante.version_aplazada_id, "la nueva versión quedó aplazada");

  await procesarOperaciones(app.kb);
  const fin = await elemento(p.id);
  assert.equal(fin.version_publicada_id, objetivo, "se publicó exactamente la aprobada");
  assert.equal(fin.version_pendiente_id, durante.version_aplazada_id, "la aplazada pasa a pendiente al terminar");
  assert.equal(fin.version_aplazada_id, null);
  assert.equal((await operacion(pub.json.operationId)).phase, "complete");
  assert.notEqual(await hashDe(fin.version_pendiente_id), await hashDe(fin.version_publicada_id), "no se publicó sin nueva aprobación");
  void a;
});

test("NV-02: si el pendiente cambió por un camino que no pasa por la carga, la operación falla sin tocar lo vigente", async () => {
  const p = await publicado("Dato VIGENTE0811");
  await cargar(p.url, "Dato APROBADA0812");
  const e0 = await elemento(p.id);
  const pub = await publicar(p.id, String(e0.rev));
  // Simula el scraper: cambia el pendiente directamente (sin respetar el aplazamiento).
  const { rows: [v] } = await app.kb.query(
    `INSERT INTO kb.kb_version (elemento_id, hash_contenido, hash_original, contenido_md, fecha_acceso, origen, estado_tecnico)
     VALUES ($1, repeat('b', 64), repeat('b', 64), 'contenido nuevo no aprobado', now(), 'scraper', 'procesado') RETURNING id`, [p.id]);
  await app.kb.query("UPDATE kb.kb_elemento SET version_pendiente_id = $2 WHERE id = $1", [p.id, v.id]);

  await procesarOperaciones(app.kb);
  const o = await operacion(pub.json.operationId);
  assert.equal(o.phase, "failed");
  assert.equal(o.error_code, "candidata_cambiada");
  const e = await elemento(p.id);
  assert.equal(e.version_publicada_id, p.v1, "la vigente se conserva");
  assert.equal(e.version_pendiente_id, v.id, "lo no aprobado sigue pendiente, sin publicarse");
  const r = await hybridSearch("VIGENTE0811 dato");
  assert.ok(r.hits.some(h => h.snippet.includes("VIGENTE0811")), "sigue respondiendo con la versión vigente");
});

test("NV-03: un candidato sin procesar no se promueve ni retira la vigente del índice", async () => {
  const p = await publicado("Dato VIGENTE0821");
  const c = await cargar(p.url, "Dato CANDIDATA0822");
  const e0 = await elemento(p.id);
  const pub = await publicar(p.id, String(e0.rev));
  // Entre la aprobación y el commit, el candidato vuelve a la cola (p. ej. reprocesado).
  await app.kb.query("UPDATE kb.kb_version SET estado_tecnico = 'en_cola', contenido_md = '' WHERE id = $1", [e0.version_pendiente_id]);

  await procesarOperaciones(app.kb);
  const o = await operacion(pub.json.operationId);
  assert.equal(o.phase, "failed");
  assert.equal(o.error_code, "candidata_cambiada");
  const e = await elemento(p.id);
  assert.equal(e.version_publicada_id, p.v1, "la vigente sigue publicada");
  assert.equal(e.estado, "publicado");
  const r = await hybridSearch("VIGENTE0821 dato");
  assert.ok(r.hits.some(h => h.snippet.includes("VIGENTE0821")), "y sigue indexada");
  void c;
});

test("NV-10: si el candidato desaparece a mitad de la operación, no se borran los archivos de la vigente", async () => {
  const p = await publicado("Dato VIGENTE0831");
  const { rows: [v1] } = await app.kb.query("SELECT archivo_ref FROM kb.kb_version WHERE id = $1", [p.v1]);
  assert.ok(v1.archivo_ref, "la vigente conserva su archivo original");
  await cargar(p.url, "Dato CANDIDATA0832");
  const e0 = await elemento(p.id);
  const pub = await publicar(p.id, String(e0.rev));

  // El candidato se limpia (como si el scraper detectara el mismo contenido que el publicado) durante la preparación.
  let limpiado = false;
  const embedder = async (t: string[], tipo: "query" | "passage") => {
    if (!limpiado) {
      limpiado = true;
      await app.kb.query("UPDATE kb.kb_elemento SET version_pendiente_id = NULL WHERE id = $1", [p.id]);
      await app.kb.query("DELETE FROM kb.kb_version WHERE id = $1", [e0.version_pendiente_id]);
    }
    return embed(t, tipo);
  };
  await procesarOperaciones(app.kb, { embedder });
  const o = await operacion(pub.json.operationId);
  assert.notEqual(o.phase, "complete", "no se declara terminada una publicación que no promovió nada");
  const e = await elemento(p.id);
  assert.equal(e.version_publicada_id, p.v1);
  await fs.stat(resolverReferencia(v1.archivo_ref)); // lanza si el archivo fue borrado
});

test("SC-002 (muestra de 8 ejecuciones): carga concurrente durante la publicación nunca promueve otra versión", async () => {
  for (let i = 0; i < 8; i++) {
    const p = await publicado(`Dato CARRERAV${i}A`);
    await cargar(p.url, `Dato CARRERAAPROBADA${i}`);
    const e0 = await elemento(p.id);
    const objetivo = e0.version_pendiente_id as string;
    const pub = await publicar(p.id, String(e0.rev));
    assert.equal(pub.status, 202, pub.text);
    // La carga y el worker corren a la vez.
    await Promise.all([
      tec.upload(meta(p.url), { bytes: crearPdf([RELLENO, `Dato CARRERAOTRA${i}`]), name: "o.pdf" }),
      procesarOperaciones(app.kb),
    ]);
    const o = await operacion(pub.json.operationId);
    const e = await elemento(p.id);
    if (o.phase === "complete") assert.equal(e.version_publicada_id, objetivo, `iteración ${i}: se publicó la aprobada`);
    else assert.equal(e.version_publicada_id, p.v1, `iteración ${i}: la vigente se conserva`);
    assert.ok(e.version_publicada_id, "nunca queda el documento sin versión publicada");
    await procesarOperaciones(app.kb); // por si la carga quedó aplazada tras la operación
  }
});
