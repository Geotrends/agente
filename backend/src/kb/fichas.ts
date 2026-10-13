/**
 * Encabezados de las fichas de procedimiento y de las páginas del Observatorio
 * (RF-C3-IV-05, IV-06; contracts/encabezados-markdown.md).
 *
 * La ficha de un GT-P o MG-P lleva SIEMPRE sus 10 campos, en el orden del
 * contrato; una lista vacía se escribe `[]`. La página lleva URL de origen,
 * fecha de acceso y la huella de su contenido, que es la misma de su versión
 * en `kb_version`: depende solo del cuerpo, no de la fecha de acceso.
 */
import { NOMBRE_DIRECCION, type Direccion } from "./config.js";
import type { VinculadoGmas } from "./runReport.js";

const LETRA = /^[A-Z]{2,3}-([A-Z]{1,2})-\d+$/;

function q(valor: string): string {
  return `"${valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

function lista(valores: string[]): string {
  return `[${valores.map(q).join(", ")}]`;
}

/** Códigos vinculados de un tipo (-F- o -N-), únicos y ordenados. Los MG-P no entran. */
export function codigosPorTipo(vinculados: Array<Pick<VinculadoGmas, "codigo">>, letra: "F" | "N"): string[] {
  return [...new Set(vinculados.map(v => v.codigo).filter(c => LETRA.exec(c)?.[1] === letra))].sort();
}

export type DatosFicha = {
  codigo: string;
  nombre: string;
  direccion: Direccion;
  estado: string;
  urlOrigen: string;
  version: string;
  fechaActualizacion: string;
  fechaAcceso: Date;
  vinculados: Array<Pick<VinculadoGmas, "codigo">>;
};

/** Ficha de un procedimiento: encabezado de 10 campos + cuerpo (RF-C3-IV-05). */
export function fichaProcedimiento(d: DatosFicha, cuerpo: string): string {
  const lineas = [
    `codigo: ${q(d.codigo)}`,
    `nombre: ${q(d.nombre)}`,
    `direccion_responsable: ${q(NOMBRE_DIRECCION[d.direccion])}`,
    `estado: ${q(d.estado)}`,
    `url_origen: ${q(d.urlOrigen)}`,
    `version: ${q(d.version)}`,
    `fecha_actualizacion: ${q(d.fechaActualizacion)}`,
    `fecha_acceso: ${q(d.fechaAcceso.toISOString())}`,
    `formatos_vinculados: ${lista(codigosPorTipo(d.vinculados, "F"))}`,
    `normas_vinculadas: ${lista(codigosPorTipo(d.vinculados, "N"))}`,
  ];
  return `---\n${lineas.join("\n")}\n---\n\n${cuerpo.trim()}\n`;
}

/** Página del Observatorio: URL, fecha de acceso, huella y título (RF-C3-IV-06). */
export function encabezadoPagina(
  d: { urlOrigen: string; fechaAcceso: Date; hashContenido: string; titulo?: string | null }, cuerpo: string,
): string {
  const lineas = [
    `url_origen: ${q(d.urlOrigen)}`,
    `fecha_acceso: ${q(d.fechaAcceso.toISOString())}`,
    `hash_contenido: ${q(d.hashContenido)}`,
    ...(d.titulo ? [`titulo: ${q(d.titulo)}`] : []),
  ];
  return `---\n${lineas.join("\n")}\n---\n\n${cuerpo.trim()}\n`;
}

/**
 * Lee el encabezado YAML que escriben estas funciones (valores entre comillas
 * y listas `[...]`). Para pruebas y para `kb exportar-fichas`.
 */
export function leerEncabezado(md: string): Record<string, string | string[]> {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  const campos: Record<string, string | string[]> = {};
  if (!m) return campos;
  for (const linea of m[1].split("\n")) {
    const kv = /^([a-z_]+): (.*)$/.exec(linea);
    if (!kv) continue;
    const [, clave, crudo] = kv;
    campos[clave] = crudo.startsWith("[") ? JSON.parse(crudo) as string[] : JSON.parse(crudo) as string;
  }
  return campos;
}
