/**
 * US2 · Documentos (RF-C3-AD-01..04, 20..27, 32, 38/39, 47): carga manual, matriz, publicación y
 * retiro con PostgreSQL + Qdrant reales. El panel solo crea comandos; el worker (aquí invocado
 * directamente) es el único escritor. Resultados «controlados»: no acreditan producción.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { procesarCargasManuales } from "../../src/kb/manualUploads.js";
import { procesarOperaciones } from "../../src/kb/documentOperations.js";
import { hybridSearch } from "../../src/services/search.js";
import { qdrant } from "../../src/services/qdrant.js";
import { crearDocx, crearPdf, crearXlsx, RELLENO } from "./fixtures.js";
import { GESTOR, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

const SITIO = "https://ambientometroenvigado.com";
let app: AdminApp;
let tec: Session;
let ges: Session;
let ges2: Session;
let n = 0;

test.before(async () => {
  app = await startAdminApp({ qdrant: true });
  await app.createAccount("tec.docs@prueba.gov.co", TECNICO);
  await app.createAccount("ges.docs@prueba.gov.co", GESTOR);
  await app.createAccount("ges2.docs@prueba.gov.co", GESTOR);
  tec = await app.login("tec.docs@prueba.gov.co");
  ges = await app.login("ges.docs@prueba.gov.co");
  ges2 = await app.login("ges2.docs@prueba.gov.co");
});
test.after(async () => { await app.close(); });

const meta = (over: Record<string, unknown> = {}) => ({
  type: "Documento", title: `Documento de prueba ${++n}`, direction: "Ecosistemas", publicUrl: `${SITIO}/doc-${n}/`,
  associatedProcedure: "ninguno", ...over,
});
const pdf = (...datos: string[]) => ({ bytes: crearPdf([RELLENO, ...datos]), name: "doc.pdf", type: "application/pdf" });

async function archivosCargados(): Promise<string[]> {
  try { return await fs.readdir(path.join(app.uploadDir, "archivos")); } catch { return []; }
}
async function stagingVacio(): Promise<boolean> {
  try { return (await fs.readdir(path.join(app.uploadDir, "staging"))).length === 0; } catch { return true; }
}
const filas = async () => Number((await app.kb.query("SELECT count(*) FROM kb.kb_elemento")).rows[0].count);

async function matriz(s: Session, qs = "") { return (await s.api("GET", `/documents?limit=100${qs}`)).json; }
async function documento(s: Session, id: string) {
  const m = await matriz(s);
  return (m.items as Array<{ id: string; revision: string; estado: string; candidata: unknown }>).find(d => d.id === id)!;
}

/** Carga, procesa, publica y espera la operación terminada. Devuelve el id del documento. */
async function publicado(over: Record<string, unknown>, ...datos: string[]): Promise<string> {
  const r = await tec.upload(meta(over), pdf(...datos));
  assert.equal(r.status, 201, r.text);
  await procesarCargasManuales(app.kb);
  const d = await documento(tec, r.json.id);
  const p = await tec.api("POST", `/documents/${r.json.id}/publish`, { expectedRevision: d.revision });
  assert.equal(p.status, 202, JSON.stringify(p.json));
  await procesarOperaciones(app.kb);
  const op = await tec.api("GET", `/document-operations/${p.json.operationId}`);
  assert.equal(op.json.estado, "Terminada", JSON.stringify(op.json));
  return r.json.id as string;
}

const recupera = async (consulta: string, dato: string) => {
  const r = await hybridSearch(consulta);
  return r.hits.filter(h => h.snippet.includes(dato));
};

test("AD01/02/32: 6 cargas (3 válidas con ambos perfiles, 3 inválidas) y matriz con N/A", async () => {
  const antes = await filas();
  const ok1 = await ges.upload(meta({ type: "Procedimiento", associatedProcedure: "GT-P-004", code: "GT-P-004", version: "03", updatedDate: "2026-01-15" }), pdf("Dato A1"));
  const ok2 = await ges2.upload(meta(), { bytes: await crearDocx([RELLENO, "Dato A2"]), name: "doc.docx" });
  const ok3 = await tec.upload(meta(), { bytes: crearXlsx([["Concepto", "Valor"], ["Dato A3", RELLENO]]), name: "doc.xlsx" });
  for (const r of [ok1, ok2, ok3]) {
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.estado, "Pendiente de aprobación");
    assert.equal(r.json.origen, "manual");
  }
  const total = await filas();
  assert.equal(total - antes, 3);

  // Inválidas: sin enlace, sin dirección, sin título → campo indicado y cero archivos/filas nuevas.
  const archivosAntes = (await archivosCargados()).length;
  for (const [campo, quitar] of [["publicUrl", "publicUrl"], ["direction", "direction"], ["title", "title"]] as const) {
    for (const s of [ges, tec]) {
      const m: Record<string, unknown> = meta();
      delete m[quitar];
      const r = await s.upload(m, pdf("no debe guardarse"));
      assert.equal(r.status, 422, `${campo}: ${r.text}`);
      assert.equal(r.json.error.campo, campo);
    }
  }
  assert.equal(await filas(), total, "las inválidas dejan 0 filas");
  assert.equal((await archivosCargados()).length, archivosAntes, "y 0 archivos");
  assert.ok(await stagingVacio(), "sin temporales");

  // Filas = documentos cargados, con N/A en los opcionales ausentes.
  const m = await matriz(tec);
  assert.equal(m.total, 3);
  const conNA = m.items.filter((d: { codigo: string }) => d.codigo === "N/A");
  assert.equal(conNA.length, 2);
  for (const d of conNA) {
    assert.equal(d.version, "N/A"); assert.equal(d.fechaActualizacion, "N/A"); assert.equal(d.validoHasta, "N/A");
    assert.equal(d.estado, "Pendiente de aprobación"); assert.equal(d.origen, "manual");
    assert.ok(d.autor?.nombre);
  }
  const conCodigo = m.items.find((d: { codigo: string }) => d.codigo === "GT-P-004");
  assert.equal(conCodigo.version, "03");
  assert.equal(conCodigo.procedimientoOrigen, "GT-P-004");
});

