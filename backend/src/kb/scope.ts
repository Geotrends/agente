/**
 * Reglas de alcance y de dirección responsable de la base de conocimiento
 * (RF-C3-IV-01, IV-11; research R9/R10/R11).
 *
 * La base solo contiene:
 *   - los 6 GT-P de la configuración (semillas de GMAS2);
 *   - los documentos que esos GT-P CITAN, si son formatos (-F-), normas (-N-)
 *     o procedimientos MG (MG-P); otro GT-P citado no entra;
 *   - las páginas y documentos de las fuentes del Observatorio autorizadas;
 * y todo ello con host https en la lista permitida.
 *
 * Funciones puras sobre el informe de corrida: no tocan la base de datos.
 */
import { cargarConfig, direccionPorUrl, hostPermitido, type ConfigBase, type Direccion } from "./config.js";
import type { Enlace } from "./runReport.js";

export type TipoElemento = "procedimiento" | "formato" | "norma" | "pagina" | "documento";

export type Contexto = {
  /** Enlaces del informe por URL. */
  porUrl: Map<string, Enlace>;
  /** GT-P del informe por código (visitados, con o sin error). */
  procedimientos: Map<string, Enlace>;
  /** id de GMAS2 de un vinculado → códigos de los GT-P (de la configuración) que lo citan. */
  citadoPor: Map<string, Set<string>>;
  config: ConfigBase;
};

const LETRA_TIPO = /^[A-Z]{2,3}-([A-Z]{1,2})-\d+$/;

/** id `documento=` de una URL del visor de GMAS2. */
export function idGmas(url: string): string | null {
  try { return new URL(url).searchParams.get("documento"); } catch { return null; }
}

/** URL normalizada para usar como clave: host en minúsculas, sin fragmento ni barra final. */
export function normalizarUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    return u.toString().replace(/\/(?=$|\?)/, "");
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

export function construirContexto(enlaces: Enlace[], config = cargarConfig()): Contexto {
  const porUrl = new Map<string, Enlace>();
  const procedimientos = new Map<string, Enlace>();
  const citadoPor = new Map<string, Set<string>>();
  for (const e of enlaces) {
    porUrl.set(e.url, e);
    if (e.rol !== "procedimiento" || !e.gmas) continue;
    procedimientos.set(e.gmas.codigo, e);
    if (!(e.gmas.codigo in config.procedimientos)) continue;
    for (const v of e.gmas.vinculados) {
      const conjunto = citadoPor.get(v.id) ?? new Set<string>();
      conjunto.add(e.gmas.codigo);
      citadoPor.set(v.id, conjunto);
    }
  }
  return { porUrl, procedimientos, citadoPor, config };
}

/** Clave estable del elemento: código de GMAS2 o URL normalizada. */
export function claveDe(e: Enlace): string {
  return e.gmas?.codigo || normalizarUrl(e.url);
}

/** Tipo de elemento a partir del rol y, en GMAS2, de la letra de tipo del código. */
export function tipoPara(e: Pick<Enlace, "rol" | "gmas">): TipoElemento {
  if (e.rol === "pagina") return "pagina";
  if (e.rol === "documento") return "documento";
  if (e.rol === "procedimiento") return "procedimiento";
  const letra = LETRA_TIPO.exec(e.gmas?.codigo ?? "")?.[1];
  if (letra === "P") return "procedimiento";
  if (letra === "F") return "formato";
  if (letra === "N") return "norma";
  return "documento";
}

/** ¿El código es de un tipo que puede entrar como vinculado? (-F-, -N- o MG-P). */
export function codigoVinculable(codigo: string): boolean {
  const letra = LETRA_TIPO.exec(codigo)?.[1];
  return letra === "F" || letra === "N" || (letra === "P" && codigo.startsWith("MG-"));
}

