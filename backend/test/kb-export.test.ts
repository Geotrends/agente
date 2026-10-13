/**
 * Exportación de la matriz a .xlsx (T072; RF-C3-IV-11, RF-C3-IV-12; contracts/matriz-xlsx.md).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { celdaSegura, COLUMNAS, exportarMatriz, HOJA, type FilaMatriz } from "../src/kb/exportMatrix.js";
import type { Pool } from "../src/kb/db.js";

const ENCABEZADOS = [
  "Código", "Nombre", "Tipo", "Dirección responsable", "URL de origen", "Estado", "Versión",
  "Fecha de última actualización", "Formato original", "Uso de OCR", "Fecha de carga", "Procedimiento de origen",
];

const gmas: FilaMatriz = {
  codigo: "GT-P-004", nombre: "Procedimiento permisos y autorizaciones ambientales", tipo: "Procedimiento",
  direccion: "Gestión Ambiental", url_origen: "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010207",
  estado: "Publicado", version: "06", fecha_actualizacion: "12/09/2022", formato_original: "HTML", uso_ocr: "No",
  fecha_carga: "07/10/2026 10:30", procedimiento_origen: "GT-P-004", tipo_interno: "procedimiento",
};
const observatorio: FilaMatriz = {
  codigo: "N/A", nombre: "=HYPERLINK(\"http://x\",\"clic\")", tipo: "Página", direccion: "Ecosistemas",
  url_origen: "https://ambientometroenvigado.com/calidad-del-aire/", estado: "Pendiente de aprobación", version: "N/A",
  fecha_actualizacion: "N/A", formato_original: "HTML", uso_ocr: "No", fecha_carga: "07/10/2026 11:00",
  procedimiento_origen: "Ambientómetro", tipo_interno: "pagina",
};

async function exportar(filas: FilaMatriz[], ahora = new Date("2026-10-08T03:00:00Z")) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kb-export-"));
  const db = { query: async () => ({ rows: filas }) } as unknown as Pool;
  const r = await exportarMatriz(db, dir, ahora);
  const libro = XLSX.read(await fs.readFile(r.ruta));
  return { dir, r, libro, filas: XLSX.utils.sheet_to_json<string[]>(libro.Sheets[HOJA], { header: 1, raw: true }) };
}

test("el contrato fija 12 columnas con sus encabezados, en orden", () => {
  assert.deepEqual(COLUMNAS.map(([, e]) => e), ENCABEZADOS);
});

test("la hoja se llama 'Matriz documental', con encabezados y una fila por elemento", async () => {
  const { dir, r, libro, filas } = await exportar([gmas, observatorio]);
  try {
    assert.deepEqual(libro.SheetNames, ["Matriz documental"]);
    assert.deepEqual(filas[0], ENCABEZADOS);
    assert.equal(filas.length, 3, "encabezado + 2 elementos");
    assert.equal(r.filas, 2);
    assert.ok(filas.every(f => f.length === 12), "12 columnas exactas");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("N/A solo en las columnas 1, 7 y 8 y solo en filas del Observatorio; la columna 12 lleva la fuente", async () => {
  const { dir, filas } = await exportar([gmas, observatorio]);
  try {
    const [, g, o] = filas;
    for (const [i, celda] of g.entries()) assert.notEqual(celda, "N/A", `columna ${i + 1} de GMAS2`);
    for (const [i, celda] of o.entries()) {
      assert.equal(celda === "N/A", [0, 6, 7].includes(i), `columna ${i + 1} del Observatorio: ${celda}`);
    }
    assert.equal(o[11], "Ambientómetro");
    assert.ok(filas.slice(1).every(f => String(f[10]).length > 0), "la fecha de carga nunca está vacía");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("una celda que empieza por = + - o @ sale con apóstrofo", async () => {
  assert.equal(celdaSegura("=1+1"), "'=1+1");
  assert.equal(celdaSegura("+57 300"), "'+57 300");
  assert.equal(celdaSegura("-5"), "'-5");
  assert.equal(celdaSegura("@usuario"), "'@usuario");
  assert.equal(celdaSegura("Normal"), "Normal");
  assert.equal(celdaSegura(null), "");
  const { dir, filas } = await exportar([observatorio]);
  try {
    assert.equal(filas[1][1], "'=HYPERLINK(\"http://x\",\"clic\")");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("el nombre del archivo usa la fecha de America/Bogota, no la UTC", async () => {
  // 03:00 UTC del 8 de octubre son las 22:00 del 7 en Bogotá.
  const { dir, r } = await exportar([gmas]);
  try {
    assert.equal(path.basename(r.ruta), "matriz-documental-2026-10-07.xlsx");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
