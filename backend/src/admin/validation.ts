/**
 * Validadores compartidos del panel (T006, data-model «Tipos comunes»).
 *
 * Sin coerciones: un número donde se espera una cadena, una clave desconocida o repetida y un
 * valor fuera de la lista permitida se rechazan con el campo afectado. El texto administrativo
 * nunca se interpreta como HTML, comando o SQL (las consultas son siempre parametrizadas).
 */

export class ValidationError extends Error {
  constructor(readonly campo: string, readonly mensaje: string) {
    super(`${campo}: ${mensaje}`);
    this.name = "ValidationError";
  }
}

const fail = (campo: string, mensaje: string): never => { throw new ValidationError(campo, mensaje); };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export function parseUuid(v: unknown, campo: string): string {
  if (!isUuid(v)) fail(campo, "Identificador no válido.");
  return (v as string).toLowerCase();
}

/** Revisión: bigint positivo representado como cadena decimal sin ceros a la izquierda. */
export function parseRevision(v: unknown, campo = "expectedRevision"): string {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,18}$/.test(v)) fail(campo, "La revisión debe ser una cadena decimal positiva.");
  return v as string;
}

/** Objeto JSON plano con las claves exactas permitidas; rechaza desconocidas y valores no objeto. */
export function strictObject(body: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) fail("cuerpo", "El cuerpo debe ser un objeto JSON.");
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) fail(key, "Campo no permitido.");
  for (const key of required) if (!(key in obj) || obj[key] === undefined) fail(key, "Campo obligatorio.");
  return obj;
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Texto obligatorio: cadena, recortada, no vacía, sin caracteres de control y de a lo sumo `max` puntos de código. */
export function requiredText(v: unknown, campo: string, max = 500): string {
  if (typeof v !== "string") return fail(campo, "Debe ser texto.");
  const t = v.trim();
  if (!t) return fail(campo, "Este campo es obligatorio.");
  if (CONTROL_RE.test(t)) return fail(campo, "Contiene caracteres no permitidos.");
  if ([...t].length > max) return fail(campo, `No puede superar ${max} caracteres.`);
  return t;
}

export function optionalText(v: unknown, campo: string, max = 500): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return requiredText(v, campo, max);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Correo normalizado (recorte y minúsculas). */
export function parseEmail(v: unknown, campo = "email"): string {
  const t = requiredText(v, campo, 254).toLowerCase();
  if (!EMAIL_RE.test(t)) fail(campo, "El correo no es válido.");
  return t;
}

export function parseEnum<T extends string>(v: unknown, allowed: readonly T[], campo: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) return fail(campo, "Valor no permitido.");
  return v as T;
}

export const PERFILES = ["administrador técnico", "Gestor documental"] as const;
export type Perfil = typeof PERFILES[number];

export function parseBoolean(v: unknown, campo: string): boolean {
  if (typeof v !== "boolean") fail(campo, "Debe ser verdadero o falso.");
  return v as boolean;
}

/** URL pública: HTTPS con host válido, sin credenciales ni caracteres de control. */
export function parsePublicUrl(v: unknown, campo = "url"): string {
  const t = requiredText(v, campo, 2048);
  let u: URL;
  try { u = new URL(t); } catch { return fail(campo, "La URL no es válida."); }
  if (u.protocol !== "https:") fail(campo, "La URL debe usar HTTPS.");
  if (u.username || u.password) fail(campo, "La URL no puede incluir credenciales.");
  if (!u.hostname.includes(".") || /\s/.test(u.hostname)) fail(campo, "La URL debe tener un dominio válido.");
  return u.toString();
}

/** Fecha civil YYYY-MM-DD existente en el calendario. */
export function parseCivilDate(v: unknown, campo: string): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail(campo, "La fecha debe tener el formato AAAA-MM-DD.");
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail(campo, "La fecha no existe.");
  return v;
}

