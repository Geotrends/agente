import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const execFileAsync = promisify(execFile);
export const DOCUMENT_PREPROCESSOR_VERSION = "markdown-v3";
const cacheDir = path.resolve(process.env.DOCUMENT_CACHE_DIR || ".cache/documents");
/**
 * Memoria de extracciones (SPEC008, NV-11). Acotada en número y en tiempo: antes crecía sin límite
 * con cada archivo procesado y conservaba el texto —que puede traer datos personales— de cargas
 * ya descartadas.
 */
const MEMORY_MAX_ENTRIES = 16;
const MEMORY_TTL_MS = 10 * 60_000;
const contentCache = new Map<string, { stamp: string; extraction: Extraction; at: number }>();

function rememberExtraction(filePath: string, stamp: string, extraction: Extraction): void {
  contentCache.delete(filePath);
  while (contentCache.size >= MEMORY_MAX_ENTRIES) {
    const oldest = contentCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    contentCache.delete(oldest);
  }
  contentCache.set(filePath, { stamp, extraction, at: Date.now() });
}

const pathHash = (filePath: string): string =>
  createHash("sha256").update(path.resolve(filePath)).digest("hex").slice(0, 16);

/**
 * Olvida la extracción de un archivo: la memoria y su copia diagnóstica en disco. Se invoca al
 * terminar de procesar una carga (aceptada o descartada): el texto aceptado ya vive en la base.
 */
export async function discardExtraction(filePath: string): Promise<void> {
  contentCache.delete(filePath);
  try {
    const hash = pathHash(filePath);
    for (const name of await fs.readdir(cacheDir)) {
      if (name.includes(`-${hash}-`)) await fs.rm(path.join(cacheDir, name), { force: true });
    }
  } catch { /* sin caché en disco: nada que borrar */ }
}

/** Barre las copias diagnósticas más viejas que `maxAgeMs`; devuelve cuántas eliminó. */
export async function sweepDocumentCache(maxAgeMs = 24 * 60 * 60_000): Promise<number> {
  let removed = 0;
  let names: string[];
  try { names = await fs.readdir(cacheDir); } catch { return 0; }
  for (const name of names) {
    const file = path.join(cacheDir, name);
    try {
      const st = await fs.stat(file);
      if (st.isFile() && Date.now() - st.mtimeMs > maxAgeMs) { await fs.rm(file, { force: true }); removed++; }
    } catch { /* otro proceso la borró */ }
  }
  const now = Date.now();
  for (const [key, entry] of contentCache) if (now - entry.at > MEMORY_TTL_MS) contentCache.delete(key);
  return removed;
}

type SupportedExtension = ".md" | ".txt" | ".docx" | ".doc" | ".pdf" | ".xlsx" | ".xls";

/**
 * Motivos por los que un documento no aporta texto utilizable. Distinguirlos
 * es lo que permite triar los documentos afectados en vez de mirar una lista
 * plana de rutas (hallazgo A-3):
 *
 *   unsupported       — extensión que extractMarkdown no sabe leer.
 *   empty             — el archivo se leyó pero no tenía nada aprovechable
 *                        (PDF o DOCX sin texto nativo —candidato a OCR—,
 *                        hoja de cálculo sin filas, etc.). 
 *   converter_failed  — el conversor externo (soffice para .doc) falló.
 *   read_error        — cualquier excepción no prevista al leer o parsear.
 */
export type ExtractionFailureReason =
  | "unsupported" | "empty" | "converter_failed" | "read_error";

export type Extraction =
  | { ok: true; text: string }
  | { ok: false; reason: ExtractionFailureReason; detail: string };

/**
 * Nombre del archivo de caché diagnóstica para un documento.
 *
 * Antes era la ruta absoluta entera en base64: legible a ojo, pero sin cota
 * de longitud. Verificado sobre el corpus real: 386 documentos tienen una
 * ruta lo bastante larga como para que ese nombre supere los 255 bytes que
 * el sistema de archivos admite en un solo componente, y escribir la caché
 * fallaba (`ENAMETOOLONG`) para todos ellos — silenciosamente, antes de que
 * el try/catch de más abajo existiera.
 *
 * Ahora es un hash de longitud fija más el nombre base recortado: se pierde
 * la ruta completa a simple vista, pero se conserva algo reconocible sin
 * volver a depender de cuán larga sea la ruta de entrada.
 */
function cacheKeyFor(filePath: string, stat: { mtimeMs: number; size: number }): string {
  const absolute = path.resolve(filePath);
  const hash = createHash('sha256').update(absolute).digest('hex').slice(0, 16);
  const base = path.basename(filePath, path.extname(filePath))
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 60);
  return `${base}-${hash}-${stat.mtimeMs}-${stat.size}-${DOCUMENT_PREPROCESSOR_VERSION}.md`;
}

function ok(text: string): Extraction {
  return { ok: true, text };
}
function fail(reason: ExtractionFailureReason, detail: string): Extraction {
  return { ok: false, reason, detail };
}

