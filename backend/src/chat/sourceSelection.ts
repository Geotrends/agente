/**
 * Selección de las fuentes realmente usadas (RF-C3-DI-08, RF-C3-DI-18).
 *
 * El modelo declara los alias que usó (`<!--FUENTES: D1|D3-->`) y puede marcar cada
 * unidad con `[D1]`. Una fuente aparece solo si fue declarada, está entre las
 * recuperadas y, cuando el cuerpo trae referencias, el cuerpo la cita. Nunca se
 * muestran "todas" por defecto ni se infiere una fuente de un marcador inválido.
 */
import type { SourceEntry } from "./sources.js";

const TIPO_MARKER = /<!--\s*TIPO\s*:\s*(\w+)\s*-->/i;
const DECLARATION = /<!--\s*FUENTES\s*:\s*([^>]*?)\s*-->/i;
const INLINE_REF = /\[(D\d{1,3})\]/g;
const ALIAS = /^D\d{1,3}$/;

export type Declaration = { body: string; declared: string[] | null };

/** Separa el marcador final del texto. `declared` es null si falta o está mal formado. */
export function parseDeclaration(raw: string): Declaration {
  const sinTipo = raw.replace(TIPO_MARKER, "").trimEnd();
  const m = DECLARATION.exec(sinTipo);
  if (!m) return { body: sinTipo, declared: null };
  const body = sinTipo.replace(DECLARATION, "").trimEnd();
  const items = m[1].split("|").map(s => s.trim()).filter(Boolean);
  if (items.some(i => !ALIAS.test(i))) return { body, declared: null };
  return { body, declared: items };
}

export function referencedAliases(body: string): string[] {
  return [...new Set([...body.matchAll(INLINE_REF)].map(m => m[1]))];
}

export type Selection =
  | { ok: true; used: SourceEntry[] }
  | { ok: false; reason: "sin_fuente_valida" };

/**
 * Intersección declaradas ∩ recuperadas ∩ (referencias del cuerpo, si las hay).
 * Con `requireSource` (respuesta factual) una lista vacía es un fallo seguro.
 */
export function selectUsedSources(
  declaration: Declaration, catalog: SourceEntry[], opts: { requireSource: boolean },
): Selection {
  const known = new Map(catalog.map(e => [e.alias, e]));
  const refs = referencedAliases(declaration.body).filter(a => known.has(a));
  let aliases: string[];
  if (declaration.declared === null) {
    // Marcador ausente o inválido: solo cuentan las referencias verificables del cuerpo.
    aliases = refs;
  } else {
    const declared = declaration.declared.filter(a => known.has(a));
    aliases = refs.length ? declared.filter(a => refs.includes(a)) : declared;
  }
  const used = aliases.map(a => known.get(a)!);
  if (opts.requireSource && used.length === 0) return { ok: false, reason: "sin_fuente_valida" };
  return { ok: true, used };
}

export type TipoModelo = "respondida" | "fuera_de_alcance" | "aclaracion";

/** Tipo declarado por el modelo; ausente o desconocido = respondida (exigirá fuente válida). */
export function parseTipo(raw: string): TipoModelo {
  const v = TIPO_MARKER.exec(raw)?.[1]?.toLowerCase();
  return v === "fuera_de_alcance" || v === "aclaracion" ? v : "respondida";
}