const BOGOTA_OFFSET_MS = 5 * 3_600_000; // America/Bogota es UTC−5 todo el año.
/** Fecha civil de Bogotá para un instante. */
export function bogotaDate(at: Date): string {
  return new Date(at.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}
/** Instante UTC del comienzo del día civil de Bogotá. */
export function bogotaDayStartUtc(civil: string): Date {
  return new Date(new Date(`${civil}T00:00:00Z`).getTime() + BOGOTA_OFFSET_MS);
}

/**
 * Precio por millón de tokens: cadena decimal base 10 positiva, hasta 4 decimales, sin exponente
 * y con cabida en numeric(20,10).
 */
export function parsePrice(v: unknown, campo: string): string {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,4})?$/.test(v)) {
    return fail(campo, "El precio debe ser un decimal positivo con hasta cuatro decimales.");
  }
  if (!/[1-9]/.test(v)) fail(campo, "El precio debe ser mayor que cero.");
  return v;
}

/** Entero acotado, solo número JSON entero (sin cadenas). */
export function parseInteger(v: unknown, campo: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    return fail(campo, `Debe ser un entero entre ${min} y ${max}.`);
  }
  return v;
}

/**
 * Detecta claves repetidas dentro de un mismo objeto del texto JSON (JSON.parse se queda con la
 * última en silencio). Recorre el texto con un analizador mínimo; no valida la sintaxis completa.
 */
export function hasDuplicateKeys(text: string): boolean {
  const stack: Array<Set<string> | null> = [];
  let i = 0;
  const n = text.length;
  const readString = (): string => {
    let out = "";
    i++; // comilla inicial
    while (i < n && text[i] !== '"') {
      if (text[i] === "\\") { out += text[i] + text[i + 1]; i += 2; } else { out += text[i]; i++; }
    }
    i++; // comilla final
    return out;
  };
  while (i < n) {
    const ch = text[i];
    if (ch === "{") { stack.push(new Set()); i++; }
    else if (ch === "[") { stack.push(null); i++; }
    else if (ch === "}" || ch === "]") { stack.pop(); i++; }
    else if (ch === '"') {
      const s = readString();
      let j = i;
      while (j < n && /\s/.test(text[j])) j++;
      const top = stack[stack.length - 1];
      if (text[j] === ":" && top) {
        let key: string;
        try { key = JSON.parse(`"${s}"`) as string; } catch { key = s; }
        if (top.has(key)) return true;
        top.add(key);
      }
    } else i++;
  }
  return false;
}

/**
 * Rango civil de Bogotá `[inicio, finExclusivo)` con `from`/`to` (AAAA-MM-DD, inclusivos): ambos o
 * ninguno. Sin ambos, los últimos 30 días civiles incluyendo hoy. Acepta los alias en español.
 */
export function parseRangoCivil(q: Record<string, unknown>, ahora: Date = new Date(), porDefecto = true): { desde: Date | null; hastaExcl: Date | null; from: string | null; to: string | null } {
  const from = q.from ?? q.desde;
  const to = q.to ?? q.hasta;
  const hay = (v: unknown) => v !== undefined && v !== null && v !== "";
  if (hay(from) !== hay(to)) throw new ValidationError(hay(from) ? "to" : "from", "Indique ambas fechas del rango o ninguna.");
  if (hay(from) && hay(to)) {
    const f = parseCivilDate(from, "from");
    const t = parseCivilDate(to, "to");
    if (t < f) throw new ValidationError("to", "La fecha final no puede ser anterior a la inicial.");
    return { desde: bogotaDayStartUtc(f), hastaExcl: new Date(bogotaDayStartUtc(t).getTime() + 86_400_000), from: f, to: t };
  }
  if (!porDefecto) return { desde: null, hastaExcl: null, from: null, to: null };
  const hoy = bogotaDate(ahora);
  const inicio = bogotaDayStartUtc(hoy);
  const desde = new Date(inicio.getTime() - 29 * 86_400_000);
  return { desde, hastaExcl: new Date(inicio.getTime() + 86_400_000), from: bogotaDate(desde), to: hoy };
}