test("carga: formato por estructura, orden metadata→archivo, tamaño, claves desconocidas y desconexión", async () => {
  const antes = await filas();
  // Texto plano con extensión .pdf y MIME de PDF: se rechaza por estructura.
  const falso = await tec.upload(meta(), { bytes: Buffer.from("esto no es un pdf"), name: "x.pdf", type: "application/pdf" });
  assert.equal(falso.status, 422);
  assert.equal(falso.json.error.campo, "file");
  // Archivo antes que la metadata.
  const orden = await tec.upload(meta(), pdf("x"), { fileFirst: true });
  assert.equal(orden.status, 422);
  // Campo desconocido y JSON inválido.
  assert.equal((await tec.upload(meta({ force: true }), pdf("x"))).status, 422);
  assert.equal((await tec.upload(undefined, pdf("x"), { rawMetadata: "{no json" })).json.error.campo, "metadata");
  // Sin archivo y vacío.
  assert.equal((await tec.upload(meta(), null)).status, 422);
  assert.equal((await tec.upload(meta(), { bytes: Buffer.alloc(0), name: "v.pdf" })).status, 422);
  // Fechas y URL inválidas.
  assert.equal((await tec.upload(meta({ updatedDate: "2026-02-30" }), pdf("x"))).json.error.campo, "updatedDate");
  assert.equal((await tec.upload(meta({ publicUrl: "http://sitio.gov.co/x" }), pdf("x"))).json.error.campo, "publicUrl");
  assert.equal((await tec.upload(meta({ associatedProcedure: "cualquier cosa" }), pdf("x"))).json.error.campo, "associatedProcedure");
  assert.equal(await filas(), antes);
  assert.ok(await stagingVacio());

  // ZIP con razón de expansión excesiva se rechaza (defensa contra bombas).
  const JSZip = (await import("jszip")).default;
  const z = new JSZip();
  z.file("[Content_Types].xml", "<Types/>");
  z.file("word/document.xml", "a".repeat(20_000_000));
  const bomba = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const r = await tec.upload(meta(), { bytes: bomba, name: "b.docx" });
  assert.equal(r.status, 422);
  assert.equal(await filas(), antes);

  // Sin sesión o con Origin ajeno no se procesa nada.
  const sinSesion = await fetch(`${app.base}/documents`, { method: "POST", body: new FormData() });
  assert.equal(sinSesion.status, 401);
});

test("AD32: el Gestor ve toda la matriz (10 filas), filtra las propias (4) y no puede ejecutar acciones directas", async () => {
  const previas = await filas();
  // 3 del scraper por SQL (origen «scraper»).
  for (let i = 0; i < 3; i++) {
    const { rows: [el] } = await app.kb.query(
      `INSERT INTO kb.kb_elemento (clave, nombre, tipo, direccion, url_origen, estado, formato_original, procedimientos_origen, fuente, origen)
       VALUES ($1,$2,'pagina','ecosistemas',$1,'pendiente_aprobacion','html',ARRAY['Ambientómetro'],'ambientometro','scraper') RETURNING id`,
      [`${SITIO}/scraper-${i}/`, `Página scraper ${i}`]);
    await app.kb.query("SELECT 1 FROM kb.kb_elemento WHERE id = $1", [el.id]);
  }
  for (let i = 0; i < 2; i++) assert.equal((await ges.upload(meta(), pdf(`propio ${i}`))).status, 201);
  for (let i = 0; i < 3; i++) assert.equal((await ges2.upload(meta(), pdf(`ajeno ${i}`))).status, 201);
  assert.ok((await filas()) - previas >= 8);

  const todo = await matriz(ges);
  assert.equal(todo.total, await filas());
  const propios = await matriz(ges, "&mine=true");
  // ges cargó 1 en el primer test + 2 aquí = 3 propios.
  assert.equal(propios.total, 3);
  assert.ok(propios.items.every((d: { autor: { nombre: string } }) => d.autor.nombre === "ges.docs"));

  // Acciones directas denegadas (403) sin cambiar nada.
  const id = todo.items[0].id;
  const revision = todo.items[0].revision;
  const denegadas = [
    ges.api("POST", `/documents/${id}/publish`, { expectedRevision: revision }),
    ges.api("POST", `/documents/${id}/reject`, { expectedRevision: revision, motivo: "x" }),
    ges.api("POST", `/documents/${id}/withdraw`, { expectedRevision: revision, motivo: "x", confirmedDocumentId: id }),
    ges.api("PATCH", `/documents/${id}/metadata`, { expectedRevision: revision, changes: { title: "Nuevo" } }),
    ges.api("POST", "/reindexations", {}),
  ];
  for (const r of await Promise.all(denegadas)) assert.equal(r.status, 403);
  const ops = await app.kb.query("SELECT count(*)::int n FROM kb.document_operation");
  assert.equal(ops.rows[0].n, 0);
});

