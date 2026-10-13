/**
 * Descarte por OCR contra PostgreSQL y Qdrant reales (T053; RF-C3-IV-07, SC-006):
 * un escaneo ilegible queda registrado y notificado, no entra a la matriz y,
 * si el elemento ya estaba publicado, sigue sirviendo su versión anterior.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { qdrant } from "../../src/services/qdrant.js";
import { publicar } from "../../src/kb/service.js";
import { procesarInforme } from "../../src/kb/sync.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";
import { embedderSintetico, prepararQdrantDePrueba } from "./qdrantPruebas.js";

const A = "https://ambientometroenvigado.com";
const FIXTURES = path.join(import.meta.dirname, "..", "fixtures", "ocr");
const BOLETIN = `${A}/wp-content/uploads/boletin.pdf`;

let base: BaseDePrueba;
let alias: string;
let datos: string;

function informe(archivoOriginal: string, hash: string) {
  return {
    schema_version: 1, run_id: randomUUID(), programada: true, completa: false,
    iniciada_en: new Date().toISOString(), terminada_en: new Date().toISOString(),
    fuentes: ["ambientometro"],
    enlaces: [{
      fuente: "ambientometro", fecha_hora: new Date().toISOString(), rol: "documento", padre: `${A}/docs/`, titulo: "Boletín",
      estado_detectado: "no_aplica", resultado: "nuevo", error: null, hash_contenido: null,
      archivo: null, archivo_original: archivoOriginal, hash_original: hash, gmas: null, url: BOLETIN,
    }],
  };
}

async function sincronizar(archivo: string, hash: string): Promise<void> {
  await fs.copyFile(path.join(FIXTURES, archivo), path.join(datos, "ambientometro", "documentos", "pdf", "boletin.pdf"));
  const ruta = path.join(datos, "runs", `${randomUUID()}.json`);
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  await fs.writeFile(ruta, JSON.stringify(informe("ambientometro/documentos/pdf/boletin.pdf", hash)));
  await procesarInforme(base.kb, ruta);
}

before(async () => {
  base = await crearBaseDePrueba();
  alias = prepararQdrantDePrueba();
  datos = await fs.mkdtemp(path.join(os.tmpdir(), "kb-ocr-int-"));
  process.env.GEOTRENDS_DOCUMENTS_ROOT = datos;
  await fs.mkdir(path.join(datos, "ambientometro", "documentos", "pdf"), { recursive: true });
});

after(async () => {
  await base?.borrar();
  await fs.rm(datos, { recursive: true, force: true });
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

test("un escaneo ilegible se registra, se notifica y no crea elemento", async () => {
  await sincronizar("escaneo-ilegible.pdf", "a".repeat(64));
  const proc = await base.kb.query("SELECT decision, ocr_aplicado, confianza_ocr FROM kb.kb_procesamiento");
  assert.equal(proc.rowCount, 1);
  assert.equal(proc.rows[0].decision, "descartado_ocr");
  assert.equal(proc.rows[0].ocr_aplicado, true);
  assert.ok(Number(proc.rows[0].confianza_ocr) <= 80);
  const notif = await base.kb.query("SELECT descripcion FROM kb.kb_notificacion WHERE tipo = 'descarte_ocr'");
  assert.equal(notif.rowCount, 1);
  assert.match(notif.rows[0].descripcion, /confianza/);
  assert.equal((await base.kb.query("SELECT 1 FROM kb.kb_elemento")).rowCount, 0, "no hay nada publicable");
});

test("un escaneo legible se carga como pendiente y, publicado, un descarte posterior no lo toca", async () => {
  await sincronizar("escaneo-legible.pdf", "b".repeat(64));
  const el = await base.kb.query("SELECT clave, estado FROM kb.kb_elemento");
  assert.equal(el.rowCount, 1);
  assert.equal(el.rows[0].estado, "pendiente_aprobacion");
  await publicar(base.kb, { todosPendientes: true }, "cli:prueba", { embedder: embedderSintetico });
  const antes = await base.kb.query("SELECT version_publicada_id, version_pendiente_id FROM kb.kb_elemento");

  await sincronizar("escaneo-ilegible.pdf", "c".repeat(64));
  const despues = await base.kb.query("SELECT estado, version_publicada_id, version_pendiente_id FROM kb.kb_elemento");
  assert.equal(despues.rows[0].estado, "publicado");
  assert.equal(despues.rows[0].version_publicada_id, antes.rows[0].version_publicada_id, "sigue la versión anterior");
  assert.equal(despues.rows[0].version_pendiente_id, null);
  const descartes = await base.kb.query("SELECT 1 FROM kb.kb_procesamiento WHERE decision = 'descartado_ocr'");
  assert.equal(descartes.rowCount, 2);
});
