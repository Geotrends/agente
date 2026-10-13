/**
 * Enlaces de descarga para códigos de formato citados en la respuesta.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentCodeIndex, linkDocumentCodes } from "../src/services/documentLinks.js";
import type { SourceMetadata } from "../src/services/sourceMetadata.js";

const URL_0076 = "https://gmas2.envigado.gov.co/gmas/downloadFile.public?repositorioArchivo=376754";
const URL_011 = "https://gmas2.envigado.gov.co/gmas/downloadFile.public?repositorioArchivo=11";
const PAGE_076 = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000013837";
const PAGE_P011 = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010446";

function catalog(entries: Record<string, SourceMetadata>) {
  return { byPath: new Map(Object.entries(entries)), signature: "x" };
}

// Refleja el corpus real: la página titula "GT-F-076" y el archivo "GT-F-0076".
const index = buildDocumentCodeIndex(catalog({
  "gmas/paginas_md/gt-f-076_-_solicitud.md": {
    title: "GT-F-076 - Solicitud Identificación por medio de microchip",
    sourceUrl: PAGE_076,
  },
  "gmas/documentos/word/gt-f-0076_solicitud_microchip.docx": {
    title: "GT-F-0076 Solicitud Identificación por medio de microchip",
    sourceUrl: URL_0076,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  // Sin título útil: el código sale del nombre de archivo.
  "gmas/documentos/pdf/gt-f-011_formato.pdf": {
    sourceUrl: URL_011,
    mimeType: "application/pdf",
  },
  // Procedimiento: solo existe como página del visor, sin archivo descargado.
  "gmas/paginas_md/gt-p-011_-_procedimiento.md": {
    title: "GT-P-011 - Procedimiento para Registro Unico de Mascotas",
    sourceUrl: PAGE_P011,
  },
  // Solo MENCIONA un código: no debe quedarse con su enlace.
  "gmas/documentos/pdf/instructivo.pdf": {
    title: "Instructivo para diligenciar el GT-F-0099",
    sourceUrl: "https://example.gov.co/instructivo.pdf",
    mimeType: "application/pdf",
  },
}));

test("el archivo descargable gana sobre la página, aunque difieran los ceros a la izquierda", () => {
  assert.equal(linkDocumentCodes("GT-F-076", index), `[GT-F-076](${URL_0076})`);
  assert.equal(linkDocumentCodes("GT-F-0076", index), `[GT-F-0076](${URL_0076})`);
});

test("un procedimiento GT-P sin archivo enlaza a su página", () => {
  assert.equal(linkDocumentCodes("según el GT-P-011.", index), `según el [GT-P-011](${PAGE_P011}).`);
});

test("el código sale del nombre de archivo cuando no hay título", () => {
  assert.equal(linkDocumentCodes("el gt-f-011", index), `el [gt-f-011](${URL_011})`);
});

test("un documento que solo menciona un código no se queda con su enlace", () => {
  assert.equal(linkDocumentCodes("GT-F-0099", index), "GT-F-0099");
});

test("dentro de negrita y de celdas de tabla también se enlaza", () => {
  assert.equal(linkDocumentCodes("**Formulario GT-F-0076**", index), `**Formulario [GT-F-0076](${URL_0076})**`);
  assert.equal(linkDocumentCodes("| GT-P-011 | x |", index), `| [GT-P-011](${PAGE_P011}) | x |`);
});

test("enlaces relativos copiados de GMAS se apuntan a la URL del catálogo", () => {
  assert.equal(
    linkDocumentCodes("[GT-F-076 - Solicitud](VisualizacionDocumento.public?documento=0000013837)", index),
    `[GT-F-076 - Solicitud](${URL_0076})`,
  );
});

test("enlaces javascript:downloadFile(...) de GMAS se apuntan a la URL del catálogo", () => {
  const copied = '[GT-F-0076 Solicitud.docx](javascript:downloadFile("000000376754", "/documentacion/0000013837/0000000077"))';
  assert.equal(linkDocumentCodes(copied, index), `[GT-F-0076 Solicitud.docx](${URL_0076})`);
});

test("un enlace no navegable sin código conocido queda como texto", () => {
  assert.equal(linkDocumentCodes('Ver [el formato](javascript:downloadFile("1", "/x")).', index), "Ver el formato.");
});

test("no toca enlaces http(s) ya escritos, código en línea ni URLs", () => {
  const text = [
    `[GT-F-0076](https://otra.gov.co/x)`,
    "`GT-F-0076`",
    "https://example.gov.co/GT-F-0076.pdf",
  ].join(" ");
  assert.equal(linkDocumentCodes(text, index), text);
});

test("códigos desconocidos o parciales quedan como texto", () => {
  const text = "Ver GT-F-9999, GT-F-00761 y XGT-F-0076.";
  assert.equal(linkDocumentCodes(text, index), text);
});

test("códigos con guion no separable (U+2011) o en dash también se enlazan", () => {
  // gpt-oss escribe "GT‑F‑0076" con U+2011; el texto enlazado conserva su forma.
  assert.equal(linkDocumentCodes("el GT‑F‑0076", index), `el [GT‑F‑0076](${URL_0076})`);
  assert.equal(linkDocumentCodes("(GT–P–011)", index), `([GT–P–011](${PAGE_P011}))`);
});

test("el índice desde la vista de códigos publicados normaliza códigos y exige https", async () => {
  const { indiceDesdeFilas } = await import("../src/services/documentLinks.js");
  const indice = indiceDesdeFilas([
    { codigo: "GT-F-0076", url: URL_0076 },
    { codigo: "GT-P-011", url: PAGE_P011 },
    { codigo: "GT-F-012", url: "http://inseguro/x" },
  ]);
  assert.equal(linkDocumentCodes("el GT-F-076", indice), `el [GT-F-076](${URL_0076})`);
  assert.equal(linkDocumentCodes("GT-P-011", indice), `[GT-P-011](${PAGE_P011})`);
  assert.equal(linkDocumentCodes("GT-F-012", indice), "GT-F-012", "sin https no se enlaza");
});