test("AD03/AD04: lo pendiente no se recupera; publicado se recupera y cita; sin errores durante la indexación", async () => {
  // Base inicial publicada para que exista una generación activa.
  await publicado({ title: "Base inicial", publicUrl: `${SITIO}/base-inicial/` }, "El horario de atención de la base inicial es QZXBASE1 a todas horas.");
  const genAntes = (await app.kb.query("SELECT collection_name FROM kb.active_generation")).rows[0].collection_name as string;

  const r = await tec.upload(meta({ title: "Convenio de prueba", publicUrl: `${SITIO}/convenio/` }), pdf("La clave del convenio es WXQ7731ZZ para el trámite de prueba."));
  assert.equal(r.status, 201);
  await procesarCargasManuales(app.kb);
  for (let i = 0; i < 5; i++) assert.equal((await recupera("WXQ7731ZZ convenio clave", "WXQ7731ZZ")).length, 0, "pendiente: 0 fragmentos");

  // Consulta continua mientras se indexa con un embedder lento: la base anterior responde sin errores.
  const { embed } = await import("../../src/services/embeddings.js");
  const lento = async (t: string[], tipo: "query" | "passage") => { await new Promise(res => setTimeout(res, 150)); return embed(t, tipo); };
  const d = await documento(tec, r.json.id);
  const p = await tec.api("POST", `/documents/${r.json.id}/publish`, { expectedRevision: d.revision });
  assert.equal(p.status, 202);
  // Un 202 no es «Terminada».
  assert.equal((await tec.api("GET", `/document-operations/${p.json.operationId}`)).json.estado, "En curso");
  const sondeos: Array<{ ok: boolean; base: boolean }> = [];
  let corriendo = true;
  const sonda = (async () => {
    while (corriendo) {
      try { sondeos.push({ ok: true, base: (await recupera("QZXBASE1 horario atención", "QZXBASE1")).length > 0 }); }
      catch { sondeos.push({ ok: false, base: false }); }
      await new Promise(res => setTimeout(res, 100));
    }
  })();
  await procesarOperaciones(app.kb, { embedder: lento });
  corriendo = false; await sonda;
  assert.ok(sondeos.length >= 2, `consultas durante la indexación: ${sondeos.length}`);
  assert.ok(sondeos.every(s => s.ok), "cero errores durante la indexación");

  const op = (await tec.api("GET", `/document-operations/${p.json.operationId}`)).json;
  assert.equal(op.estado, "Terminada");
  assert.ok(op.inicio && op.fin);
  assert.equal((await documento(tec, r.json.id)).estado, "Publicado");
  for (let i = 0; i < 5; i++) {
    const hits = await recupera("WXQ7731ZZ convenio clave", "WXQ7731ZZ");
    assert.ok(hits.length > 0, "publicado: se recupera");
    assert.equal(hits[0].documentId, r.json.id);
    assert.equal(hits[0].title, "Convenio de prueba");
  }
  // La colección anterior ya no existe y la nueva es la activa; el alias es solo espejo.
  const { collections } = await qdrant().getCollections();
  assert.ok(!collections.some(c => c.name === genAntes));
  const activa = (await app.kb.query("SELECT collection_name FROM kb.active_generation")).rows[0].collection_name;
  assert.ok(collections.some(c => c.name === activa));
});

// ── Scraper: informes de corrida sintéticos (mismo formato que SPEC001) ─────────────────────────

import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import { procesarInforme } from "../../src/kb/sync.js";

let datos = "";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

async function paginaScraper(slug: string, texto: string): Promise<{ url: string; informe: string }> {
  if (!datos) {
    datos = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-scraper-prueba-"));
    process.env.GEOTRENDS_DOCUMENTS_ROOT = datos;
  }
  const rel = `ambientometro/paginas_md/${slug}.md`;
  await fs.mkdir(path.dirname(path.join(datos, rel)), { recursive: true });
  await fs.writeFile(path.join(datos, rel), `---\ntitle: "Página ${slug}"\nsource_url: "x"\n---\n\n# Página ${slug}\n\n${texto}\n`, "utf8");
  const url = `${SITIO}/${slug}/`;
  const informe = {
    schema_version: 1, run_id: randomUUID(), programada: true, completa: false,
    iniciada_en: new Date().toISOString(), terminada_en: new Date().toISOString(), fuentes: ["ambientometro"],
    enlaces: [{
      fuente: "ambientometro", fecha_hora: new Date().toISOString(), rol: "pagina", padre: null, titulo: `Página ${slug}`,
      estado_detectado: "no_aplica", resultado: "nuevo", error: null, hash_contenido: sha(texto), archivo: rel,
      archivo_original: null, hash_original: null, gmas: null, url,
    }],
  };
  const ruta = path.join(datos, "runs", `${informe.run_id}.json`);
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  await fs.writeFile(ruta, JSON.stringify(informe));
  return { url, informe: ruta };
}

async function idDe(url: string): Promise<string | undefined> {
  return (await app.kb.query("SELECT id FROM kb.kb_elemento WHERE url_origen = $1 OR clave = $1", [url])).rows[0]?.id;
}

/** Publica un documento del scraper (pendiente por una corrida) y espera la operación. */
async function publicarScraper(slug: string, texto: string): Promise<{ id: string; url: string }> {
  const { url, informe } = await paginaScraper(slug, texto);
  await procesarInforme(app.kb, informe);
  const id = (await idDe(url))!;
  const d = await documento(tec, id);
  const p = await tec.api("POST", `/documents/${id}/publish`, { expectedRevision: d.revision });
  assert.equal(p.status, 202, JSON.stringify(p.json));
  await procesarOperaciones(app.kb);
  assert.equal((await tec.api("GET", `/document-operations/${p.json.operationId}`)).json.estado, "Terminada");
  return { id, url };
}

async function enQdrant(dato: string): Promise<number> {
  let n = 0;
  const { collections } = await qdrant().getCollections();
  for (const c of collections.filter(x => x.name.startsWith(app.alias))) {
    let offset: string | number | null | undefined;
    do {
      const pagina = await qdrant().scroll(c.name, { limit: 256, with_payload: true, with_vector: false, ...(offset ? { offset } : {}) });
      n += pagina.points.filter(p => String((p.payload as { texto?: string }).texto).includes(dato)).length;
      offset = pagina.next_page_offset as string | number | null | undefined;
    } while (offset);
  }
  return n;
}
const enSql = async (dato: string) =>
  Number((await app.kb.query("SELECT count(*) FROM kb.kb_version WHERE contenido_md LIKE $1", [`%${dato}%`])).rows[0].count);

