/**
 * Vigilancia de las fuentes contra PostgreSQL y Qdrant reales (T061;
 * RF-C3-IV-02, IV-03, IV-04; SC-007, SC-008): derogados, errores sin pérdida,
 * cambios en pendiente, agrupación de avisos y vigilante de la corrida semanal.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { contarPuntos } from "../../src/kb/indexer.js";
import { publicar } from "../../src/kb/service.js";
import { procesarInforme } from "../../src/kb/sync.js";
import { verificarAtraso } from "../../src/kb/vigilante.js";
import { qdrant } from "../../src/services/qdrant.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";
import { embedderSintetico, prepararQdrantDePrueba } from "./qdrantPruebas.js";

const G = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=";
const D = "https://gmas2.envigado.gov.co/gmas/downloadFile.public?repositorioArchivo=";
const URL_P = G + "0000010207";
const URL_F = G + "0000013830";
const URL_M = G + "0000012522";

let base: BaseDePrueba;
let alias: string;
let datos: string;

const gmas = (codigo: string, id: string, estado = "Vigente", vinculados: Array<[string, string]> = [], descarga: string | null = null) => ({
  id, codigo, nombre: `Nombre de ${codigo}`, version: "06", fecha_actualizacion: "2022-09-12", estado,
  dependencia: "SECRETARÍA", descarga,
  vinculados: vinculados.map(([c, i]) => ({ codigo: c, nombre: c, id: i, url: G + i, grupo: "Registros" })),
});

const enlace = (extra: Record<string, unknown>) => ({
  fuente: "gmas2_envigado", fecha_hora: new Date().toISOString(), rol: "vinculado", padre: null, titulo: null,
  estado_detectado: "vigente", resultado: "nuevo", error: null, hash_contenido: null,
  archivo: null, archivo_original: null, hash_original: null, gmas: null, ...extra,
});

type Opciones = { completa?: boolean; hashP?: string; formato?: Record<string, unknown>; padre?: Record<string, unknown>; mg?: Record<string, unknown> | null };

/** GT-P-004 con GT-F-011 (y su descarga) y MG-F-051, con ajustes por prueba. */
function informe(o: Opciones = {}) {
  const enlaces = [
    enlace({ url: URL_P, rol: "procedimiento", hash_contenido: (o.hashP ?? "1").repeat(64).slice(0, 64),
      archivo: "gmas2_envigado/paginas_md/gmas/gt-p-004.md",
      gmas: gmas("GT-P-004", "0000010207", "Vigente", [["GT-F-011", "0000013830"], ["MG-F-051", "0000012522"]]), ...o.padre }),
    enlace({ url: URL_F, padre: URL_P, hash_contenido: "2".repeat(64), archivo: "gmas2_envigado/paginas_md/gmas/gt-f-011.md",
      gmas: gmas("GT-F-011", "0000013830", "Vigente", [], D + "11"), ...o.formato }),
    enlace({ url: D + "11", rol: "descarga", padre: URL_F, estado_detectado: "no_aplica",
      archivo_original: "gmas2_envigado/documentos/txt/gt-f-011.txt", hash_original: "3".repeat(64) }),
  ];
  if (o.mg !== null) {
    enlaces.push(enlace({ url: URL_M, padre: URL_P, hash_contenido: "4".repeat(64),
      archivo: "gmas2_envigado/paginas_md/gmas/mg-f-051.md", gmas: gmas("MG-F-051", "0000012522"), ...o.mg }));
  }
  return {
    schema_version: 1, run_id: randomUUID(), programada: true, completa: o.completa ?? false,
    iniciada_en: new Date().toISOString(), terminada_en: new Date().toISOString(),
    fuentes: ["gmas2_envigado"], enlaces,
  };
}

async function escribir(rel: string, contenido: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(datos, rel)), { recursive: true });
  await fs.writeFile(path.join(datos, rel), contenido, "utf8");
}

async function correr(i: unknown): Promise<void> {
  const ruta = path.join(datos, "runs", `${(i as { run_id: string }).run_id}.json`);
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  await fs.writeFile(ruta, JSON.stringify(i));
  await procesarInforme(base.kb, ruta);
}

const md = (t: string, c: string) => `---\ntitle: "${t}"\n---\n\n# ${t}\n\n${c}\n`;
const elemento = async (clave: string) =>
  (await base.kb.query("SELECT * FROM kb.kb_elemento WHERE clave = $1", [clave])).rows[0];
