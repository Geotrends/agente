/** Archivos sintéticos válidos (PDF, DOCX, XLSX) para las cargas manuales de las pruebas. */
import JSZip from "jszip";
import * as XLSX from "xlsx";

/** PDF de una página con texto nativo (>80 caracteres: no activa el OCR). */
export function crearPdf(lineas: string[]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, m => `\\${m}`).replace(/[^\x20-\x7e]/g, c => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u", ñ: "n", Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ñ: "N" } as Record<string, string>)[c] ?? "?");
  const contenido = ["BT", "/F1 12 Tf", "72 740 Td", "14 TL", ...lineas.map(l => `(${esc(l)}) Tj T*`), "ET"].join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(contenido)} >>\nstream\n${contenido}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objetos.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const xmlEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function crearDocx(parrafos: string[]): Promise<Buffer> {
  const z = new JSZip();
  z.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    parrafos.map(p => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join("") + `</w:body></w:document>`);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function crearXlsx(filas: string[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Hoja1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Texto de relleno suficientemente largo para superar el umbral de OCR. */
export const RELLENO = "Este documento de prueba describe el procedimiento institucional con suficiente texto nativo para su conversión local.";
