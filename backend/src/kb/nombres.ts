/**
 * Nombres descriptivos de las páginas de la matriz (RF-C3-IV-11, RF-C3-IV-12).
 *
 * El título de una página del Ambientómetro es a veces solo un mes ("Abril") o
 * un nombre genérico ("Meteorología"): 12 filas distintas de la matriz se
 * llamaban igual y el chat las citaba igual (principio II). La URL sí dice de
 * qué se trata: `/docs/boletines-2025/meteorologia/abril/` es "Meteorología –
 * Abril 2025". Aquí se deriva ese nombre. Las funciones son puras.
 */
import type { ConfigBase } from "./config.js";

const MESES: Record<string, string> = {
  enero: "Enero", febrero: "Febrero", marzo: "Marzo", abril: "Abril", mayo: "Mayo", junio: "Junio",
  julio: "Julio", agosto: "Agosto", septiembre: "Septiembre", setiembre: "Septiembre", octubre: "Octubre",
  noviembre: "Noviembre", diciembre: "Diciembre",
};

const SEPARADOR = " – ";

function capitalizar(texto: string): string {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

/** `calidad-de-aire` → `Calidad de aire`. Sin tildes: solo es el último recurso. */
function humanizar(slug: string): string {
  return capitalizar(decodeURIComponent(slug).replace(/[-_]+/g, " ").trim());
}

function segmentos(urlOrigen: string): { host: string; partes: string[] } | undefined {
  try {
    const u = new URL(urlOrigen);
    return { host: u.hostname.toLowerCase(), partes: u.pathname.split("/").filter(Boolean).map(p => p.toLowerCase()) };
  } catch { return undefined; }
}

/**
 * Nombre de una página de boletín a partir de su URL, o `titulo` si la URL no
 * sigue el patrón `<prefijo>/<boletín>/<categoría>[/<mes>]`.
 *
 *   /docs/boletines-2025/meteorologia/abril/      → Meteorología – Abril 2025
 *   /docs/2022-2/ruido/agosto/                    → Ruido – Agosto 2022
 *   /docs/boletines-2024/calidad-del-aire-2024/   → Calidad del aire – Boletín 2024
 */
export function nombreDescriptivo(urlOrigen: string, titulo: string, config: Pick<ConfigBase, "boletines">): string {
  const regla = config.boletines;
  const url = segmentos(urlOrigen);
  if (!regla || !url || url.host !== regla.host) return titulo;
  const prefijo = regla.prefijo.split("/").filter(Boolean);
  if (!prefijo.every((p, i) => url.partes[i] === p)) return titulo;
  const [boletin, categoria, mes, ...resto] = url.partes.slice(prefijo.length);
  if (!boletin || !categoria || resto.length) return titulo;

  const anio = /(?:19|20)\d{2}/.exec(boletin)?.[0];
  if (!anio) return titulo;
  const slugCategoria = categoria.replace(/-?(?:19|20)\d{2}$/, "");
  const nombreCategoria = regla.categorias[slugCategoria] ?? humanizar(slugCategoria);
  if (mes === undefined) return `${nombreCategoria}${SEPARADOR}Boletín ${anio}`;
  const nombreMes = MESES[mes];
  return nombreMes ? `${nombreCategoria}${SEPARADOR}${nombreMes} ${anio}` : titulo;
}

/**
 * Último recurso cuando otra página ya usa ese nombre: se le añade un segmento de la URL, del
 * último al primero (lo que distingue una página de otra), saltando los que repiten el nombre, y
 * por fin el host. Devuelve los candidatos en orden de preferencia, sin repetir.
 */
export function candidatosDesambiguados(nombre: string, urlOrigen: string): string[] {
  const url = segmentos(urlOrigen);
  const detalles = [...(url?.partes ?? [])].reverse().map(humanizar);
  if (url?.host) detalles.push(url.host);
  const base = nombre.toLowerCase();
  const salida: string[] = [];
  for (const detalle of detalles) {
    if (!detalle || detalle.toLowerCase() === base) continue;
    const candidato = `${nombre}${SEPARADOR}${detalle}`;
    if (!salida.includes(candidato)) salida.push(candidato);
  }
  return salida;
}

/**
 * Nombre único para una página: `nombre` si nadie lo usa; si no, el primer candidato libre de
 * `candidatosDesambiguados` y, agotados, `nombre (2)`, `nombre (3)`… Nunca devuelve un nombre ocupado.
 */
export function nombreUnico(nombre: string, urlOrigen: string, ocupado: (candidato: string) => boolean): string {
  if (!ocupado(nombre)) return nombre;
  for (const candidato of candidatosDesambiguados(nombre, urlOrigen)) if (!ocupado(candidato)) return candidato;
  for (let n = 2; ; n++) if (!ocupado(`${nombre} (${n})`)) return `${nombre} (${n})`;
}