const notificaciones = async (tipo: string, objeto?: string) =>
  (await base.kb.query("SELECT * FROM kb.kb_notificacion WHERE tipo = $1 AND ($2::text IS NULL OR objeto = $2)", [tipo, objeto ?? null])).rows;

before(async () => {
  base = await crearBaseDePrueba();
  alias = prepararQdrantDePrueba();
  datos = await fs.mkdtemp(path.join(os.tmpdir(), "kb-vig-"));
  process.env.GEOTRENDS_DOCUMENTS_ROOT = datos;
  await escribir("gmas2_envigado/paginas_md/gmas/gt-p-004.md", md("GT-P-004", "Recibir la solicitud y diligenciar el GT-F-011."));
  await escribir("gmas2_envigado/paginas_md/gmas/gt-f-011.md", md("GT-F-011", "Visor del formato."));
  await escribir("gmas2_envigado/documentos/txt/gt-f-011.txt", "SOLICITUD DE GESTIÓN DE TRÁMITES AMBIENTALES\nNOMBRE:\nCÉDULA:");
  await escribir("gmas2_envigado/paginas_md/gmas/mg-f-051.md", md("MG-F-051", "Evaluación del servicio."));
});

after(async () => {
  await base?.borrar();
  await fs.rm(datos, { recursive: true, force: true });
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

test("registro: cada enlace del informe genera una fila en kb_verificacion", async () => {
  const i = informe({ completa: true });
  await correr(i);
  const { rows } = await base.kb.query("SELECT count(*)::int AS n FROM kb.kb_verificacion WHERE corrida_id = $1", [i.run_id]);
  assert.equal(rows[0].n, i.enlaces.length);
  await publicar(base.kb, { todosPendientes: true }, "cli:prueba", { embedder: embedderSintetico });
  assert.ok(await contarPuntos(undefined, (await elemento("GT-F-011")).id) > 0);
});

test("cambio: cambio_detectado deja una versión pendiente y la publicada intacta", async () => {
  const antes = await elemento("GT-P-004");
  await escribir("gmas2_envigado/paginas_md/gmas/gt-p-004.md", md("GT-P-004", "Texto nuevo del procedimiento tras una actualización."));
  await correr(informe({ hashP: "9", padre: { resultado: "cambio_detectado" } }));
  const despues = await elemento("GT-P-004");
  assert.equal(despues.estado, "publicado");
  assert.equal(despues.version_publicada_id, antes.version_publicada_id);
  assert.ok(despues.version_pendiente_id, "el cambio espera aprobación");
  assert.ok(await contarPuntos(undefined, despues.id) > 0, "sigue sirviéndose la versión publicada");
});

test("error: se notifica verificacion_fallida, se agrupa y no pierde la versión publicada", async () => {
  const error = { fuente: "gmas2_envigado", resultado: "error", estado_detectado: "no_aplica", hash_contenido: null, archivo: null, gmas: null,
    error: { tipo: "http", detalle: "HTTP 503", codigo_http: 503 } };
  await correr(informe({ formato: error }));
  await correr(informe({ formato: error }));
  const n = await notificaciones("verificacion_fallida", URL_F);
  assert.equal(n.length, 1, "una sola notificación sin revisar por enlace");
  assert.equal(n[0].repeticiones, 2);
  assert.match(n[0].descripcion, /503/);
  const el = await elemento("GT-F-011");
  assert.equal(el.estado, "publicado");
  assert.ok(await contarPuntos(undefined, el.id) > 0);
});

test("padre con error: los vinculados publicados se conservan y no hay fuera_de_alcance", async () => {
  const errorP = { resultado: "error", estado_detectado: "no_aplica", hash_contenido: null, archivo: null, gmas: null,
    error: { tipo: "inaccesible", detalle: "la conexión falló" } };
  const noAlcanzado = { resultado: "error", estado_detectado: "no_aplica", hash_contenido: null, archivo: null, gmas: null, padre: null,
    error: { tipo: "inaccesible", detalle: "no alcanzado" } };
  await correr(informe({ completa: true, padre: errorP, formato: noAlcanzado, mg: noAlcanzado }));
  assert.ok(await elemento("MG-F-051"));
  assert.ok(await elemento("GT-F-011"));
  assert.equal((await notificaciones("fuera_de_alcance")).length, 0);
  assert.equal((await notificaciones("verificacion_fallida", URL_P)).length, 1);
  assert.equal((await notificaciones("verificacion_fallida", URL_M)).length, 0, "el hijo no alcanzado no duplica el aviso del padre");
});

test("derogado: sale de la búsqueda, queda marcado y se notifica", async () => {
  const id = (await elemento("GT-F-011")).id;
  await correr(informe({ formato: { estado_detectado: "derogado", archivo: null, hash_contenido: null, gmas: gmas("GT-F-011", "0000013830", "Derogado") } }));
  const el = await elemento("GT-F-011");
  assert.equal(el.estado, "derogado");
  assert.ok(el.derogado_en);
  assert.equal(await contarPuntos(undefined, id), 0, "0 puntos recuperables (SC-008)");
  const n = await notificaciones("documento_derogado", "GT-F-011");
  assert.equal(n.length, 1);
});

test("un derogado que vuelve a vigente espera aprobación y, publicado, se recupera de nuevo", async () => {
  await correr(informe());
  const el = await elemento("GT-F-011");
  assert.equal(el.estado, "pendiente_aprobacion");
  assert.equal(el.derogado_en, null);
  assert.ok(el.version_pendiente_id);
  await publicar(base.kb, { claves: ["GT-F-011"] }, "cli:prueba", { embedder: embedderSintetico });
  const final = await elemento("GT-F-011");
  assert.equal(final.estado, "publicado");
  assert.ok(await contarPuntos(undefined, final.id) > 0);
  assert.ok(final.version_publicada_id, "la versión publicada sobrevive a la publicación");
});

test("un GT-P derogado deja sin origen a sus vinculados, que salen con fuera_de_alcance", async () => {
  await correr(informe({ padre: { estado_detectado: "derogado", archivo: null, hash_contenido: null, gmas: gmas("GT-P-004", "0000010207", "Derogado") } }));
  assert.equal((await elemento("GT-P-004")).estado, "derogado");
  assert.equal(await elemento("MG-F-051"), undefined);
  assert.equal(await elemento("GT-F-011"), undefined);
  const objetos = (await notificaciones("fuera_de_alcance")).map(n => n.objeto).sort();
  assert.deepEqual(objetos, ["GT-F-011", "MG-F-051"]);
});

test("vigilante: sin corrida programada en más de 7 días se emite verificacion_atrasada", async () => {
  await verificarAtraso(base.kb);
  assert.equal((await notificaciones("verificacion_atrasada")).length, 0, "hay una corrida reciente");
  await base.kb.query("UPDATE kb.kb_corrida SET terminada_en = now() - interval '8 days'");
  await verificarAtraso(base.kb);
  assert.equal((await notificaciones("verificacion_atrasada")).length, 1);
  await base.kb.query("UPDATE kb.kb_corrida SET programada = false");
  await base.kb.query("UPDATE kb.schema_migrations SET aplicada_en = now() - interval '9 days'");
  await verificarAtraso(base.kb);
  assert.equal((await notificaciones("verificacion_atrasada"))[0].repeticiones, 2, "una corrida manual no cuenta");
});

test("notificaciones y revisar: se listan, se marcan revisadas y la acción queda auditada", async () => {
  const { notificaciones: listar, revisarNotificacion } = await import("../../src/kb/service.js");
  const sinRevisar = await listar(base.kb);
  assert.ok(sinRevisar.length > 0);
  const una = sinRevisar[0];
  assert.equal(await revisarNotificacion(base.kb, una.id, "cli:prueba"), true);
  assert.equal(await revisarNotificacion(base.kb, una.id, "cli:prueba"), false, "ya estaba revisada");
  assert.ok(!(await listar(base.kb)).some(n => n.id === una.id));
  assert.ok((await listar(base.kb, { todas: true })).some(n => n.id === una.id && n.estado === "revisada"));
  await assert.rejects(revisarNotificacion(base.kb, "no-es-un-id", "cli:prueba"), /identificador/);
  const audit = await base.kb.query("SELECT 1 FROM kb.kb_auditoria WHERE accion = 'revisar_notificacion' AND objeto = $1", [una.id]);
  assert.equal(audit.rowCount, 1);
});
