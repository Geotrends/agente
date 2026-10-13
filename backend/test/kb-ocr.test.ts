/**
 * OCR con confianza medida (T052; RF-C3-IV-07, RF-C3-IV-08, research R6/R7).
 * Usa Tesseract y poppler reales con las fixtures de test/fixtures/ocr.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { convertirArchivo } from "../src/kb/conversion.js";
import { confianzaMedia, palabrasDeTsv } from "../src/kb/ocr.js";

const F = (nombre: string) => path.join(import.meta.dirname, "fixtures", "ocr", nombre);

const TSV_CABECERA = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const fila = (nivel: number, conf: number, texto: string) => `${nivel}\t1\t1\t1\t1\t1\t0\t0\t10\t10\t${conf}\t${texto}`;

test("la confianza es la media por palabra con conf >= 0 (TSV sintético)", () => {
  const tsv = [
    TSV_CABECERA,
    fila(1, -1, ""), fila(4, -1, ""),
    fila(5, 90, "uno"), fila(5, 70, "dos"), fila(5, 80, "tres"),
    fila(5, -1, "descartada"), fila(5, 100, "   "),
  ].join("\n");
  assert.deepEqual(palabrasDeTsv(tsv), { suma: 240, palabras: 3 });
  assert.equal(confianzaMedia([tsv]).confianzaMedia, 80);
  const otra = [TSV_CABECERA, fila(5, 100, "cuatro")].join("\n");
  assert.equal(confianzaMedia([tsv, otra]).confianzaMedia, 85, "la media es de todas las palabras de todas las páginas");
  assert.equal(confianzaMedia([TSV_CABECERA]).confianzaMedia, 0, "sin palabras la confianza es 0");
});

test("el umbral de 80 caracteres nativos: 79 pasa por OCR, 80 no", async () => {
  const con79 = await convertirArchivo(F("nativo-79.pdf"));
  assert.equal(con79.caracteresNativos, 79);
  assert.equal(con79.ocrAplicado, true);
  const con80 = await convertirArchivo(F("nativo-80.pdf"));
  assert.equal(con80.caracteresNativos, 80);
  assert.equal(con80.ocrAplicado, false);
  assert.equal(con80.decision, "cargado");
  assert.equal(con80.confianzaOcr, null);
});

test("una imagen y un DOCX escaneado pasan por OCR", async () => {
  const imagen = await convertirArchivo(F("imagen.png"));
  assert.equal(imagen.ocrAplicado, true);
  assert.equal(imagen.decision, "cargado");
  assert.ok(imagen.confianzaOcr! > 80, `confianza ${imagen.confianzaOcr}`);
  assert.match(imagen.texto, /SECRETAR[ÍI]A/i);
  const docx = await convertirArchivo(F("docx-escaneado.docx"));
  assert.equal(docx.caracteresNativos, 0);
  assert.equal(docx.ocrAplicado, true);
  assert.equal(docx.decision, "cargado");
  assert.match(docx.texto, /Solicitud de visita/i);
});

test("el escaneo legible se carga y el ilegible se descarta, con su confianza", async () => {
  const legible = await convertirArchivo(F("escaneo-legible.pdf"));
  assert.equal(legible.decision, "cargado");
  assert.ok(legible.confianzaOcr! > 80, `confianza ${legible.confianzaOcr}`);
  assert.match(legible.texto, /tala o poda/i);

  const ilegible = await convertirArchivo(F("escaneo-ilegible.pdf"));
  assert.equal(ilegible.ocrAplicado, true);
  assert.equal(ilegible.decision, "descartado_ocr");
  assert.ok(ilegible.confianzaOcr! <= 80, `confianza ${ilegible.confianzaOcr}`);
  assert.equal(ilegible.texto, "", "un descarte no entrega texto");
});

test("un PDF con 80 o más caracteres de texto basura se carga con calidad_nativa_baja", async () => {
  const r = await convertirArchivo(F("nativo-ilegible.pdf"));
  assert.ok(r.caracteresNativos >= 80);
  assert.equal(r.ocrAplicado, false);
  assert.equal(r.decision, "cargado");
  assert.equal(r.calidadNativaBaja, true);
});

test("un TXT corto nunca pasa por OCR (XLSX y DOC tampoco: solo PDF, DOCX e imágenes lo admiten)", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kb-ocr-"));
  try {
    const txt = path.join(dir, "corto.txt");
    await fs.writeFile(txt, "poco");
    const r = await convertirArchivo(txt);
    assert.equal(r.ocrAplicado, false);
    assert.equal(r.caracteresNativos, 4);
    assert.equal(r.decision, "cargado");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
