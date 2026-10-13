/**
 * Configuración versionada de la base de conocimiento (research R11).
 *
 * Vive en `backend/config/base-conocimiento.json` y solo cambia con un
 * despliegue: es la misma regla que RF-C3-AD-15 fija para la lista de hosts
 * permitidos, y se aplica igual a los mapas de dirección para que nadie pueda
 * reasignar la responsabilidad de un documento sin dejar rastro en el
 * repositorio.
 *
 * Se valida entera al cargarla. Una dirección mal escrita o un host sin tipo
 * no deben llegar a la matriz como un valor raro: el kb-worker se niega a
 * arrancar con un mensaje que dice qué corregir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DIRECCIONES = ["ecosistemas", "bienestar_animal", "gestion_ambiental", "secretaria_general"] as const;
export type Direccion = (typeof DIRECCIONES)[number];

/** Nombre legible de cada dirección, el que ve la matriz y la ficha. */
export const NOMBRE_DIRECCION: Record<Direccion, string> = {
  ecosistemas: "Ecosistemas",
  bienestar_animal: "Bienestar Animal",
  gestion_ambiental: "Gestión Ambiental",
  secretaria_general: "Secretaría (general)",
};

export type TipoHost = "dominio_con_subdominios" | "host_exacto";
export type HostPermitido = { host: string; tipo: TipoHost };
export type Seccion = { host: string; prefijo: string; direccion: Direccion };

/** Reglas para nombrar las páginas de boletines por su URL (nombres.ts). */
export type ReglaBoletines = { host: string; prefijo: string; categorias: Record<string, string> };

/** Semilla inicial del scraper (la lista vigente vive en `kb.scraper_link` y la administra el panel). */
export type EnlaceInicial = { url: string; fuente: string; direccion: Direccion };

export type ConfigBase = {
  version: number;
  enlacesIniciales: EnlaceInicial[];
  procedimientos: Record<string, Direccion>;
  fuentesObservatorio: Record<string, string>;
  secciones: Seccion[];
  hostsPermitidos: HostPermitido[];
  boletines?: ReglaBoletines;
};

/** `src/kb/` y `dist/kb/` están ambos dos niveles por debajo de `backend/`. */
const RUTA_POR_DEFECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../config/base-conocimiento.json");

function esDireccion(valor: unknown): valor is Direccion {
  return typeof valor === "string" && (DIRECCIONES as readonly string[]).includes(valor);
}

