/**
 * SPEC008 US4 (NV-05, NV-06): la expansión real de DOCX/XLSX y el OCR tienen topes que no dependen
 * de lo que declare quien sube el archivo.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { detectarFormato, type LimitesZip } from "../../src/kb/zipInspect.js";
import { convertirArchivo } from "../../src/kb/conversion.js";
import { dpiParaPagina, OcrLimiteError, ocrPdf } from "../../src/kb/ocr.js";

const F = (nombre: string) => path.join(import.meta.dirname, "..", "fixtures", "ocr", nombre);
const LIM: LimitesZip = { maxEntradas: 100, maxExpandido: 1024 * 1024, maxRazon: 1000 };

type Entrada = { nombre: string; datos: Buffer; declarado?: number };

/** ZIP mínimo (deflate) en el que el directorio central puede mentir sobre el tamaño expandido. */
function crearZip(entradas: Entrada[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entradas) {
    const comp = zlib.deflateRawSync(e.datos);
    const nombre = Buffer.from(e.nombre);
    const declarado = e.declarado ?? e.datos.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(declarado, 22); local.writeUInt16LE(nombre.length, 26);
    partes.push(local, nombre, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(declarado, 24); c.writeUInt16LE(nombre.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nombre);
    offset += 30 + nombre.length + comp.length;
  }
  const dirCentral = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entradas.length, 8); eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(dirCentral.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, dirCentral, eocd]);
}

async function enTemporal(bytes: Buffer, nombre: string, fn: (ruta: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-zip-"));
  try {
    const ruta = path.join(dir, nombre);
    await fs.writeFile(ruta, bytes);
    await fn(ruta);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

const base = (extra: Entrada[]): Entrada[] => [
  { nombre: "[Content_Types].xml", datos: Buffer.from("<Types/>") },
  { nombre: "word/document.xml", datos: Buffer.from("<w:document/>") },
  ...extra,
];

test("NV-05: tamaños declarados falsos no evitan el tope de expansión real", async () => {
  // Declara 100 bytes; en realidad infla a 8 MiB (tope de la prueba: 1 MiB).
  const bomba = crearZip(base([{ nombre: "word/relleno.bin", datos: Buffer.alloc(8 * 1024 * 1024), declarado: 100 }]));
  assert.ok(bomba.length < 64 * 1024, "el archivo comprimido es pequeño");
  await enTemporal(bomba, "bomba.docx", async ruta => {
    const r = await detectarFormato(ruta, LIM);
    assert.ok("error" in r, "se rechaza");
    if ("error" in r) assert.match(r.error, /límites de seguridad/);
  });
});

test("NV-05: un DOCX legítimo con expansión moderada se acepta", async () => {
  const ok = crearZip(base([{ nombre: "word/texto.xml", datos: Buffer.from("<p>" + "contenido real ".repeat(5000)) }]));
  await enTemporal(ok, "ok.docx", async ruta => {
    const r = await detectarFormato(ruta, { ...LIM, maxRazon: 10_000 });
    assert.deepEqual(r, { formato: "docx" });
  });
});

test("NV-05: un contenedor con sizes que mienten hacia abajo y razón real excesiva se rechaza por razón", async () => {
  const z = crearZip(base([{ nombre: "word/r.bin", datos: Buffer.alloc(900 * 1024), declarado: 10 }]));
  await enTemporal(z, "razon.docx", async ruta => {
    const r = await detectarFormato(ruta, { ...LIM, maxExpandido: 10 * 1024 * 1024, maxRazon: 50 });
    assert.ok("error" in r);
  });
});

test("NV-06: más páginas que el máximo se descartan antes de rasterizar", async () => {
  await assert.rejects(
    ocrPdf(F("escaneo-legible.pdf"), { limites: { maxPaginas: 0, maxPixelesPagina: 40_000_000, plazoTotalMs: 900_000 } }),
    (e: unknown) => e instanceof OcrLimiteError && e.motivo === "paginas");
});

test("NV-06: una página que no cabe en el tope de píxeles se descarta; una que cabe se reduce de resolución", () => {
  assert.equal(dpiParaPagina(612, 792, 40_000_000), 300, "carta a 300 dpi ≈ 8,4 Mpx cabe");
  const reducida = dpiParaPagina(612 * 4, 792 * 4, 40_000_000);
  assert.ok(reducida < 300 && reducida >= 72, `resolución reducida (${reducida})`);
  assert.throws(() => dpiParaPagina(612 * 40, 792 * 40, 40_000_000), OcrLimiteError);
});

test("NV-06: el plazo total agregado corta el OCR con motivo", async () => {
  let t = 0;
  const ahora = () => { t += 10_000_000; return t; };
  await assert.rejects(
    ocrPdf(F("escaneo-legible.pdf"), { ahora, limites: { maxPaginas: 100, maxPixelesPagina: 40_000_000, plazoTotalMs: 1000 } }),
    (e: unknown) => e instanceof OcrLimiteError && e.motivo === "plazo");
});

test("NV-06: el límite llega a la conversión como descarte con motivo, no como fallo genérico", async () => {
  const anterior = process.env.OCR_PLAZO_TOTAL_MS;
  process.env.OCR_PLAZO_TOTAL_MS = "1";
  try {
    const r = await convertirArchivo(F("escaneo-legible.pdf"));
    assert.equal(r.decision, "descartado_ocr");
    assert.match(r.detalle ?? "", /ocr_excede_limites/);
    assert.equal(r.texto, "");
  } finally {
    if (anterior === undefined) delete process.env.OCR_PLAZO_TOTAL_MS; else process.env.OCR_PLAZO_TOTAL_MS = anterior;
  }
});

test("NV-06: dentro de los topes el OCR da el mismo resultado de siempre", async () => {
  const r = await convertirArchivo(F("escaneo-legible.pdf"));
  assert.equal(r.decision, "cargado");
});