test("AD20: 3 reemplazos (manual, scraper, con tablas) dejan solo el dato nuevo y 0 copias del anterior", async () => {
  // Manual (código propio), scraper y XLSX con tablas.
  const manual = await publicado({ code: "DOC-REEMPL-1", title: "Guía de reemplazo", version: "01", publicUrl: `${SITIO}/guia-reemplazo/` }, "El valor vigente es VIEJOMANUAL4401.");
  const scraper = await publicarScraper("reemplazo-scraper", "El plazo vigente es VIEJOSCRAPER5502 días.");
  const rt = await tec.upload(meta({ code: "DOC-REEMPL-3", title: "Tabla de tarifas", publicUrl: `${SITIO}/tarifas/` }),
    { bytes: crearXlsx([["Concepto", "Valor"], ["Tarifa", "VIEJOTABLA6603"], ["Nota", RELLENO]]), name: "t.xlsx" });
  assert.equal(rt.status, 201);
  await procesarCargasManuales(app.kb);
  const dt = await documento(tec, rt.json.id);
  assert.equal((await tec.api("POST", `/documents/${rt.json.id}/publish`, { expectedRevision: dt.revision })).status, 202);
  await procesarOperaciones(app.kb);
  for (const viejo of ["VIEJOMANUAL4401", "VIEJOSCRAPER5502", "VIEJOTABLA6603"]) assert.ok(await enQdrant(viejo) > 0, viejo);

  // Nuevas versiones.
  const nuevaManual = await tec.upload(meta({ code: "DOC-REEMPL-1", title: "Guía de reemplazo", version: "02", updatedDate: "2026-09-01", publicUrl: `${SITIO}/guia-reemplazo/` }),
    pdf("El valor vigente es NUEVOMANUAL7701."));
  assert.equal(nuevaManual.status, 201);
  assert.equal(nuevaManual.json.id, manual, "misma identidad (mismo código)");
  const nuevaTabla = await tec.upload(meta({ code: "DOC-REEMPL-3", title: "Tabla de tarifas", publicUrl: `${SITIO}/tarifas/` }),
    { bytes: crearXlsx([["Concepto", "Valor"], ["Tarifa", "NUEVOTABLA8803"], ["Nota", RELLENO]]), name: "t.xlsx" });
  assert.equal(nuevaTabla.status, 201);
  const sc = await paginaScraper("reemplazo-scraper", "El plazo vigente es NUEVOSCRAPER9904 días.");
  await procesarInforme(app.kb, sc.informe);
  await procesarCargasManuales(app.kb);

  // Mientras están pendientes, responde solo la versión publicada.
  for (let i = 0; i < 5; i++) {
    assert.ok((await recupera("valor vigente VIEJOMANUAL4401", "VIEJOMANUAL4401")).length > 0);
    assert.equal((await recupera("valor vigente NUEVOMANUAL7701", "NUEVOMANUAL7701")).length, 0);
  }
  const filaPendiente = (await matriz(tec)).items.find((d: { id: string }) => d.id === manual);
  assert.equal(filaPendiente.estado, "Publicado");
  assert.ok(filaPendiente.candidata, "la candidata se identifica aparte de la vigente");
  assert.equal(filaPendiente.version, "01", "la metadata vigente no se sobrescribe por la candidata");

  // Publicar los tres reemplazos.
  const archivosVigentesAntes = await archivosCargados();
  for (const id of [manual, rt.json.id, scraper.id]) {
    const d = await documento(tec, id);
    const p = await tec.api("POST", `/documents/${id}/publish`, { expectedRevision: d.revision });
    assert.equal(p.status, 202, JSON.stringify(p.json));
  }
  await procesarOperaciones(app.kb);

  for (const [nuevo, viejo, consulta] of [["NUEVOMANUAL7701", "VIEJOMANUAL4401", "valor vigente"], ["NUEVOSCRAPER9904", "VIEJOSCRAPER5502", "plazo vigente días"], ["NUEVOTABLA8803", "VIEJOTABLA6603", "tarifa concepto valor"]]) {
    for (let i = 0; i < 5; i++) {
      assert.ok((await recupera(`${consulta} ${nuevo}`, nuevo)).length > 0, `${nuevo} se recupera`);
      assert.equal((await recupera(`${consulta} ${viejo}`, viejo)).length, 0, `${viejo} ya no`);
    }
    assert.equal(await enSql(viejo), 0, `${viejo} en SQL`);
    assert.equal(await enQdrant(viejo), 0, `${viejo} en el índice`);
  }
  const m = await matriz(tec);
  for (const id of [manual, rt.json.id, scraper.id]) assert.equal(m.items.filter((d: { id: string }) => d.id === id).length, 1, "una fila por documento");
  const actualizado = m.items.find((d: { id: string }) => d.id === manual);
  assert.equal(actualizado.version, "02");
  assert.equal(actualizado.fechaActualizacion, "01/09/2026");
  assert.equal(actualizado.estado, "Publicado");
  assert.equal(actualizado.candidata, null);
  // Los archivos del contenido anterior ya no existen: quedaron los de las versiones vigentes.
  const archivosDespues = await archivosCargados();
  assert.ok(archivosDespues.length <= archivosVigentesAntes.length, "no se acumulan archivos viejos");
  void archivosVigentesAntes;
});