/** GT-P (de la configuración) que citan este vinculado en el informe, ordenados por código. */
export function citantes(e: Enlace, ctx: Contexto): string[] {
  const id = e.gmas?.id ?? idGmas(e.url);
  return [...(id ? ctx.citadoPor.get(id) ?? [] : [])].sort();
}

export type Alcance = { ok: true } | { ok: false; motivo: string };

export function esDelAlcance(e: Enlace, ctx: Contexto): Alcance {
  if (!hostPermitido(e.url, ctx.config)) return { ok: false, motivo: "host fuera de la lista permitida" };
  if (e.fuente === "gmas2_envigado") {
    const codigo = e.gmas?.codigo;
    if (e.rol === "descarga") return { ok: false, motivo: "una descarga es contenido de su vinculado, no un elemento" };
    if (!codigo) return { ok: false, motivo: "documento de GMAS2 sin código" };
    if (e.rol === "procedimiento") {
      return codigo in ctx.config.procedimientos ? { ok: true } : { ok: false, motivo: `${codigo} no es uno de los procedimientos del alcance` };
    }
    if (!codigoVinculable(codigo)) return { ok: false, motivo: `${codigo} no es formato, norma ni MG-P` };
    return citantes(e, ctx).length ? { ok: true } : { ok: false, motivo: `${codigo} no lo cita ningún procedimiento del alcance` };
  }
  if (e.fuente in ctx.config.fuentesObservatorio && (e.rol === "pagina" || e.rol === "documento")) return { ok: true };
  return { ok: false, motivo: `fuente o rol fuera del alcance (${e.fuente}/${e.rol})` };
}

/** Procedimiento de origen (columna 12 de la matriz). Nunca vacío (FR-003). */
export function procedimientosOrigenPara(e: Enlace, ctx: Contexto, existentes: string[] = []): string[] {
  if (e.fuente in ctx.config.fuentesObservatorio) return [ctx.config.fuentesObservatorio[e.fuente]];
  if (e.rol === "procedimiento" && e.gmas) return [e.gmas.codigo];
  // Se conservan los orígenes previos cuyo GT-P no se pudo verificar en esta
  // corrida (no aparece o dio error): no hay evidencia de que dejara de citarlo.
  const verificados = new Set([...ctx.procedimientos].filter(([, p]) => p.resultado !== "error").map(([c]) => c));
  const heredados = existentes.filter(c => !verificados.has(c));
  return [...new Set([...citantes(e, ctx), ...heredados])].sort();
}

/** Dirección responsable (research R11). */
export function direccionPara(e: Enlace, ctx: Contexto, origenes = procedimientosOrigenPara(e, ctx)): Direccion {
  if (e.fuente === "gmas2_envigado") {
    const primero = origenes.find(c => c in ctx.config.procedimientos);
    if (e.rol === "procedimiento" && e.gmas) return ctx.config.procedimientos[e.gmas.codigo] ?? "secretaria_general";
    return primero ? ctx.config.procedimientos[primero] : "secretaria_general";
  }
  // Un PDF hereda la sección de la página que lo enlaza.
  if (e.rol === "documento" && e.padre) return direccionPorUrl(e.padre, ctx.config);
  return direccionPorUrl(e.url, ctx.config);
}

/** Dirección de un elemento ya existente (kb recalcular-direcciones). */
export function direccionDeElemento(
  el: { fuente: string; tipo: string; codigo: string | null; urlOrigen: string; urlPadre: string | null; procedimientosOrigen: string[] },
  config = cargarConfig(),
): Direccion {
  if (el.fuente === "gmas2_envigado") {
    if (el.codigo && el.codigo in config.procedimientos) return config.procedimientos[el.codigo];
    const primero = [...el.procedimientosOrigen].sort().find(c => c in config.procedimientos);
    return primero ? config.procedimientos[primero] : "secretaria_general";
  }
  if (el.tipo === "documento" && el.urlPadre) return direccionPorUrl(el.urlPadre, config);
  return direccionPorUrl(el.urlOrigen, config);
}
