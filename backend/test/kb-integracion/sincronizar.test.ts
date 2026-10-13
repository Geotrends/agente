/**
 * Sincronización de la base contra PostgreSQL y Qdrant reales (T029;
 * RF-C3-IV-01, IV-11; FR-003, FR-005, FR-017; contrato de corrida reglas 6 y 7).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { qdrant } from "../../src/services/qdrant.js";
import { auditarAlcance, publicar } from "../../src/kb/service.js";
import { procesarInforme } from "../../src/kb/sync.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";
import { embedderSintetico, prepararQdrantDePrueba } from "./qdrantPruebas.js";

const G = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=";
const D = "https://gmas2.envigado.gov.co/gmas/downloadFile.public?repositorioArchivo=";
const A = "https://ambientometroenvigado.com";

let base: BaseDePrueba;
let alias: string;
let datos: string;

const gmas = (codigo: string, id: string, vinculados: Array<[string, string, string]> = [], descarga: string | null = null) => ({
  id, codigo, nombre: `Nombre de ${codigo}`, version: "06", fecha_actualizacion: "2022-09-12", estado: "Vigente",
  dependencia: "SECRETARÍA", descarga,
  vinculados: vinculados.map(([c, i, grupo]) => ({ codigo: c, nombre: c, id: i, url: G + i, grupo })),
});

function informe(enlaces: unknown[], completa = true) {
  return {
    schema_version: 1, run_id: randomUUID(), programada: true, completa,
    iniciada_en: new Date().toISOString(), terminada_en: new Date().toISOString(),
    fuentes: ["gmas2_envigado", "ambientometro"], enlaces,
  };
}

const enlace = (extra: Record<string, unknown>) => ({
  fuente: "gmas2_envigado", fecha_hora: new Date().toISOString(), rol: "vinculado", padre: null, titulo: null,
  estado_detectado: "vigente", resultado: "nuevo", error: null, hash_contenido: null,
  archivo: null, archivo_original: null, hash_original: null, gmas: null, ...extra,
});

async function escribir(rel: string, contenido: string): Promise<string> {
  await fs.mkdir(path.dirname(path.join(datos, rel)), { recursive: true });
  await fs.writeFile(path.join(datos, rel), contenido, "utf8");
  return rel;
}

async function guardarInforme(datosInforme: unknown): Promise<string> {
  const ruta = path.join(datos, "runs", `${(datosInforme as { run_id: string }).run_id}.json`);
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  await fs.writeFile(ruta, JSON.stringify(datosInforme));
  return ruta;
}

const md = (titulo: string, cuerpo: string) => `---\ntitle: "${titulo}"\nsource_url: "x"\n---\n\n# ${titulo}\n\n${cuerpo}\n`;

function enlacesBase(conMgf051 = true) {
  const vinculados: Array<[string, string, string]> = [["GT-F-011", "0000013830", "Registros"]];
  if (conMgf051) vinculados.push(["MG-F-051", "0000012522", "Registros"]);
  return [
    enlace({ url: G + "0000010207", rol: "procedimiento", hash_contenido: "1".repeat(64),
      archivo: "gmas2_envigado/paginas_md/gmas/gt-p-004.md", gmas: gmas("GT-P-004", "0000010207", vinculados) }),
    enlace({ url: G + "0000013830", padre: G + "0000010207", hash_contenido: "2".repeat(64),
      archivo: "gmas2_envigado/paginas_md/gmas/gt-f-011.md", gmas: gmas("GT-F-011", "0000013830", [], D + "11") }),
    enlace({ url: D + "11", rol: "descarga", padre: G + "0000013830", estado_detectado: "no_aplica",
      archivo_original: "gmas2_envigado/documentos/txt/gt-f-011.txt", hash_original: "3".repeat(64) }),
    ...(conMgf051 ? [enlace({ url: G + "0000012522", padre: G + "0000010207", hash_contenido: "4".repeat(64),
      archivo: "gmas2_envigado/paginas_md/gmas/mg-f-051.md", gmas: gmas("MG-F-051", "0000012522") })] : []),
    enlace({ url: `${A}/calidad-del-aire/`, fuente: "ambientometro", rol: "pagina", estado_detectado: "no_aplica",
      titulo: "Calidad del aire", hash_contenido: "5".repeat(64), archivo: "ambientometro/paginas_md/calidad.md" }),
    enlace({ url: `${A}/wp-content/uploads/boletin-abril.txt`, fuente: "ambientometro", rol: "documento",
      padre: `${A}/docs/boletines-2025/calidad-de-aire/abril/`, estado_detectado: "no_aplica", titulo: "Boletín abril",
      archivo_original: "ambientometro/documentos/txt/boletin-abril.txt", hash_original: "6".repeat(64) }),
  ];
}

before(async () => {
  base = await crearBaseDePrueba();
  alias = prepararQdrantDePrueba();
  datos = await fs.mkdtemp(path.join(os.tmpdir(), "kb-sync-"));
  process.env.GEOTRENDS_DOCUMENTS_ROOT = datos;
  await escribir("gmas2_envigado/paginas_md/gmas/gt-p-004.md", md("GT-P-004 - Procedimiento", "Recibir solicitud y diligenciar el GT-F-011."));
  await escribir("gmas2_envigado/paginas_md/gmas/gt-f-011.md", md("GT-F-011 - Trámites Ambientales", "Visor del formato."));
  await escribir("gmas2_envigado/documentos/txt/gt-f-011.txt", "SOLICITUD DE GESTIÓN DE TRÁMITES AMBIENTALES\nNOMBRE:\nCÉDULA:\nTELÉFONO:");
  await escribir("gmas2_envigado/paginas_md/gmas/mg-f-051.md", md("MG-F-051 - Evaluación", "Evaluación del servicio."));
  await escribir("ambientometro/paginas_md/calidad.md", md("Calidad del aire", "Envigado mide el material particulado PM2.5."));
  await escribir("ambientometro/documentos/txt/boletin-abril.txt", "Boletín de calidad del aire de abril de 2025.");
});

after(async () => {
  await base?.borrar();
  await fs.rm(datos, { recursive: true, force: true });
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

test("una corrida crea la matriz en pendiente, con los 12 campos y N/A solo en el Observatorio", async () => {
  await procesarInforme(base.kb, await guardarInforme(informe(enlacesBase())));
  const { rows } = await base.kb.query("SELECT * FROM kb.v_matriz ORDER BY tipo_interno, codigo");
  assert.equal(rows.length, 5, "GT-P-004, GT-F-011, MG-F-051, una página y un PDF; la descarga no es elemento propio");
  for (const r of rows) {
    assert.equal(r.estado, "Pendiente de aprobación");
    for (const col of ["codigo", "nombre", "tipo", "direccion", "url_origen", "estado", "version", "fecha_actualizacion",
      "formato_original", "uso_ocr", "fecha_carga", "procedimiento_origen"]) {
      assert.ok(r[col] !== null && r[col] !== "", `${col} vacío en ${r.url_origen}`);
    }
    const observatorio = r.fuente !== "gmas2_envigado";
    assert.equal(r.codigo === "N/A", observatorio);
    assert.equal(r.version === "N/A", observatorio);
    assert.equal(r.fecha_actualizacion === "N/A", observatorio);
    if (observatorio) assert.equal(r.procedimiento_origen, "Ambientómetro");
  }
  const formato = rows.find(r => r.codigo === "GT-F-011");
  assert.equal(formato.formato_original, "TXT", "el contenido del formato es su archivo descargable");
  assert.equal(formato.procedimiento_origen, "GT-P-004");
});

test("publicar indexa sin cambiar la fecha de carga y la auditoría de alcance pasa", async () => {
  const antes = await base.kb.query("SELECT clave, fecha_carga FROM kb.kb_elemento ORDER BY clave");
  const { publicados } = await publicar(base.kb, { todosPendientes: true }, "cli:prueba", { embedder: embedderSintetico });
  assert.equal(publicados.length, 5);
  const despues = await base.kb.query("SELECT clave, fecha_carga, estado FROM kb.kb_elemento ORDER BY clave");
  assert.deepEqual(despues.rows.map(r => r.fecha_carga.getTime()), antes.rows.map(r => r.fecha_carga.getTime()));
  assert.ok(despues.rows.every(r => r.estado === "publicado"));
  const auditoria = await auditarAlcance(base.kb);
  assert.equal(auditoria.ok, true, JSON.stringify(auditoria));
});

test("un informe completo sin un vinculado lo da de baja, con notificación y sin puntos", async () => {
  await procesarInforme(base.kb, await guardarInforme(informe(enlacesBase(false))));
  const { rows } = await base.kb.query("SELECT clave FROM kb.kb_elemento WHERE clave = 'MG-F-051'");
  assert.equal(rows.length, 0);
  const notif = await base.kb.query("SELECT * FROM kb.kb_notificacion WHERE tipo = 'fuera_de_alcance' AND objeto = 'MG-F-051'");
  assert.equal(notif.rows.length, 1);
  assert.equal((await auditarAlcance(base.kb)).ok, true);
});

test("si un GT-P del alcance falta en un informe completo, se notifica procedimiento_faltante", async () => {
  const { rows } = await base.kb.query(
    "SELECT objeto FROM kb.kb_notificacion WHERE tipo = 'procedimiento_faltante' ORDER BY objeto");
  assert.deepEqual(rows.map(r => r.objeto), ["GT-P-011", "GT-P-020", "GT-P-021", "GT-P-027", "GT-P-029"]);
});

test("US2: la versión de un procedimiento es su ficha de 10 campos (RF-C3-IV-05)", async () => {
  const { leerEncabezado } = await import("../../src/kb/fichas.js");
  const { rows } = await base.kb.query(
    `SELECT v.contenido_md FROM kb.kb_elemento e JOIN kb.kb_version v ON v.id = e.version_publicada_id WHERE e.clave = 'GT-P-004'`);
  const campos = leerEncabezado(rows[0].contenido_md);
  assert.equal(Object.keys(campos).length, 10);
  assert.equal(campos.direccion_responsable, "Gestión Ambiental");
  // La versión publicada es la de la primera corrida (el hash de la página no
  // cambió en esta prueba), que citaba GT-F-011 y MG-F-051.
  assert.deepEqual(campos.formatos_vinculados, ["GT-F-011", "MG-F-051"]);
});

test("US2: un formato diligenciado no se carga, se notifica y sigue la versión publicada (RF-C3-IV-10)", async () => {
  await escribir("gmas2_envigado/documentos/txt/gt-f-011.txt", "SOLICITUD DE GESTIÓN DE TRÁMITES AMBIENTALES\nNOMBRE: Juan Pérez\nCÉDULA: 1036123456\nTELÉFONO:");
  const enlaces = enlacesBase(false).map(e => (e as unknown as { url: string }).url === D + "11" ? { ...e, hash_original: "7".repeat(64) } : e);
  await procesarInforme(base.kb, await guardarInforme(informe(enlaces)));
  const el = await base.kb.query("SELECT estado, version_pendiente_id FROM kb.kb_elemento WHERE clave = 'GT-F-011'");
  assert.equal(el.rows[0].estado, "publicado");
  assert.equal(el.rows[0].version_pendiente_id, null, "no queda versión pendiente con datos personales");
  const proc = await base.kb.query("SELECT decision FROM kb.kb_procesamiento WHERE clave_elemento = 'GT-F-011' ORDER BY fecha DESC LIMIT 1");
  assert.equal(proc.rows[0].decision, "formato_diligenciado");
  const notif = await base.kb.query("SELECT 1 FROM kb.kb_notificacion WHERE tipo = 'formato_con_datos_personales' AND objeto = 'GT-F-011'");
  assert.equal(notif.rowCount, 1);
});

test("US2: exportar-fichas escribe la ficha y la página publicadas, y audita (RF-C3-IV-05, IV-06)", async () => {
  const { exportarFichas } = await import("../../src/kb/service.js");
  const salida = path.join(datos, "exports", "fichas");
  const r = await exportarFichas(base.kb, salida, "cli:prueba");
  assert.deepEqual(r.archivos.sort(), ["ambientometroenvigado-com-calidad-del-aire.md", "gt-p-004.md"]);
  const { leerEncabezado } = await import("../../src/kb/fichas.js");
  const ficha = leerEncabezado(await fs.readFile(path.join(salida, "gt-p-004.md"), "utf8"));
  assert.equal(ficha.codigo, "GT-P-004");
  const pagina = leerEncabezado(await fs.readFile(path.join(salida, "ambientometroenvigado-com-calidad-del-aire.md"), "utf8"));
  assert.equal(pagina.url_origen, `${A}/calidad-del-aire/`);
  const audit = await base.kb.query("SELECT resultado FROM kb.kb_auditoria WHERE accion = 'exportar_fichas'");
  assert.equal(audit.rows[0]?.resultado, "2 archivos");
});

test("US6: la exportación de la matriz real tiene una fila por elemento y N/A solo donde corresponde (RF-C3-IV-12)", async () => {
  const XLSX = await import("xlsx");
  const { exportarMatriz } = await import("../../src/kb/exportMatrix.js");
  const salida = path.join(datos, "exports", "matriz");
  const r = await exportarMatriz(base.kb, salida);
  const libro = XLSX.read(await fs.readFile(r.ruta));
  const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets["Matriz documental"], { header: 1, raw: true });
  const total = (await base.kb.query("SELECT count(*)::int AS n FROM kb.kb_elemento")).rows[0].n;
  assert.equal(filas.length - 1, total);
  assert.ok(filas.every(f => f.length === 12));
  const fuentes = (await base.kb.query("SELECT codigo, fuente FROM kb.v_matriz ORDER BY tipo_interno, COALESCE(NULLIF(codigo, 'N/A'), nombre), nombre")).rows;
  for (const [i, fila] of filas.slice(1).entries()) {
    const observatorio = fuentes[i].fuente !== "gmas2_envigado";
    for (const [col, celda] of fila.entries()) {
      assert.equal(celda === "N/A", observatorio && [0, 6, 7].includes(col), `fila ${i + 2}, columna ${col + 1}: ${celda}`);
    }
    assert.ok(String(fila[10]).length > 0);
  }
});
