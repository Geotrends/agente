/**
 * Catálogo de fuentes de una consulta (RF-C3-DI-07/08, RF-C3-IN-03).
 *
 * Los fragmentos recuperados se agrupan por documento y cada uno recibe un alias
 * opaco (`D1`, `D2`…) que el modelo usa para referirse a él. El alias no revela rutas
 * ni identificadores internos. Cada fuente exige URL https oficial y una fecha real
 * (actualización del documento o acceso a la página); si falta, es un error de datos y
 * nunca se inventa la fecha actual.
 */
import path from "node:path";
import type { FuenteCitada } from "./contracts.js";

export type RetrievedHit = {
  path: string;
  snippet: string;
  title?: string;
  page?: number;
  sourceUrl?: string;
  sourcePageUrl?: string;
  /** Identificador del elemento en la matriz documental. */
  documentId?: string;
  /** Versión del contenido que originó el fragmento (para revalidar antes de entregar). */
  versionId?: string;
  codigo?: string;
  fechaActualizacion?: string;
  fechaAcceso?: string;
  category?: string;
};

export type SourceEntry = {
  alias: string;
  fuente: FuenteCitada;
  /** `actualizado` si la fecha es de actualización del documento; `consultado` si es de acceso a una página. */
  fechaTipo: "actualizado" | "consultado";
  hits: RetrievedHit[];
};

export class SourceDataError extends Error {
  constructor(message: string) { super(message); this.name = "SourceDataError"; }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function dateOf(hit: RetrievedHit): { fecha: string; tipo: SourceEntry["fechaTipo"] } | null {
  for (const [raw, tipo] of [[hit.fechaActualizacion, "actualizado"], [hit.fechaAcceso, "consultado"]] as const) {
    if (raw && ISO_DATE.test(raw)) return { fecha: raw.slice(0, 10), tipo };
  }
  return null;
}

function httpsUrl(...candidates: Array<string | undefined>): string | null {
  for (const c of candidates) {
    if (!c) continue;
    try { if (new URL(c).protocol === "https:") return c; } catch { /* siguiente candidato */ }
  }
  return null;
}

export type CatalogResult = { entries: SourceEntry[]; invalid: Array<{ path: string; motivo: string }> };

export function buildSourceCatalog(hits: RetrievedHit[]): CatalogResult {
  const byDoc = new Map<string, SourceEntry>();
  const invalid: CatalogResult["invalid"] = [];
  const rejected = new Set<string>();
  for (const hit of hits) {
    const key = hit.documentId ?? hit.path;
    if (rejected.has(key)) continue;
    const existing = byDoc.get(key);
    if (existing) { existing.hits.push(hit); continue; }
    const enlace = httpsUrl(hit.sourceUrl, hit.sourcePageUrl);
    const fecha = dateOf(hit);
    if (!enlace || !fecha) {
      rejected.add(key);
      invalid.push({ path: hit.path, motivo: !enlace ? "sin URL https oficial" : "sin fecha de actualización ni de acceso" });
      continue;
    }
    byDoc.set(key, {
      alias: `D${byDoc.size + 1}`,
      fuente: { id: hit.documentId ?? hit.path, nombre: hit.title?.trim() || path.basename(hit.path), enlace, fecha: fecha.fecha },
      fechaTipo: fecha.tipo,
      hits: [hit],
    });
  }
  return { entries: [...byDoc.values()], invalid };
}

/** Falla si había fragmentos pero ninguno se puede citar: es un problema de datos, no una ausencia. */
export function requireCitableSources(hits: RetrievedHit[]): SourceEntry[] {
  const { entries, invalid } = buildSourceCatalog(hits);
  if (hits.length > 0 && entries.length === 0) {
    throw new SourceDataError(`Ningún fragmento recuperado es citable (${invalid.map(i => i.motivo).join("; ")})`);
  }
  return entries;
}

/**
 * Neutraliza lo que un fragmento podría usar para imitar la estructura del prompt (SPEC008, FR-020):
 * encabezados `--- … ---` de fragmento, separadores `===` y los marcadores `<!--FUENTES/TIPO-->`.
 * Se inserta un carácter de ancho cero, invisible para el modelo y que impide el calce exacto; el
 * texto sigue siendo legible y los datos no cambian.
 */
export function neutralizePromptDelimiters(text: string): string {
  return text
    .replace(/<!--/g, "<!\u200b--")
    .replace(/-->/g, "-\u200b->")
    .replace(/^([ \t]*)(-{3,}|={3,}|#{3,}\s*Canales oficiales)/gm, "$1\u200b$2");
}

/** Encabezado del fragmento para el modelo: alias opaco, nombre y página; sin rutas internas. */
export function contextHeader(entry: SourceEntry, hit: RetrievedHit): string {
  const parts = [`ID: ${entry.alias}`, `Fuente: ${neutralizePromptDelimiters(entry.fuente.nombre)}`];
  if (hit.codigo) parts.push(`Código: ${neutralizePromptDelimiters(String(hit.codigo))}`);
  if (hit.page) parts.push(`Página: ${hit.page}`);
  parts.push(`${entry.fechaTipo === "actualizado" ? "Actualizado" : "Consultado"}: ${entry.fuente.fecha}`);
  if (hit.category) parts.push(`Dirección: ${neutralizePromptDelimiters(String(hit.category))}`);
  return `--- ${parts.join(" | ")} ---`;
}

export function formatContext(entries: SourceEntry[]): string {
  const blocks: string[] = [];
  for (const entry of entries) {
    for (const hit of entry.hits) blocks.push(`${contextHeader(entry, hit)}\n${neutralizePromptDelimiters(hit.snippet)}`);
  }
  return blocks.join("\n\n");
}