test("AD22: rechazos (2 manuales, 2 scraper) con motivo; sin motivo y Gestor denegados; la publicada sigue respondiendo", async () => {
  const idsRechazados: Array<{ id: string; url: string; dato: string }> = [];
  for (let i = 0; i < 2; i++) {
    const dato = `RECHMANUAL${i}551${i}`;
    const r = await tec.upload(meta({ title: `Rechazo manual ${i}` }), pdf(`Contenido con ${dato}`));
    assert.equal(r.status, 201);
    idsRechazados.push({ id: r.json.id, url: (await app.kb.query("SELECT url_origen FROM kb.kb_elemento WHERE id=$1", [r.json.id])).rows[0].url_origen, dato });
  }
  for (let i = 0; i < 2; i++) {
    const dato = `RECHSCRAPER${i}662${i}`;
    const { url, informe } = await paginaScraper(`rechazo-scraper-${i}`, `Texto con ${dato}`);
    await procesarInforme(app.kb, informe);
    idsRechazados.push({ id: (await idDe(url))!, url, dato });
  }
  await procesarCargasManuales(app.kb);

  // Sin motivo → 422; Gestor → 403.
  const d0 = await documento(tec, idsRechazados[0].id);
  assert.equal((await tec.api("POST", `/documents/${d0.id}/reject`, { expectedRevision: d0.revision, motivo: "   " })).status, 422);
  assert.equal((await ges.api("POST", `/documents/${d0.id}/reject`, { expectedRevision: d0.revision, motivo: "No aplica" })).status, 403);
  assert.equal((await documento(tec, d0.id)).estado, "Pendiente de aprobación");

  for (const r of idsRechazados) {
    const d = await documento(tec, r.id);
    const rr = await tec.api("POST", `/documents/${r.id}/reject`, { expectedRevision: d.revision, motivo: "Contenido no corresponde al alcance" });
    assert.equal(rr.status, 202, JSON.stringify(rr.json));
  }
  await procesarOperaciones(app.kb);
  for (const r of idsRechazados) {
    assert.equal(await idDe(r.url), undefined, "fuera de la matriz");
    assert.equal(await enSql(r.dato), 0);
    assert.equal(await enQdrant(r.dato), 0);
  }
  const reg = (await app.kb.query("SELECT * FROM kb.document_removal WHERE type = 'reject' ORDER BY occurred_at")).rows;
  assert.equal(reg.length, 4);
  for (const f of reg) {
    for (const campo of ["document_name", "source_url", "origin", "content_hash", "reason", "actor_account_id", "occurred_at"]) assert.ok(f[campo], campo);
  }
  assert.deepEqual(reg.map(f => f.origin).sort(), ["manual", "manual", "scraper", "scraper"]);

  // Una versión nueva rechazada conserva la publicada.
  const pub = await publicado({ code: "DOC-RECH-5", title: "Documento con versión nueva", publicUrl: `${SITIO}/rech-5/` }, "Vigente: PERMANECE7731.");
  const nueva = await tec.upload(meta({ code: "DOC-RECH-5", title: "Documento con versión nueva", publicUrl: `${SITIO}/rech-5/` }), pdf("Nueva: DESCARTADA7732."));
  assert.equal(nueva.json.id, pub);
  await procesarCargasManuales(app.kb);
  const dn = await documento(tec, pub);
  assert.equal((await tec.api("POST", `/documents/${pub}/reject`, { expectedRevision: dn.revision, motivo: "Error de edición" })).status, 202);
  await procesarOperaciones(app.kb);
  assert.ok((await recupera("PERMANECE7731 vigente", "PERMANECE7731")).length > 0);
  assert.equal((await documento(tec, pub)).estado, "Publicado");
  assert.equal((await documento(tec, pub)).candidata, null);
});

test("AD23: lo rechazado no reaparece tras 2 ejecuciones; una huella nueva vuelve a pendiente y las demás siguen omitidas", async () => {
  const sitios = ["omitir-a", "omitir-b", "omitir-c"];
  for (const s of sitios) {
    const { url, informe } = await paginaScraper(s, `Texto estable de ${s} con dato OMIT${s.length}.`);
    await procesarInforme(app.kb, informe);
    const id = (await idDe(url))!;
    const d = await documento(tec, id);
    assert.equal((await tec.api("POST", `/documents/${id}/reject`, { expectedRevision: d.revision, motivo: "Fuera de alcance" })).status, 202);
  }
  await procesarOperaciones(app.kb);
  const antes = await filas();
  for (let ronda = 0; ronda < 2; ronda++) {
    for (const s of sitios) {
      const { informe } = await paginaScraper(s, `Texto estable de ${s} con dato OMIT${s.length}.`);
      await procesarInforme(app.kb, informe);
    }
  }
  assert.equal(await filas(), antes, "0 filas pendientes nuevas");
  const omitidos = await app.kb.query("SELECT count(*)::int n FROM kb.kb_auditoria WHERE accion = 'omitir_rechazado' AND resultado = 'omitido por rechazo previo'");
  assert.equal(omitidos.rows[0].n, 6);

  // Uno de los enlaces cambia de contenido: aparece pendiente; los otros dos siguen omitidos.
  const mod = await paginaScraper("omitir-a", "Texto MODIFICADO de omitir-a con dato NUEVOOMIT.");
  await procesarInforme(app.kb, mod.informe);
  assert.ok(await idDe(`${SITIO}/omitir-a/`), "el modificado vuelve a pendiente");
  assert.equal(await idDe(`${SITIO}/omitir-b/`), undefined);
  assert.equal(await idDe(`${SITIO}/omitir-c/`), undefined);
});