export async function preprocessDocument(filePath: string): Promise<Extraction> {
  const stat = await fs.stat(filePath);
  const stamp = `${stat.mtimeMs}:${stat.size}:${DOCUMENT_PREPROCESSOR_VERSION}`;
  const cached = contentCache.get(filePath);
  if (cached?.stamp === stamp && Date.now() - cached.at <= MEMORY_TTL_MS) return cached.extraction;

  const extension = path.extname(filePath).toLowerCase() as SupportedExtension;
  let extraction: Extraction;
  try {
    extraction = await extractMarkdown(filePath, extension);
  } catch (error) {
    extraction = fail("read_error", error instanceof Error ? error.message : String(error));
  }
  if (extraction.ok) extraction = ok(normalizeMarkdown(extraction.text));

  // El resultado se cachea siempre, incluido el fallo: es lo que evita
  // reintentar OCR —el paso caro— en cada reconstrucción del índice sobre un
  // documento que ya se sabe que no produce nada (hallazgo A-3).
  //
  // Esta caché en disco es solo diagnóstica (un documento por archivo, para
  // poder inspeccionar a mano lo que se extrajo): nunca debe ser fatal, igual
  // que la de search.ts. Se mantiene el try/catch como red de seguridad,
  // pero el bug de fondo ya se corrigió en `cacheKeyFor`: 386 documentos
  // reales del corpus tienen una ruta absoluta larga —codificarla entera en
  // base64 superaba los 255 bytes que el sistema de archivos admite—, y sin
  // esto tumbaba el proceso completo por un problema que no tenía nada que
  // ver con el contenido del documento (verificado: es la causa real por la
  // que decreto_0462_..._indigenas.pdf aparecía como "sin texto" pese a
  // tener 90.837 caracteres nativos legibles).
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, cacheKeyFor(filePath, stat));
    const toWrite = extraction.ok ? extraction.text : `<!-- fallo: ${extraction.reason} — ${extraction.detail} -->`;
    await fs.writeFile(`${cachePath}.tmp`, toWrite, "utf8");
    await fs.rename(`${cachePath}.tmp`, cachePath);
  } catch (error) {
    console.warn(`[documents] No se pudo escribir la caché diagnóstica de ${path.basename(filePath)}: ${error instanceof Error ? error.message : error}`);
  }
  rememberExtraction(filePath, stamp, extraction);
  return extraction;
}

