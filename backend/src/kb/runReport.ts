/**
 * Lectura y validación del informe de corrida del scraper (research R1,
 * contracts/run-report.md).
 *
 * Es la única entrada del kb-worker desde el lado Python. Se valida campo por
 * campo antes de tocar la base: un informe malformado se rechaza entero, con
 * un motivo legible, en vez de dejar la matriz a medio actualizar.
 */
import fs from "node:fs/promises";

export const ROLES = ["procedimiento", "vinculado", "descarga", "pagina", "documento"] as const;
export const ESTADOS_DETECTADOS = ["vigente", "derogado", "no_aplica"] as const;
export const RESULTADOS = ["nuevo", "sin_cambios", "cambio_detectado", "error"] as const;
export const TIPOS_ERROR = ["inaccesible", "http", "estructura_modificada", "timeout", "fuera_de_alcance"] as const;

export type Rol = (typeof ROLES)[number];
export type EstadoDetectado = (typeof ESTADOS_DETECTADOS)[number];
export type Resultado = (typeof RESULTADOS)[number];
export type TipoError = (typeof TIPOS_ERROR)[number];

export type VinculadoGmas = { codigo: string; nombre: string; id: string; url: string; grupo: string };

export type MetadatosGmas = {
  id: string;
  codigo: string;
  nombre: string;
  version: string | null;
  fechaActualizacion: string | null;   // ISO yyyy-mm-dd
  estado: string;
  dependencia: string | null;
  vinculados: VinculadoGmas[];
  descarga: string | null;
};

export type Enlace = {
  url: string;
  fuente: string;
  fechaHora: Date;
  rol: Rol;
  padre: string | null;
  titulo: string | null;
  estadoDetectado: EstadoDetectado;
  resultado: Resultado;
  error: { tipo: TipoError; codigoHttp: number | null; detalle: string } | null;
  hashContenido: string | null;
  archivo: string | null;
  archivoOriginal: string | null;
  hashOriginal: string | null;
  gmas: MetadatosGmas | null;
};

export type InformeCorrida = {
  schemaVersion: 1;
  runId: string;
  programada: boolean;
  iniciadaEn: Date;
  terminadaEn: Date;
  fuentes: string[];
  completa: boolean;
  enlaces: Enlace[];
};

export class InformeInvalido extends Error {
  constructor(motivo: string) {
    super(`Informe de corrida inválido: ${motivo}`);
    this.name = "InformeInvalido";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !valor.trim()) throw new InformeInvalido(`${campo} vacío o no es texto`);
  return valor;
}
function textoOpcional(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  return texto(valor, campo);
}
function fecha(valor: unknown, campo: string): Date {
  const d = new Date(texto(valor, campo));
  if (Number.isNaN(d.getTime())) throw new InformeInvalido(`${campo} no es una fecha ISO`);
  return d;
}
function enumerado<T extends string>(valor: unknown, permitidos: readonly T[], campo: string): T {
  if (!permitidos.includes(valor as T)) throw new InformeInvalido(`${campo} desconocido: ${JSON.stringify(valor)}`);
  return valor as T;
}
function hash(valor: unknown, campo: string): string | null {
  const h = textoOpcional(valor, campo);
  if (h !== null && !SHA256.test(h)) throw new InformeInvalido(`${campo} no es un SHA-256`);
  return h?.toLowerCase() ?? null;
}

function validarGmas(crudo: unknown, i: number): MetadatosGmas | null {
  if (crudo === null || crudo === undefined) return null;
  const g = crudo as Record<string, unknown>;
  const pref = `enlaces[${i}].gmas`;
  const fechaAct = textoOpcional(g.fecha_actualizacion, `${pref}.fecha_actualizacion`);
  if (fechaAct && !/^\d{4}-\d{2}-\d{2}$/.test(fechaAct)) throw new InformeInvalido(`${pref}.fecha_actualizacion no es yyyy-mm-dd`);
  const vinculados = Array.isArray(g.vinculados) ? g.vinculados : [];
  return {
    id: texto(g.id, `${pref}.id`),
    codigo: texto(g.codigo, `${pref}.codigo`).toUpperCase(),
    nombre: texto(g.nombre, `${pref}.nombre`),
    version: textoOpcional(g.version, `${pref}.version`),
    fechaActualizacion: fechaAct,
    estado: textoOpcional(g.estado, `${pref}.estado`) ?? "",
    dependencia: textoOpcional(g.dependencia, `${pref}.dependencia`),
    vinculados: vinculados.map((v: Record<string, unknown>, j: number) => ({
      codigo: texto(v.codigo, `${pref}.vinculados[${j}].codigo`).toUpperCase(),
      nombre: textoOpcional(v.nombre, `${pref}.vinculados[${j}].nombre`) ?? "",
      id: texto(v.id, `${pref}.vinculados[${j}].id`),
      url: texto(v.url, `${pref}.vinculados[${j}].url`),
      grupo: textoOpcional(v.grupo, `${pref}.vinculados[${j}].grupo`) ?? "",
    })),
    descarga: textoOpcional(g.descarga, `${pref}.descarga`),
  };
}