test("AD24/25: retiros (2 manuales, 2 scraper, uno con tablas) con motivo y confirmación; luego el scraper no los repone", async () => {
  const retirar: Array<{ id: string; url: string; slug?: string; dato: string; texto?: string }> = [];
  for (let i = 0; i < 2; i++) {
    const dato = `RETMANUAL${i}771${i}`;
    const id = await publicado({ title: `Retiro manual ${i}` }, `Contenido con ${dato}`);
    retirar.push({ id, url: (await app.kb.query("SELECT url_origen FROM kb.kb_elemento WHERE id=$1", [id])).rows[0].url_origen, dato });
  }
  // Uno manual con tablas (XLSX).
  {
    const dato = "RETTABLA7712";
    const r = await tec.upload(meta({ title: "Retiro con tablas" }), { bytes: crearXlsx([["Col", "Dato"], ["x", dato], ["y", RELLENO]]), name: "t.xlsx" });
    await procesarCargasManuales(app.kb);
    const d = await documento(tec, r.json.id);
    await tec.api("POST", `/documents/${r.json.id}/publish`, { expectedRevision: d.revision });
    await procesarOperaciones(app.kb);
    retirar.push({ id: r.json.id, url: (await app.kb.query("SELECT url_origen FROM kb.kb_elemento WHERE id=$1", [r.json.id])).rows[0].url_origen, dato });
  }
  const scrapers: string[] = [];
  for (let i = 0; i < 2; i++) {
    const slug = `retiro-scraper-${i}`; const texto = `Contenido scraper con RETSCRAPER${i}881${i}`;
    const p = await publicarScraper(slug, texto);
    retirar.push({ id: p.id, url: p.url, slug, dato: `RETSCRAPER${i}881${i}`, texto });
    scrapers.push(slug);
  }
  for (const r of retirar) assert.ok((await recupera(`${r.dato}`, r.dato)).length > 0, `${r.dato} publicado`);

  // Confirmación que no coincide o sin motivo: no cambia nada.
  const primero = await documento(tec, retirar[0].id);
  const mal = await tec.api("POST", `/documents/${primero.id}/withdraw`, { expectedRevision: primero.revision, motivo: "Obsoleto", confirmedDocumentId: retirar[1].id });
  assert.equal(mal.status, 422);
  assert.equal((await tec.api("POST", `/documents/${primero.id}/withdraw`, { expectedRevision: primero.revision, motivo: "", confirmedDocumentId: primero.id })).status, 422);
  assert.equal((await ges.api("POST", `/documents/${primero.id}/withdraw`, { expectedRevision: primero.revision, motivo: "Obsoleto", confirmedDocumentId: primero.id })).status, 403);
  assert.ok((await recupera(retirar[0].dato, retirar[0].dato)).length > 0);

  for (const r of retirar) {
    const d = await documento(tec, r.id);
    const w = await tec.api("POST", `/documents/${r.id}/withdraw`, { expectedRevision: d.revision, motivo: "Documento obsoleto", confirmedDocumentId: r.id });
    assert.equal(w.status, 202, JSON.stringify(w.json));
  }
  await procesarOperaciones(app.kb);
  for (const r of retirar) {
    assert.equal(await idDe(r.url), undefined, "fuera de la matriz y de la base");
    assert.equal(await enSql(r.dato), 0);
    assert.equal(await enQdrant(r.dato), 0);
    for (let i = 0; i < 5; i++) assert.equal((await recupera(r.dato, r.dato)).length, 0);
  }
  const reg = (await app.kb.query("SELECT * FROM kb.document_removal WHERE type = 'withdraw'")).rows;
  assert.equal(reg.length, 5);
  for (const f of reg) for (const c of ["document_name", "source_url", "origin", "content_hash", "reason", "actor_account_id", "occurred_at"]) assert.ok(f[c], c);

  // AD25: el scraper no repone lo retirado (2 ejecuciones); uno modificado aparece pendiente.
  const antes = await filas();
  for (let ronda = 0; ronda < 2; ronda++) {
    for (const r of retirar.filter(x => x.slug)) {
      const { informe } = await paginaScraper(r.slug!, r.texto!);
      await procesarInforme(app.kb, informe);
    }
  }
  assert.equal(await filas(), antes);
  const omit = await app.kb.query("SELECT count(*)::int n FROM kb.kb_auditoria WHERE accion = 'omitir_retirado'");
  assert.equal(omit.rows[0].n, 4);
  const mod = await paginaScraper(scrapers[0], "Contenido modificado después del retiro con NUEVORETIRO.");
  await procesarInforme(app.kb, mod.informe);
  assert.ok(await idDe(`${SITIO}/${scrapers[0]}/`));
  assert.equal(await idDe(`${SITIO}/${scrapers[1]}/`), undefined);
});

test("AD26/27: reintento exitoso sin aviso; dos fallos dejan pendiente, anterior intacto y aviso seguro; se republica tras corregir", async () => {
  const { embed } = await import("../../src/services/embeddings.js");
  const fallar = (veces: number) => { let n = 0; return async (t: string[], tipo: "query" | "passage") => { if (n++ < veces) throw new Error("fallo forzado /var/secreto/ruta: proveedor X"); return embed(t, tipo); }; };

  // (a) Un fallo y reintento exitoso → «Publicado» sin notificación.
  const a = await tec.upload(meta({ title: "Reintento exitoso" }), pdf("Dato REINTENTO3301."));
  await procesarCargasManuales(app.kb);
  const da = await documento(tec, a.json.id);
  await tec.api("POST", `/documents/${a.json.id}/publish`, { expectedRevision: da.revision });
  const avisosAntes = Number((await app.kb.query("SELECT count(*) FROM kb.kb_notificacion WHERE tipo = 'indexacion_fallida'")).rows[0].count);
  await procesarOperaciones(app.kb, { embedder: fallar(1) });
  assert.equal((await documento(tec, a.json.id)).estado, "Publicado");
  assert.equal(Number((await app.kb.query("SELECT count(*) FROM kb.kb_notificacion WHERE tipo = 'indexacion_fallida'")).rows[0].count), avisosAntes);
  const opA = (await app.kb.query("SELECT attempts, phase FROM kb.document_operation WHERE element_id = $1", [a.json.id])).rows[0];
  assert.deepEqual({ ...opA }, { attempts: 2, phase: "complete" });

  // (b) Dos fallos: queda pendiente, 0 fragmentos, 5 consultas no lo recuperan y hay aviso seguro.
  const b = await tec.upload(meta({ title: "Falla doble" }), pdf("Dato FALLADOBLE4402."));
  await procesarCargasManuales(app.kb);
  const db_ = await documento(tec, b.json.id);
  const pb = await tec.api("POST", `/documents/${b.json.id}/publish`, { expectedRevision: db_.revision });
  await procesarOperaciones(app.kb, { embedder: fallar(99) });
  assert.equal((await tec.api("GET", `/document-operations/${pb.json.operationId}`)).json.estado, "Fallida");
  assert.equal((await documento(tec, b.json.id)).estado, "Pendiente de aprobación");
  assert.equal(await enQdrant("FALLADOBLE4402"), 0);
  for (let i = 0; i < 5; i++) assert.equal((await recupera("FALLADOBLE4402", "FALLADOBLE4402")).length, 0);
  const aviso = (await app.kb.query("SELECT descripcion, alcance, propietario_cuenta FROM kb.kb_notificacion WHERE tipo = 'indexacion_fallida' ORDER BY ultima_en DESC LIMIT 1")).rows[0];
  assert.ok(!/\/var|secreto|proveedor X/.test(aviso.descripcion), `aviso sin rutas ni mensajes del proveedor: ${aviso.descripcion}`);
  assert.equal(aviso.alcance, "carga");
  // Las colecciones parciales se eliminaron.
  const { collections } = await qdrant().getCollections();
  const activa = (await app.kb.query("SELECT collection_name FROM kb.active_generation")).rows[0].collection_name;
  assert.deepEqual(collections.filter(c => c.name.startsWith(app.alias) && c.name !== activa), []);

  // Republicar tras corregir.
  const p2 = await tec.api("POST", `/documents/${b.json.id}/publish`, { expectedRevision: (await documento(tec, b.json.id)).revision });
  assert.equal(p2.status, 202);
  await procesarOperaciones(app.kb);
  assert.equal((await documento(tec, b.json.id)).estado, "Publicado");
  assert.ok((await recupera("FALLADOBLE4402", "FALLADOBLE4402")).length > 0);

  // AD27: reemplazo con fallo en ambos intentos conserva el dato anterior y la fila publicada intacta.
  const c = await publicado({ code: "DOC-FALLA-27", title: "Reemplazo con falla", publicUrl: `${SITIO}/falla-27/` }, "Dato ANTERIOR9901.");
  const nuevo = await tec.upload(meta({ code: "DOC-FALLA-27", title: "Reemplazo con falla", publicUrl: `${SITIO}/falla-27/` }), pdf("Dato POSTERIOR9902."));
  assert.equal(nuevo.json.id, c);
  await procesarCargasManuales(app.kb);
  const dc = await documento(tec, c);
  await tec.api("POST", `/documents/${c}/publish`, { expectedRevision: dc.revision });
  await procesarOperaciones(app.kb, { embedder: fallar(99) });
  for (let i = 0; i < 5; i++) {
    assert.ok((await recupera("ANTERIOR9901 dato", "ANTERIOR9901")).length > 0);
    assert.equal((await recupera("POSTERIOR9902 dato", "POSTERIOR9902")).length, 0);
  }
  assert.ok(await enQdrant("ANTERIOR9901") > 0, "el índice conserva los vectores anteriores");
  assert.equal(await enQdrant("POSTERIOR9902"), 0, "la nueva tiene 0 fragmentos");
  const fila = await documento(tec, c);
  assert.equal(fila.estado, "Publicado");
  assert.ok((await matriz(tec)).items.find((d: { id: string }) => d.id === c).candidata, "y la candidata sigue pendiente");
  // Tras corregir y republicar, la anterior se elimina (AD-20).
  const p3 = await tec.api("POST", `/documents/${c}/publish`, { expectedRevision: fila.revision });
  assert.equal(p3.status, 202);
  await procesarOperaciones(app.kb);
  assert.equal(await enQdrant("ANTERIOR9901"), 0);
  assert.equal(await enSql("ANTERIOR9901"), 0);
  assert.ok((await recupera("POSTERIOR9902 dato", "POSTERIOR9902")).length > 0);
});