async function extractMarkdown(filePath: string, extension: SupportedExtension): Promise<Extraction> {
  if (extension === ".md" || extension === ".txt") {
    const text = await fs.readFile(filePath, "utf8");
    return text.trim() ? ok(text) : fail("empty", "archivo vacío");
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim() ? ok(result.value) : fail("empty", "docx sin texto extraíble");
  }

  if (extension === ".xlsx" || extension === ".xls") {
    const markdown = spreadsheetToMarkdown(await fs.readFile(filePath));
    return markdown.trim() ? ok(markdown) : fail("empty", "hoja de cálculo sin filas");
  }

  if (extension === ".pdf") return extractPdf(filePath);

  if (extension === ".doc") return extractLegacyDoc(filePath);

  return fail("unsupported", `extensión ${extension || "(sin extensión)"} no reconocida`);
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

/**
 * `pdf-parse` uno el texto de cada página con un separador "-- N of M --".
 * No es contenido: en un PDF escaneado de muchas páginas sin capa de texto,
 * esos separadores solos pueden sumar más caracteres que el umbral de OCR
 * y hacer creer que ya hay suficiente texto — así se salta el OCR por
 * completo. Verificado sobre el corpus real: exactamente lo que le pasaba a
 * `acta-056-de-2024.pdf` (22 páginas, 211 caracteres de puros separadores,
 * cero texto real) y a un número no trivial de documentos más (ver el
 * informe de `npm run scan:ocr-gaps`).
 */
const PAGE_SEPARATOR = /--\s*\d+\s*of\s*\d+\s*--/g;

function stripPageSeparators(text: string): string {
  return text.replace(PAGE_SEPARATOR, "");
}

/**
 * ¿El texto extraído se parece a un idioma real, o es ruido de OCR?
 *
 * Calibrado contra el corpus real, no a ojo:
 *   - texto bueno (manual de contratación, prosa)         avgLen 5.46
 *   - tabla presupuestal, muy numérica (Acuerdo 044/2004)  avgLen 4.77
 *   - OCR de un manuscrito de 1899, ilegible               avgLen 2.12
 *
 * La longitud media de palabra separa limpiamente el caso malo de los dos
 * buenos —incluida la tabla numérica, que una medida basada solo en "cuántas
 * palabras parecen alfabéticas" habría marcado como basura por error—.
 * `shortRatio` es una segunda señal, exigida junto a `avgLen` para no
 * disparar con un documento corto y legítimo (pocas palabras, una de ellas
 * larga, sesga el promedio).
 */
export function looksLikeGarbage(text: string): boolean {
  const words = stripPageSeparators(text).split(/\s+/).filter(w => w.length > 0);
  if (words.length < 20) return false; // muestra insuficiente: no arriesgar un falso positivo
  const avgLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const short = words.filter(w => w.length <= 2);
  const shortRatio = short.length / words.length;
  if (!(avgLength < 3.0 && shortRatio > 0.55)) return false;

  // Tercera señal, añadida tras un falso positivo real sobre el corpus: una
  // TABLA DE DATOS se ve igual que el ruido si solo se miran longitudes. Los
  // boletines de calidad del aire son columnas de mediciones por día
  // ("ND 1 2 3 ... 22 17 15 17 12"): avgLen 2,85 y shortRatio 0,78, dentro de
  // la zona de basura, pero son contenido perfectamente legítimo.
  //
  // Lo que los distingue es DE QUÉ están hechos esos tokens cortos. Medido
  // sobre el corpus real:
  //
  //   boletines de calidad del aire (tablas buenas)   0,82 - 0,89 numéricos
  //   acuerdos de 2004 con capa de texto rota         0,09 - 0,18 numéricos
  //
  // Los acuerdos rotos extraen "A AC CU UE ER RD DO O": cada carácter
  // duplicado, un defecto de codificación del PDF. Eso sí es basura. Entre
  // 0,18 y 0,82 hay sitio de sobra para un umbral.
  const numericShortRatio = short.filter(w => /^\d+$/.test(w)).length / short.length;
  return numericShortRatio < 0.5;
}

/**
 * PDF: solo la capa de texto nativa. El OCR vive en `kb/ocr.ts` (Tesseract con
 * confianza medida, RF-C3-IV-07); aquí ya no se rasteriza ni se rellena con
 * texto que no pasó el control de calidad. Un PDF sin texto nativo es "empty":
 * quien lo llame decide si corresponde OCR (`kb/conversion.ts`).
 */
async function extractPdf(filePath: string): Promise<Extraction> {
  const nativeText = await extractPdfText(await fs.readFile(filePath));
  return stripPageSeparators(nativeText).replace(/\s/g, "").length
    ? ok(nativeText)
    : fail("empty", "PDF sin capa de texto nativa");
}

/**
 * Convierte un .doc heredado con LibreOffice.
 *
 * `-env:UserInstallation` NO es opcional, y costó 108 documentos descubrirlo.
 * LibreOffice usa un ÚNICO perfil de usuario por defecto y lo bloquea mientras
 * corre: con `DOCUMENT_EXTRACTION_CONCURRENCY=2` hay dos `soffice` a la vez y
 * el segundo muere. Medido sobre el corpus: de los 206 .doc, 98 se
 * convirtieron y 108 fallaron —y esos 108 convierten perfectamente uno a uno,
 * así que no eran archivos malos sino una colisión entre procesos—. Dándole a
 * cada invocación su propio perfil desaparece la contención.
 */
async function extractLegacyDoc(filePath: string): Promise<Extraction> {
  const command = process.env.DOC_CONVERTER_COMMAND || "soffice";
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-doc-"));
  try {
    await execFileAsync(command, [
      `-env:UserInstallation=file://${path.join(tempDir, "profile")}`,
      "--headless", "--convert-to", "txt:Text", "--outdir", tempDir, filePath,
    ], {
      maxBuffer: 1024 * 1024,
      // Un .doc corrupto puede dejar a soffice esperando indefinidamente; sin
      // tope, bloquearía una de las dos ranuras de extracción para siempre.
      timeout: 120_000,
    });
    const outputPath = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.txt`);
    const text = await fs.readFile(outputPath, "utf8");
    return text.trim() ? ok(text) : fail("empty", "conversión de DOC sin texto resultante");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[documents] No se pudo convertir DOC ${path.basename(filePath)}: ${detail}`);
    return fail("converter_failed", detail);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function spreadsheetToMarkdown(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, sheetStubs: true });
  return workbook.SheetNames.map(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return "";
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    if (!rows.length) return "";
    const width = Math.max(...rows.map(row => row.length), 1);
    const normalized = rows.map(row => Array.from({ length: width }, (_, index) => markdownCell(row[index])));
    const header = normalized[0];
    const separator = header.map(() => "---");
    const body = normalized.slice(1);
    return [`## Hoja: ${escapeMarkdownHeading(sheetName)}`, "", `| ${header.join(" | ")} |`, `| ${separator.join(" | ")} |`, ...body.map(row => `| ${row.join(" | ")} |`)].join("\n");
  }).filter(Boolean).join("\n\n");
}

function markdownCell(value: unknown): string {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function escapeMarkdownHeading(value: string): string {
  return value.replace(/[\\#]/g, "\\$&").trim();
}

function normalizeMarkdown(content: string): string {
  return content
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