/** Valida el JSON crudo. Lanza un Error que enumera TODOS los problemas, no solo el primero. */
export function validarConfig(crudo: unknown): ConfigBase {
  const errores: string[] = [];
  const raiz = (crudo ?? {}) as Record<string, unknown>;

  const procedimientos: Record<string, Direccion> = {};
  for (const [codigo, direccion] of Object.entries((raiz.procedimientos ?? {}) as Record<string, unknown>)) {
    if (!/^[A-Z]{2,3}-P-\d{1,5}$/.test(codigo)) errores.push(`procedimientos: código inválido "${codigo}"`);
    if (!esDireccion(direccion)) errores.push(`procedimientos.${codigo}: dirección inválida "${String(direccion)}"`);
    else procedimientos[codigo] = direccion;
  }
  if (!Object.keys(procedimientos).length) errores.push("procedimientos: no puede estar vacío");

  const fuentesObservatorio: Record<string, string> = {};
  for (const [fuente, nombre] of Object.entries((raiz.fuentes_observatorio ?? {}) as Record<string, unknown>)) {
    if (typeof nombre !== "string" || !nombre.trim()) errores.push(`fuentes_observatorio.${fuente}: nombre vacío`);
    else fuentesObservatorio[fuente] = nombre.trim();
  }

  const hostsPermitidos: HostPermitido[] = [];
  for (const [i, h] of ((raiz.hosts_permitidos ?? []) as Array<Record<string, unknown>>).entries()) {
    const host = typeof h.host === "string" ? h.host.trim().toLowerCase() : "";
    if (!host || host.includes("/") || host.includes(":")) errores.push(`hosts_permitidos[${i}]: host inválido`);
    if (h.tipo !== "dominio_con_subdominios" && h.tipo !== "host_exacto") errores.push(`hosts_permitidos[${i}]: tipo inválido "${String(h.tipo)}"`);
    else if (host) hostsPermitidos.push({ host, tipo: h.tipo });
  }
  if (!hostsPermitidos.length) errores.push("hosts_permitidos: no puede estar vacío");

  const secciones: Seccion[] = [];
  for (const [i, s] of ((raiz.secciones ?? []) as Array<Record<string, unknown>>).entries()) {
    const host = typeof s.host === "string" ? s.host.trim().toLowerCase() : "";
    const prefijo = typeof s.prefijo === "string" ? s.prefijo : "";
    if (!host) errores.push(`secciones[${i}]: host vacío`);
    if (!prefijo.startsWith("/")) errores.push(`secciones[${i}]: el prefijo debe empezar por "/"`);
    if (!esDireccion(s.direccion)) errores.push(`secciones[${i}]: dirección inválida "${String(s.direccion)}"`);
    else if (host && prefijo.startsWith("/")) secciones.push({ host, prefijo, direccion: s.direccion });
  }

  const enlacesIniciales: EnlaceInicial[] = [];
  for (const [i, e] of ((raiz.enlaces_iniciales ?? []) as Array<Record<string, unknown>>).entries()) {
    const url = typeof e.url === "string" ? e.url.trim() : "";
    if (!url.startsWith("https://")) errores.push(`enlaces_iniciales[${i}]: la URL debe ser https`);
    if (typeof e.fuente !== "string" || !e.fuente) errores.push(`enlaces_iniciales[${i}]: fuente vacía`);
    if (!esDireccion(e.direccion)) errores.push(`enlaces_iniciales[${i}]: dirección inválida "${String(e.direccion)}"`);
    else if (url && typeof e.fuente === "string") enlacesIniciales.push({ url, fuente: e.fuente, direccion: e.direccion });
  }

  let boletines: ReglaBoletines | undefined;
  if (raiz.boletines !== undefined) {
    const b = raiz.boletines as Record<string, unknown>;
    const host = typeof b.host === "string" ? b.host.trim().toLowerCase() : "";
    const prefijo = typeof b.prefijo === "string" ? b.prefijo : "";
    const categorias: Record<string, string> = {};
    for (const [slug, nombre] of Object.entries((b.categorias ?? {}) as Record<string, unknown>)) {
      if (typeof nombre !== "string" || !nombre.trim()) errores.push(`boletines.categorias.${slug}: nombre vacío`);
      else categorias[slug.toLowerCase()] = nombre.trim();
    }
    if (!host) errores.push("boletines: host vacío");
    if (!prefijo.startsWith("/")) errores.push('boletines: el prefijo debe empezar por "/"');
    if (host && prefijo.startsWith("/")) boletines = { host, prefijo, categorias };
  }

  if (errores.length) throw new Error(`Configuración de la base de conocimiento inválida:\n  - ${errores.join("\n  - ")}`);
  return { version: Number(raiz.version) || 1, enlacesIniciales, procedimientos, fuentesObservatorio, secciones, hostsPermitidos, ...(boletines ? { boletines } : {}) };
}

let cache: { ruta: string; config: ConfigBase } | undefined;

/** Carga y valida la configuración. Memoizada por ruta; `KB_CONFIG_FILE` permite apuntar a otra en pruebas. */
export function cargarConfig(ruta = process.env.KB_CONFIG_FILE || RUTA_POR_DEFECTO): ConfigBase {
  if (cache?.ruta === ruta) return cache.config;
  const config = validarConfig(JSON.parse(fs.readFileSync(ruta, "utf8")));
  cache = { ruta, config };
  return config;
}

/** ¿El host de esta URL https está en la lista permitida? (RF-C3-AD-15 / RF-C3-IV-01). */
export function hostPermitido(url: string, config = cargarConfig()): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return config.hostsPermitidos.some(h =>
    h.tipo === "host_exacto" ? host === h.host : host === h.host || host.endsWith(`.${h.host}`));
}

/**
 * Dirección por sección de sitio: gana el prefijo de ruta más largo del mismo
 * host. Sin coincidencia, `secretaria_general` (R11).
 */
export function direccionPorUrl(url: string, config = cargarConfig()): Direccion {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "secretaria_general"; }
  const host = parsed.hostname.toLowerCase();
  let mejor: Seccion | undefined;
  for (const seccion of config.secciones) {
    if (seccion.host !== host || !parsed.pathname.startsWith(seccion.prefijo)) continue;
    if (!mejor || seccion.prefijo.length > mejor.prefijo.length) mejor = seccion;
  }
  return mejor?.direccion ?? "secretaria_general";
}