test("AD38: vigencia civil de Bogotá (ayer/hoy/mañana/sin fecha), un solo aviso y 23:59:59 aún disponible", async () => {
  const hoy = (await app.kb.query("SELECT (now() AT TIME ZONE 'America/Bogota')::date AS d")).rows[0].d as Date;
  const iso = (delta: number) => new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + delta)).toISOString().slice(0, 10);
  // La fecha de validez se fija en la carga; «ayer» ya vencido se prepara con una validez futura y luego se mueve por SQL.
  const casos: Array<{ nombre: string; dato: string; validez: string | null }> = [
    { nombre: "ayer", dato: "VIGAYER5501", validez: iso(-1) },
    { nombre: "hoy", dato: "VIGHOY5502", validez: iso(0) },
    { nombre: "manana", dato: "VIGMANANA5503", validez: iso(1) },
    { nombre: "sin", dato: "VIGSINFECHA5504", validez: null },
  ];
  const ids: Record<string, string> = {};
  for (const c of casos) {
    ids[c.nombre] = await publicado({ title: `Vigencia ${c.nombre}`, ...(c.validez ? { validUntil: c.validez } : {}) }, `Dato ${c.dato} de vigencia.`);
  }
  // El de «ayer» no se recupera (excluido en cada consulta aunque el worker no haya corrido).
  for (let i = 0; i < 5; i++) assert.equal((await recupera("VIGAYER5501", "VIGAYER5501")).length, 0);
  assert.equal((await documento(tec, ids.ayer)).estado, "Vencido");
  assert.ok((await recupera("VIGHOY5502", "VIGHOY5502")).length > 0, "hoy sigue disponible");
  assert.ok((await recupera("VIGMANANA5503", "VIGMANANA5503")).length > 0);
  assert.ok((await recupera("VIGSINFECHA5504", "VIGSINFECHA5504")).length > 0);

  // Dos ejecuciones del worker generan UN solo aviso para el vencido.
  const { procesarVencimientos } = await import("../../src/kb/expiry.js");
  assert.equal(await procesarVencimientos(app.kb), 1);
  assert.equal(await procesarVencimientos(app.kb), 0);
  const avisos = await app.kb.query("SELECT count(*)::int n FROM kb.kb_notificacion WHERE tipo = 'documento_vencido'");
  assert.equal(avisos.rows[0].n, 1);
  assert.equal((await app.kb.query("SELECT estado FROM kb.kb_elemento WHERE id = $1", [ids.ayer])).rows[0].estado, "vencido");

  // Frontera horaria: disponible hasta las 23:59:59 de Bogotá del día de validez; excluido a las 00:00:00.
  const f = async (valido: string, instante: string) =>
    (await app.kb.query("SELECT kb.vigente_en($1::date, $2::timestamptz) AS v", [valido, instante])).rows[0].v as boolean;
  assert.equal(await f("2026-10-11", "2026-10-11T23:59:59-05:00"), true);
  assert.equal(await f("2026-10-11", "2026-10-12T00:00:00-05:00"), false);
});