/** Valida un informe ya parseado. Lanza `InformeInvalido` con el primer campo infractor. */
export function validarInforme(crudo: unknown): InformeCorrida {
  const raiz = (crudo ?? {}) as Record<string, unknown>;
  if (raiz.schema_version !== 1) throw new InformeInvalido(`schema_version no soportado: ${JSON.stringify(raiz.schema_version)}`);
  const runId = texto(raiz.run_id, "run_id");
  if (!UUID.test(runId)) throw new InformeInvalido("run_id no es un UUID");
  if (!Array.isArray(raiz.enlaces)) throw new InformeInvalido("enlaces no es una lista");
  if (typeof raiz.programada !== "boolean" || typeof raiz.completa !== "boolean") {
    throw new InformeInvalido("programada y completa deben ser booleanos");
  }

  const enlaces = raiz.enlaces.map((e: Record<string, unknown>, i: number): Enlace => {
    const pref = `enlaces[${i}]`;
    const resultado = enumerado(e.resultado, RESULTADOS, `${pref}.resultado`);
    const errorCrudo = e.error as Record<string, unknown> | null | undefined;
    const error = errorCrudo ? {
      tipo: enumerado(errorCrudo.tipo, TIPOS_ERROR, `${pref}.error.tipo`),
      codigoHttp: typeof errorCrudo.codigo_http === "number" ? errorCrudo.codigo_http : null,
      detalle: typeof errorCrudo.detalle === "string" ? errorCrudo.detalle : "",
    } : null;
    if ((resultado === "error") !== (error !== null)) {
      throw new InformeInvalido(`${pref}: un resultado "error" debe traer su error, y solo él`);
    }
    return {
      url: texto(e.url, `${pref}.url`),
      fuente: texto(e.fuente, `${pref}.fuente`),
      fechaHora: fecha(e.fecha_hora, `${pref}.fecha_hora`),
      rol: enumerado(e.rol, ROLES, `${pref}.rol`),
      padre: textoOpcional(e.padre, `${pref}.padre`),
      titulo: textoOpcional(e.titulo, `${pref}.titulo`),
      estadoDetectado: enumerado(e.estado_detectado ?? "no_aplica", ESTADOS_DETECTADOS, `${pref}.estado_detectado`),
      resultado,
      error,
      // Regla 1 del contrato: un error nunca trae archivo.
      hashContenido: error ? null : hash(e.hash_contenido, `${pref}.hash_contenido`),
      archivo: error ? null : textoOpcional(e.archivo, `${pref}.archivo`),
      archivoOriginal: textoOpcional(e.archivo_original, `${pref}.archivo_original`),
      hashOriginal: hash(e.hash_original, `${pref}.hash_original`),
      gmas: validarGmas(e.gmas, i),
    };
  });

  return {
    schemaVersion: 1,
    runId: runId.toLowerCase(),
    programada: raiz.programada,
    iniciadaEn: fecha(raiz.iniciada_en, "iniciada_en"),
    terminadaEn: fecha(raiz.terminada_en, "terminada_en"),
    fuentes: Array.isArray(raiz.fuentes) ? raiz.fuentes.map(String) : [],
    completa: raiz.completa,
    enlaces,
  };
}

/** Lee y valida un informe del disco. Los `.tmp` nunca son informes. */
export async function leerInforme(ruta: string): Promise<InformeCorrida> {
  if (ruta.endsWith(".tmp")) throw new InformeInvalido("un .tmp es un informe a medio escribir");
  let crudo: unknown;
  try {
    crudo = JSON.parse(await fs.readFile(ruta, "utf8"));
  } catch (error) {
    throw new InformeInvalido(`no es JSON válido (${error instanceof Error ? error.message : error})`);
  }
  return validarInforme(crudo);
}

/** ¿Este nombre de archivo es un informe listo para procesar? */
export function esInformeListo(nombre: string): boolean {
  return nombre.endsWith(".json") && !nombre.endsWith(".json.tmp");
}
