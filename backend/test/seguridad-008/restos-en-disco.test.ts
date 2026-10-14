/**
 * SPEC008 US6 (NV-11, NV-12): ni el texto extraído de cargas descartadas ni las exportaciones
 * huérfanas sobreviven; la memoria de extracción está acotada.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-cache-"));
process.env.DOCUMENT_CACHE_DIR = path.join(dir, "documents");
const pre = await import("../../src/services/documentPreprocessor.js");

test.after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

async function archivo(nombre: string, texto: string): Promise<string> {
  const ruta = path.join(dir, nombre);
  await fs.writeFile(ruta, texto);
  return ruta;
}
const enCache = async () => (await fs.readdir(process.env.DOCUMENT_CACHE_DIR!).catch(() => [] as string[])).filter(n => n.endsWith(".md"));

test("NV-11: descartar una extracción borra la copia en disco y la memoria", async () => {
  const ruta = await archivo("carga-descartada.txt", "Nombre: Juan Pérez, cédula 123456789 (dato personal)");
  const e = await pre.preprocessDocument(ruta);
  assert.equal(e.ok, true);
  assert.equal((await enCache()).length, 1, "la copia diagnóstica existe tras extraer");
  await pre.discardExtraction(ruta);
  assert.equal((await enCache()).length, 0, "ya no hay texto extraído en disco");
  // Sin memoria: borrar el archivo y volver a pedir no devuelve el texto viejo de la caché.
  await fs.writeFile(ruta, "contenido distinto");
  const otra = await pre.preprocessDocument(ruta);
  assert.equal(otra.ok && otra.text.includes("123456789"), false);
});

test("NV-11: la memoria de extracción no crece sin límite", async () => {
  for (let i = 0; i < 40; i++) await pre.preprocessDocument(await archivo(`m${i}.txt`, `texto número ${i}`));
  // El barrido por edad elimina copias diagnósticas viejas sin tocar las recientes.
  const antes = (await enCache()).length;
  assert.ok(antes >= 40);
  assert.equal(await pre.sweepDocumentCache(24 * 60 * 60_000), 0, "nada supera las 24 h");
  const viejas = (await fs.readdir(process.env.DOCUMENT_CACHE_DIR!)).slice(0, 10);
  const hace2dias = new Date(Date.now() - 48 * 60 * 60_000);
  for (const n of viejas) await fs.utimes(path.join(process.env.DOCUMENT_CACHE_DIR!, n), hace2dias, hace2dias);
  assert.equal(await pre.sweepDocumentCache(24 * 60 * 60_000), 10);
  assert.equal((await enCache()).length, antes - 10);
});

test("NV-12: limpiarExportacionesViejas elimina huérfanas y conserva las recientes", async () => {
  process.env.KB_UPLOAD_DIR = path.join(dir, "cargas");
  const { limpiarExportacionesViejas } = await import("../../src/admin/export.js");
  const exp = path.join(process.env.KB_UPLOAD_DIR, "exportaciones");
  await fs.mkdir(exp, { recursive: true });
  const vieja = path.join(exp, "vieja.xlsx"); const nueva = path.join(exp, "nueva.xlsx");
  await fs.writeFile(vieja, "x"); await fs.writeFile(nueva, "x");
  const hace2h = new Date(Date.now() - 2 * 60 * 60_000);
  await fs.utimes(vieja, hace2h, hace2h);
  assert.equal(await limpiarExportacionesViejas(60 * 60_000), 1);
  await assert.rejects(fs.stat(vieja));
  await fs.stat(nueva);
});