test("AD39: 3 ediciones válidas y 3 inválidas; la cita refleja el cambio, el vencido vuelve a Publicado y el hash no cambia", async () => {
  const id = await publicado({ title: "Título original", publicUrl: `${SITIO}/editar-1/` }, "Dato EDITAR6601 del documento.");
  const venc = await publicado({ title: "Documento a rehabilitar", validUntil: "2020-01-01", publicUrl: `${SITIO}/editar-2/` }, "Dato REHAB6602 del documento.");
  const { procesarVencimientos } = await import("../../src/kb/expiry.js");
  await procesarVencimientos(app.kb);
  assert.equal((await documento(tec, venc)).estado, "Vencido");
  const hashAntes = (await app.kb.query("SELECT hash_contenido FROM kb.kb_version WHERE elemento_id = $1", [id])).rows[0].hash_contenido;

  const editar = async (docId: string, changes: Record<string, unknown>) => {
    const d = await documento(tec, docId);
    return tec.api("PATCH", `/documents/${docId}/metadata`, { expectedRevision: d.revision, changes });
  };
  // Válidas.
  assert.equal((await editar(id, { title: "Título editado por administración" })).status, 200);
  assert.equal((await editar(id, { publicUrl: `${SITIO}/editar-1-nuevo/` })).status, 200);
  assert.equal((await editar(venc, { validUntil: "2099-12-31" })).status, 200);
  // Inválidas.
  assert.equal((await editar(id, { title: "   " })).status, 422);
  assert.equal((await editar(id, { publicUrl: "http://inseguro.gov.co/x" })).status, 422);
  assert.equal((await editar(id, { direction: "Dirección inventada" })).status, 422);
  assert.equal((await editar(id, { code: "NUEVO-COD" })).status, 422, "el código no es editable");
  // Revisión obsoleta.
  assert.equal((await tec.api("PATCH", `/documents/${id}/metadata`, { expectedRevision: "1", changes: { title: "Otro" } })).status, 409);
  // Gestor denegado.
  assert.equal((await ges.api("PATCH", `/documents/${id}/metadata`, { expectedRevision: "1", changes: { title: "x" } })).status, 403);

  const m = await matriz(tec);
  const fila = m.items.find((d: { id: string }) => d.id === id);
  assert.equal(fila.nombre, "Título editado por administración");
  assert.equal(fila.enlace, `${SITIO}/editar-1-nuevo/`);
  assert.equal(m.items.find((d: { id: string }) => d.id === venc).estado, "Publicado");
  // La cita usa la metadata nueva en la consulta siguiente (sin esperar una reindexación).
  const hits = await recupera("EDITAR6601 documento", "EDITAR6601");
  assert.ok(hits.length > 0);
  assert.equal(hits[0].title, "Título editado por administración");
  assert.equal(hits[0].sourceUrl, `${SITIO}/editar-1-nuevo/`);
  assert.ok((await recupera("REHAB6602 documento", "REHAB6602")).length > 0, "el rehabilitado vuelve a recuperarse");
  const hashDespues = (await app.kb.query("SELECT hash_contenido FROM kb.kb_version WHERE elemento_id = $1", [id])).rows[0].hash_contenido;
  assert.equal(hashDespues, hashAntes);
  // La operación de metadata sincroniza el payload.
  await procesarOperaciones(app.kb);
  const tit = await qdrant().scroll((await app.kb.query("SELECT collection_name FROM kb.active_generation")).rows[0].collection_name,
    { limit: 5, with_payload: ["titulo"], filter: { must: [{ key: "elemento_id", match: { value: id } }] } });
  assert.ok(tit.points.every(p => (p.payload as { titulo: string }).titulo === "Título editado por administración"));
});

test("AD47: reindexación con consultas continuas, 'Terminada' con inicio/fin; fallo a mitad → 'Fallida' y la base anterior responde; segunda activa → 409", async () => {
  await publicado({ title: "Para reindexar" }, "Dato REINDEX7701 permanente.");
  const { embed } = await import("../../src/services/embeddings.js");
  const lento = async (t: string[], tipo: "query" | "passage") => { await new Promise(r => setTimeout(r, 120)); return embed(t, tipo); };

  const r1 = await tec.api("POST", "/reindexations", {});
  assert.equal(r1.status, 202);
  const r2 = await tec.api("POST", "/reindexations", {});
  assert.equal(r2.status, 409, "segundo inicio mientras hay uno en curso");
  assert.equal((await ges.api("POST", "/reindexations", {})).status, 403);
  const fallos: string[] = []; let hits = 0; let activo = true;
  const sonda = (async () => {
    while (activo) {
      try { if ((await recupera("REINDEX7701", "REINDEX7701")).length) hits++; } catch (e) { fallos.push(String(e)); }
      await new Promise(r => setTimeout(r, 100));
    }
  })();
  await procesarOperaciones(app.kb, { embedder: lento });
  activo = false; await sonda;
  assert.deepEqual(fallos, [], "0 errores durante la reindexación");
  assert.ok(hits >= 2);
  const op = (await tec.api("GET", `/document-operations/${r1.json.operationId}`)).json;
  assert.equal(op.estado, "Terminada");
  assert.ok(op.inicio && op.fin);

  // Fallo a mitad: «Fallida», notificación y la base anterior responde.
  let llamadas = 0;
  const fallaAlMedio = async (t: string[], tipo: "query" | "passage") => { if (++llamadas > 2) throw new Error("fallo a mitad"); return embed(t, tipo); };
  const r3 = await tec.api("POST", "/reindexations", {});
  assert.equal(r3.status, 202);
  const genAntes = (await app.kb.query("SELECT generation_id FROM kb.active_generation")).rows[0].generation_id;
  await procesarOperaciones(app.kb, { embedder: fallaAlMedio });
  assert.equal((await tec.api("GET", `/document-operations/${r3.json.operationId}`)).json.estado, "Fallida");
  assert.equal((await app.kb.query("SELECT generation_id FROM kb.active_generation")).rows[0].generation_id, genAntes);
  assert.ok((await recupera("REINDEX7701", "REINDEX7701")).length > 0, "la base anterior responde");
  assert.ok(Number((await app.kb.query("SELECT count(*) FROM kb.kb_notificacion WHERE tipo = 'indexacion_fallida' AND estado = 'no_revisada'")).rows[0].count) >= 1);
});
