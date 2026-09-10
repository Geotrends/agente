import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const execFileAsync = promisify(execFile);
export const DOCUMENT_PREPROCESSOR_VERSION = "markdown-ocr-v1";
const cacheDir = path.resolve(process.env.DOCUMENT_CACHE_DIR || ".cache/documents");
const contentCache = new Map<string, { stamp: string; content: string }>();

type SupportedExtension = ".md" | ".txt" | ".docx" | ".doc" | ".pdf" | ".xlsx" | ".xls";

export async function preprocessDocument(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  const stamp = `${stat.mtimeMs}:${stat.size}:${DOCUMENT_PREPROCESSOR_VERSION}:${ocrConfigStamp()}`;
  const cached = contentCache.get(filePath);
  if (cached?.stamp === stamp) return cached.content;

  const extension = path.extname(filePath).toLowerCase() as SupportedExtension;
  let content = await extractMarkdown(filePath, extension);
  content = normalizeMarkdown(content);

  await fs.mkdir(cacheDir, { recursive: true });
  const cacheKey = `${Buffer.from(path.resolve(filePath)).toString("base64url")}-${stat.mtimeMs}-${stat.size}-${DOCUMENT_PREPROCESSOR_VERSION}.md`;
  const cachePath = path.join(cacheDir, cacheKey);
  await fs.writeFile(`${cachePath}.tmp`, content, "utf8");
  await fs.rename(`${cachePath}.tmp`, cachePath);
  contentCache.set(filePath, { stamp, content });
  return content;
}

async function extractMarkdown(filePath: string, extension: SupportedExtension): Promise<string> {
  if (extension === ".md" || extension === ".txt") return fs.readFile(filePath, "utf8");

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (extension === ".xlsx" || extension === ".xls") {
    return spreadsheetToMarkdown(await fs.readFile(filePath));
  }

  if (extension === ".pdf") {
    const nativeText = await extractPdfText(await fs.readFile(filePath));
    if (shouldUseOcr(nativeText)) {
      const ocrText = await extractPdfWithOcr(filePath);
      if (ocrText.trim()) return ocrText;
    }
    return nativeText;
  }

  if (extension === ".doc") {
    return extractLegacyDoc(filePath);
  }

  return "";
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

function shouldUseOcr(text: string): boolean {
  if (process.env.OCR_ENABLED?.toLowerCase() === "false") return false;
  const minimum = Number(process.env.OCR_MIN_TEXT_CHARS || 80);
  const compact = text.replace(/\s/g, "");
  return compact.length < minimum;
}

async function extractPdfWithOcr(filePath: string): Promise<string> {
  const command = process.env.OCR_COMMAND || "ocrmypdf";
  const language = process.env.OCR_LANGUAGE || "spa+eng";
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-ocr-"));
  const outputPath = path.join(tempDir, "searchable.pdf");
  try {
    await execFileAsync(command, ["--skip-text", "--deskew", "-l", language, filePath, outputPath], {
      maxBuffer: 1024 * 1024
    });
    return await extractPdfText(await fs.readFile(outputPath));
  } catch (error) {
    console.warn(`[documents] OCR no disponible para ${path.basename(filePath)}: ${error instanceof Error ? error.message : error}`);
    return "";
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractLegacyDoc(filePath: string): Promise<string> {
  const command = process.env.DOC_CONVERTER_COMMAND || "soffice";
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-doc-"));
  try {
    await execFileAsync(command, ["--headless", "--convert-to", "txt:Text", "--outdir", tempDir, filePath], {
      maxBuffer: 1024 * 1024
    });
    const outputPath = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.txt`);
    return await fs.readFile(outputPath, "utf8");
  } catch (error) {
    console.warn(`[documents] No se pudo convertir DOC ${path.basename(filePath)}: ${error instanceof Error ? error.message : error}`);
    return "";
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

function ocrConfigStamp(): string {
  return `${process.env.OCR_ENABLED || "auto"}:${process.env.OCR_LANGUAGE || "spa+eng"}:${process.env.OCR_MIN_TEXT_CHARS || "80"}`;
}