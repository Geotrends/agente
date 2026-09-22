import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseCsvRecords as csvRecords } from "../shared/csv.js";

export type SourceMetadata = {
  title?: string;
  sourceUrl?: string;
  sourcePageUrl?: string;
  category?: string;
  mimeType?: string;
  sha256?: string;
};

export type SourceMetadataCatalog = {
  byPath: Map<string, SourceMetadata>;
  signature: string;
};

const METADATA_FILES = ["paginas.csv", "documentos.csv"] as const;

/**
 * Carga la metadata producida por ambientometro_scraper como un catalogo lateral.
 * Los CSV enriquecen resultados; nunca se incorporan como contenido indexable.
 */
/**
 * Catálogo memoizado por marca de tiempo de los CSV.
 *
 * `buildIndex` llama a esta función en cada revalidación, y parsear los 3,1 MB
 * de `documentos.csv` costaba 104 ms — el 68 % del coste total de comprobar si
 * el corpus cambió. Los CSV solo cambian cuando corre el scraper, así que se
 * reutiliza el catálogo mientras el par (mtime, tamaño) de ambos archivos siga
 * igual: es la misma heurística que ya se usa para los documentos.
 *
 * El `byPath` devuelto se comparte entre llamadas; sus consumidores
 * (`buildIndex`, `hybridSearch`) solo lo leen.
 */
let memoized: { stamp: string; catalog: SourceMetadataCatalog } | undefined;

async function metadataStamp(root: string): Promise<string> {
  const stamps = await Promise.all(METADATA_FILES.map(async fileName => {
    try {
      const stat = await fs.stat(path.join(root, "metadata", fileName));
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "ausente";
    }
  }));
  return [root, ...stamps].join("\0");
}

export async function loadSourceMetadata(root: string): Promise<SourceMetadataCatalog> {
  const stamp = await metadataStamp(root);
  if (memoized?.stamp === stamp) return memoized.catalog;

  const contents = await Promise.all(METADATA_FILES.map(async fileName => {
    const filePath = path.join(root, "metadata", fileName);
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }));

  const byPath = new Map<string, SourceMetadata>();
  for (const record of csvRecords(contents[0])) {
    const localPath = normalizeLocalPath(record.local_md_path);
    if (!localPath) continue;
    byPath.set(localPath, compactMetadata({
      title: record.title,
      sourceUrl: validHttpUrl(record.url),
      category: record.category
    }));
  }

  for (const record of csvRecords(contents[1])) {
    const localPath = normalizeLocalPath(record.local_path);
    if (!localPath) continue;
    const incoming = compactMetadata({
      title: meaningfulLinkText(record.link_text) || humanizeFilename(record.filename),
      sourceUrl: validHttpUrl(record.source_url),
      sourcePageUrl: validHttpUrl(record.source_page_url),
      category: record.category,
      mimeType: record.mime_type,
      sha256: /^[a-f\d]{64}$/i.test(record.sha256 || "") ? record.sha256.toLowerCase() : undefined
    });
    byPath.set(localPath, mergeMetadata(byPath.get(localPath), incoming));
  }

  const signature = createHash("sha256")
    .update(contents[0])
    .update("\0")
    .update(contents[1])
    .digest("hex");
  const catalog = { byPath, signature };
  memoized = { stamp, catalog };
  return catalog;
}

function compactMetadata(metadata: SourceMetadata): SourceMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => typeof value === "string" && value.trim())
  ) as SourceMetadata;
}

function mergeMetadata(current: SourceMetadata | undefined, incoming: SourceMetadata): SourceMetadata {
  if (!current) return incoming;
  return compactMetadata({
    title: current.title || incoming.title,
    sourceUrl: current.sourceUrl || incoming.sourceUrl,
    sourcePageUrl: current.sourcePageUrl || incoming.sourcePageUrl,
    category: current.category || incoming.category,
    mimeType: current.mimeType || incoming.mimeType,
    sha256: current.sha256 || incoming.sha256
  });
}

// El scraper captura el texto visible del enlace como título. Para botones
// genéricos ("Ver", "Descargar", "Clic aquí") eso es peor que el nombre del
// archivo, así que se descarta y se usa el nombre humanizado en su lugar.
const GENERIC_LINK_TEXT = /^(ver|ver\s+m[aá]s|descargar?|descarga|abrir|pdf|documento|archivo|clic(?:k)?\s*(?:aqu[ií])?|aqu[ií]|leer\s+m[aá]s|enlace|link)$/i;

function meaningfulLinkText(value: string | undefined): string | undefined {
  const trimmed = (value || "").trim();
  if (!trimmed || GENERIC_LINK_TEXT.test(trimmed)) return undefined;
  return trimmed;
}

const LOWERCASE_CONNECTORS = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "para", "con", "a", "al"]);

function humanizeFilename(value: string | undefined): string | undefined {
  const trimmed = (value || "").trim();
  if (!trimmed) return undefined;
  const withoutExt = trimmed.replace(/\.[a-z0-9]{1,6}$/i, "");
  const words = withoutExt.replace(/[_-]+/g, " ").trim().split(/\s+/);
  if (!words.length) return undefined;
  return words
    .map((word, index) => {
      if (/^\d/.test(word)) return word;
      const lower = word.toLowerCase();
      if (index > 0 && LOWERCASE_CONNECTORS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function normalizeLocalPath(value: string | undefined): string | null {
  const normalized = path.posix.normalize((value || "").trim().replace(/\\/g, "/").replace(/^\.\//, ""));
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function validHttpUrl(value: string | undefined): string | undefined {
  const candidate = (value || "").trim();
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
