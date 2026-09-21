import fs from "node:fs/promises";
import path from "node:path";
import { preprocessDocument, type Extraction } from "./documentPreprocessor.js";

export async function listCourseDocuments(
  _courseId: string,
  folderPrefix?: string
): Promise<DocumentItem[]> {
  const root = getDocumentsRootPath();
  try {
    const flat = await collectDocumentsRecursive(root, "");
    const filtered = filterByFolder(flat, folderPrefix);
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function normalizeFolderPrefix(folderPrefix: string | undefined): string {
  if (!folderPrefix) return "";
  return folderPrefix.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function filterByFolder<T extends { id: string }>(items: T[], folderPrefix?: string): T[] {
  const prefix = normalizeFolderPrefix(folderPrefix);
  if (!prefix) return items;
  const matcher = `${prefix}/`;
  return items.filter((item) => item.id === prefix || item.id.startsWith(matcher));
}

export type DocumentItem = {
  id: string;
  name: string;
  extension: SupportedExtension;
};

type SupportedExtension = ".md" | ".txt" | ".docx" | ".doc" | ".pdf" | ".xlsx" | ".xls";

const SUPPORTED_EXTENSIONS: SupportedExtension[] = [".md", ".txt", ".docx", ".doc", ".pdf", ".xlsx", ".xls"];

const IGNORED_FILE_NAMES = new Set(["desktop.ini", "thumbs.db", ".ds_store"]);

/**
 * Carpeta local que se indexa entera (recursivo): md, txt, docx, pdf, xlsx.
 * GEOTRENDS_DOCUMENTS_ROOT: ruta relativa al cwd del backend (ej. data/cursos/geo-basico/geotrends)
 * o ruta absoluta en Windows/Linux.
 */
export function getDocumentsRootPath(): string {
  const raw = process.env.GEOTRENDS_DOCUMENTS_ROOT?.trim();
  if (raw) {
    const cleaned = raw.replace(/^["']|["']$/g, "");
    if (path.isAbsolute(cleaned)) {
      return path.normalize(cleaned);
    }
    return path.normalize(path.join(process.cwd(), cleaned));
  }
  return path.join(process.cwd(), "data", "geotrends");
}

async function collectDocumentsRecursive(
  dir: string,
  relativePosix: string
): Promise<DocumentItem[]> {
  const out: DocumentItem[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(dir, entry.name);
    const rel =
      relativePosix === "" ? entry.name : `${relativePosix}/${entry.name}`;
    const relPosix = rel.replace(/\\/g, "/");

    if (entry.isDirectory()) {
      out.push(...(await collectDocumentsRecursive(fullPath, relPosix)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (IGNORED_FILE_NAMES.has(entry.name.toLowerCase())) continue;

    const item = fileToDocumentItem(relPosix);
    if (item) out.push(item);
  }

  return out;
}

function fileToDocumentItem(relativePathPosix: string): DocumentItem | null {
  const extension = path.extname(relativePathPosix).toLowerCase() as SupportedExtension;
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    return null;
  }

  return {
    id: relativePathPosix,
    name: relativePathPosix,
    extension
  };
}

/** Evita salir de `root` (path traversal). `relativePosix` usa barras `/`. */
export function safeResolveUnderRoot(root: string, relativePosix: string): string | null {
  const trimmed = relativePosix.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.includes("\0")) return null;

  const segments = trimmed.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg === ".." || seg === ".") return null;
  }

  const candidate = path.resolve(root, ...segments);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

  return candidate;
}

export async function readDocumentContent(filePath: string): Promise<Extraction> {
  try {
    return await preprocessDocument(filePath);
  } catch (error) {
    return { ok: false, reason: "read_error", detail: error instanceof Error ? error.message : String(error) };
  }
}
