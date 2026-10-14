/**
 * Servicio de la base de conocimiento: las operaciones que hoy expone la CLI
 * `kb` (contracts/kb-cli.md) y que el panel del bloque 7 reutilizará detrás de
 * pantallas autenticadas. La CLI no tiene lógica propia: todo vive aquí.
 */
import { saveCalibration, type CalibrationReport } from "./calibration.js";
import { confirmarGeneracion, manifiestoDeMatriz, reconciliarAlias } from "./publicationManifest.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { aplicarMigraciones as aplicar, enTransaccion, kbPool, type Pool } from "./db.js";
import { aliasKb, coleccionDelAlias, qdrant } from "../services/qdrant.js";
import { registrarAccion } from "./audit.js";
import { cargarConfig, hostPermitido } from "./config.js";
import {
  actualizarDireccion, actualizarTitulo, AVGDL_POR_DEFECTO, contarPuntos, crearColeccion,
  elementosIndexados, indexarVersion, longitudesDe, nombreColeccionNueva,
  type Embedder, type ElementoIndexable,
} from "./indexer.js";
import { listarNotificaciones, marcarRevisada, notificar, type Notificacion } from "./notifications.js";
import { nombreDescriptivo, nombreUnico } from "./nombres.js";
import { codigoVinculable, direccionDeElemento } from "./scope.js";

export async function aplicarMigraciones(db: Pool = kbPool()): Promise<string[]> {
  return aplicar(db);
}

export type EstadoBase = {
  alias: string;
  coleccion: string | null;
  puntos: number;
  elementosPorEstado: Record<string, number>;
  ultimaCorrida: { id: string; estado: string; terminadaEn: Date; programada: boolean; completa: boolean } | null;
  ultimaIndexacion: { tipo: string; estado: string; iniciadaEn: Date; terminadaEn: Date | null } | null;
  notificacionesSinRevisar: number;
  /** Corridas que alguien está procesando ahora (con latido reciente). */
  corridasEnProceso: Array<{ id: string; verificaciones: number }>;
};

const ABANDONO_MIN = Number(process.env.KB_CORRIDA_ABANDONO_MIN ?? 10);

/** Corridas en proceso con latido reciente (las abandonadas no cuentan: se retoman). */
export async function corridasEnProceso(db: Pool): Promise<Array<{ id: string; verificaciones: number }>> {
  const { rows } = await db.query<{ id: string; n: string }>(
    `SELECT c.id, (SELECT count(*) FROM kb.kb_verificacion v WHERE v.corrida_id = c.id) AS n
       FROM kb.kb_corrida c
      WHERE c.estado = 'en_proceso' AND c.latido_en >= now() - make_interval(mins => $1)`, [ABANDONO_MIN]);
  return rows.map(r => ({ id: r.id, verificaciones: Number(r.n) }));
}

export async function estadoBase(db: Pool = kbPool()): Promise<EstadoBase> {
  const alias = aliasKb();
  const coleccion = (await coleccionDelAlias(qdrant(), alias)) ?? null;
  const puntos = coleccion ? (await qdrant().count(coleccion, { exact: true })).count : 0;

  const porEstado = await db.query<{ estado: string; n: string }>(
    "SELECT estado, count(*) AS n FROM kb.kb_elemento GROUP BY estado");
  const corrida = await db.query(
    "SELECT id, estado, terminada_en, programada, completa FROM kb.kb_corrida ORDER BY terminada_en DESC LIMIT 1");
  const indexacion = await db.query(
    "SELECT tipo, estado, iniciada_en, terminada_en FROM kb.kb_indexacion ORDER BY iniciada_en DESC LIMIT 1");
  const pendientes = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM kb.kb_notificacion WHERE estado = 'no_revisada'");

  const c = corrida.rows[0];
  const i = indexacion.rows[0];
  return {
    alias,
    coleccion,
    puntos,
    elementosPorEstado: Object.fromEntries(porEstado.rows.map(r => [r.estado, Number(r.n)])),
    ultimaCorrida: c ? { id: c.id, estado: c.estado, terminadaEn: c.terminada_en, programada: c.programada, completa: c.completa } : null,
    ultimaIndexacion: i ? { tipo: i.tipo, estado: i.estado, iniciadaEn: i.iniciada_en, terminadaEn: i.terminada_en } : null,
    notificacionesSinRevisar: Number(pendientes.rows[0].n),
    corridasEnProceso: await corridasEnProceso(db),
  };
}

// ── Publicación y auditoría (US1: RF-C3-IV-01, IV-11; FR-005, FR-017) ───────

export class ErrorPublicacion extends Error {
  constructor(message: string, readonly codigo?: "candidata_cambiada") { super(message); }
}

type FilaPublicable = {
  id: string; clave: string; codigo: string | null; nombre: string; tipo: string; direccion: string;
  url_origen: string; url_padre: string | null; fecha_actualizacion: Date | null;
  version_publicada_id: string | null; version_pendiente_id: string;
  contenido_md: string; fecha_acceso: Date; decision: string | null; ocr_aplicado: boolean | null;
};

/** `avgdl` de la última construcción completa terminada (R3), o el valor por defecto. */
export async function avgdlVigente(db: Pool): Promise<number> {
  const { rows } = await db.query<{ avgdl: number }>(
    "SELECT avgdl FROM kb.kb_indexacion WHERE estado = 'terminada' AND tipo = 'completa' AND avgdl IS NOT NULL ORDER BY terminada_en DESC LIMIT 1");
  return rows[0]?.avgdl ?? AVGDL_POR_DEFECTO;
}

export function aIndexable(f: { id: string; codigo: string | null; nombre: string; tipo: string; direccion: string; url_origen: string; url_padre: string | null; fecha_actualizacion: Date | string | null }): ElementoIndexable {
  const fecha = f.fecha_actualizacion instanceof Date ? f.fecha_actualizacion.toISOString().slice(0, 10) : f.fecha_actualizacion;
  return {
    id: f.id, codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, direccion: f.direccion,
    urlOrigen: f.url_origen, urlPadre: f.url_padre, fechaActualizacion: fecha ?? null,
  };
}

export type ElementoPendiente = { clave: string; tipo: string; fuente: string; nombre: string; estado: string; dias: number };

export async function listarPendientes(db: Pool = kbPool()): Promise<ElementoPendiente[]> {
  const { rows } = await db.query(
    `SELECT e.clave, e.tipo, e.fuente, e.nombre, e.estado,
            floor(extract(epoch FROM now() - v.creada_en) / 86400)::int AS dias
       FROM kb.kb_elemento e JOIN kb.kb_version v ON v.id = e.version_pendiente_id
      ORDER BY v.creada_en`);
  return rows;
}

/**
 * Publica versiones pendientes (FR-017): indexa la versión nueva, la marca
 * publicada y DESPUÉS borra la anterior (R2/R4): nunca hay un instante sin
 * ninguna versión servida. No modifica `fecha_carga` (FR-003).
 */
export async function publicar(
  db: Pool, seleccion: { claves?: string[]; todosPendientes?: boolean }, actor: string,
  opciones: { embedder?: Embedder; forzar?: boolean } = {},
): Promise<{ publicados: string[]; rechazados: Array<{ clave: string; motivo: string }> }> {
  if (!seleccion.todosPendientes && !seleccion.claves?.length) throw new ErrorPublicacion("Indica claves o --todos-pendientes.");
  const enProceso = opciones.forzar ? [] : await corridasEnProceso(db);
  if (enProceso.length) {
    throw new ErrorPublicacion(
      `La corrida ${enProceso[0].id} se está procesando (${enProceso[0].verificaciones} verificaciones hasta ahora): ` +
      "publicar ahora cargaría una base incompleta. Espera a que termine (kb estado) o usa --forzar.");
  }
  const { rows } = await db.query<FilaPublicable>(
    `SELECT e.id, e.clave, e.codigo, e.nombre, e.tipo, e.direccion, e.url_origen, e.url_padre, e.fecha_actualizacion,
            e.version_publicada_id, e.version_pendiente_id, v.contenido_md, v.fecha_acceso,
            p.decision, p.ocr_aplicado
       FROM kb.kb_elemento e
       JOIN kb.kb_version v ON v.id = e.version_pendiente_id
       LEFT JOIN kb.kb_procesamiento p ON p.id = v.procesamiento_id
      WHERE e.estado IN ('pendiente_aprobacion', 'publicado') AND e.retirado_en IS NULL
        AND v.estado_tecnico = 'procesado'
        AND ($1::boolean OR e.clave = ANY($2::text[]))
      ORDER BY e.clave`,
    [Boolean(seleccion.todosPendientes), seleccion.claves ?? []],
  );
  const rechazados: Array<{ clave: string; motivo: string }> = [];
  if (seleccion.claves) {
    for (const clave of seleccion.claves) {
      if (!rows.some(r => r.clave === clave)) rechazados.push({ clave, motivo: "no existe o no tiene versión pendiente" });
    }
  }
  const aptos = rows.filter(f => !f.decision || f.decision === "cargado");
  for (const f of rows) {
    if (f.decision && f.decision !== "cargado") rechazados.push({ clave: f.clave, motivo: `procesamiento ${f.decision}` });
  }
  if (!aptos.length) return { publicados: [], rechazados };
  // Toda publicación pasa por el mismo protocolo que el panel (SPEC007, research R04): colección
  // candidata completa → commit SQL de generación y versiones → alias espejo → limpieza.
  await reconstruirColeccion(db, actor, { embedder: opciones.embedder, promover: aptos.map(f => f.clave) });
  return { publicados: aptos.map(f => f.clave), rechazados };
}

export type AuditoriaAlcance = {
  ok: boolean; filas: number; publicados: number;
  puntosSinFila: string[]; filasSinPuntos: string[]; fueraDeReglas: Array<{ clave: string; motivo: string }>;
};

/** Compara la matriz con la colección servida y con las reglas de alcance (RF-C3-IV-01, IV-11). */
export async function auditarAlcance(db: Pool = kbPool()): Promise<AuditoriaAlcance> {
  const config = cargarConfig();
  const { rows } = await db.query<{ id: string; clave: string; codigo: string | null; estado: string; fuente: string; url_origen: string; procedimientos_origen: string[] }>(
    "SELECT id, clave, codigo, estado, fuente, url_origen, procedimientos_origen FROM kb.kb_elemento");
  const indexados = await elementosIndexados();
  const publicados = rows.filter(r => r.estado === "publicado");
  const idsPublicados = new Set(publicados.map(r => r.id));
  const fueraDeReglas: Array<{ clave: string; motivo: string }> = [];
  for (const r of rows) {
    if (!hostPermitido(r.url_origen, config)) fueraDeReglas.push({ clave: r.clave, motivo: "host fuera de la lista permitida" });
    else if (r.fuente === "gmas2_envigado") {
      const esSemilla = r.codigo !== null && r.codigo in config.procedimientos;
      if (!esSemilla && !(r.codigo && codigoVinculable(r.codigo))) fueraDeReglas.push({ clave: r.clave, motivo: "tipo de documento fuera del alcance" });
      else if (!esSemilla && !r.procedimientos_origen.some(c => c in config.procedimientos)) fueraDeReglas.push({ clave: r.clave, motivo: "ningún procedimiento del alcance lo cita" });
    } else if (!(r.fuente in config.fuentesObservatorio)) fueraDeReglas.push({ clave: r.clave, motivo: `fuente ${r.fuente} fuera del alcance` });
  }
  const puntosSinFila = [...indexados].filter(id => !idsPublicados.has(id));
  const filasSinPuntos = publicados.filter(r => !indexados.has(r.id)).map(r => r.clave);
  return {
    ok: !puntosSinFila.length && !filasSinPuntos.length && !fueraDeReglas.length,
    filas: rows.length, publicados: publicados.length, puntosSinFila, filasSinPuntos, fueraDeReglas,
  };
}

/** Vuelve a aplicar el mapa de direcciones (R11) a la matriz y al payload de Qdrant. */
export async function recalcularDirecciones(db: Pool, actor: string): Promise<Array<{ clave: string; antes: string; despues: string }>> {
  const config = cargarConfig();
  const { rows } = await db.query(
    "SELECT id, clave, fuente, tipo, codigo, direccion, url_origen, url_padre, procedimientos_origen, estado FROM kb.kb_elemento");
  const cambios: Array<{ clave: string; antes: string; despues: string }> = [];
  for (const r of rows) {
    const despues = direccionDeElemento({
      fuente: r.fuente, tipo: r.tipo, codigo: r.codigo, urlOrigen: r.url_origen, urlPadre: r.url_padre,
      procedimientosOrigen: r.procedimientos_origen,
    }, config);
    if (despues === r.direccion) continue;
    await db.query("UPDATE kb.kb_elemento SET direccion = $2, actualizado_en = now() WHERE id = $1", [r.id, despues]);
    if (r.estado === "publicado") await actualizarDireccion(r.id, despues);
    await registrarAccion(db, actor, "recalcular_direccion", r.clave, `${r.direccion} → ${despues}`);
    cambios.push({ clave: r.clave, antes: r.direccion, despues });
  }
  return cambios;
}

/**
 * Vuelve a nombrar las páginas con la regla de nombres.ts (matriz y payload de Qdrant). Entre dos
 * páginas que quedan con el mismo nombre, la más antigua lo conserva y las demás se desambiguan,
 * igual que al sincronizar.
 */
export async function recalcularNombres(db: Pool, actor: string): Promise<Array<{ clave: string; antes: string; despues: string }>> {
  const config = cargarConfig();
  const { rows } = await db.query(
    `SELECT id, clave, nombre, url_origen, estado, codigo FROM kb.kb_elemento WHERE tipo = 'pagina'
      ORDER BY fecha_carga, id`);
  const usados = new Set<string>(
    (await db.query<{ nombre: string }>("SELECT nombre FROM kb.kb_elemento WHERE tipo <> 'pagina'")).rows.map(r => r.nombre));
  const cambios: Array<{ clave: string; antes: string; despues: string }> = [];
  for (const r of rows) {
    // El nombre actual solo sirve de título base si la URL no es de boletín: nunca se compone sobre un nombre ya compuesto.
    const despues = nombreUnico(nombreDescriptivo(r.url_origen, r.nombre, config), r.url_origen, c => usados.has(c));
    usados.add(despues);
    if (despues === r.nombre) continue;
    await db.query("UPDATE kb.kb_elemento SET nombre = $2, actualizado_en = now() WHERE id = $1", [r.id, despues]);
    if (r.estado === "publicado") await actualizarTitulo(r.id, r.codigo ? `${r.codigo} - ${despues}` : despues);
    await registrarAccion(db, actor, "recalcular_nombre", r.clave, `${r.nombre} → ${despues}`);
    cambios.push({ clave: r.clave, antes: r.nombre, despues });
  }
  return cambios;
}

/** Directorio por defecto de `exportar-fichas` (KB_EXPORT_DIR). */
export function dirExportFichas(): string {
  return path.join(process.env.KB_EXPORT_DIR?.trim() || "/app/var/exports", "fichas");
}

/** Nombre de archivo: el código del procedimiento o un slug de la URL de la página. */
export function nombreArchivoFicha(codigo: string | null, urlOrigen: string): string {
  if (codigo) return `${codigo.toLowerCase()}.md`;
  const u = new URL(urlOrigen);
  const slug = `${u.hostname}${u.pathname}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug.slice(0, 150) || "pagina"}.md`;
}

/**
 * Escribe un .md por ficha de procedimiento y por página publicadas, con su
 * encabezado (RF-C3-IV-05, IV-06). Es lo que el revisor compara contra GMAS2 y
 * contra el sitio de origen.
 */
export async function exportarFichas(
  db: Pool = kbPool(), salida: string = dirExportFichas(), actor = "sistema",
): Promise<{ directorio: string; archivos: string[] }> {
  const { rows } = await db.query(
    `SELECT e.clave, e.codigo, e.url_origen, v.contenido_md
       FROM kb.kb_elemento e JOIN kb.kb_version v ON v.id = e.version_publicada_id
      WHERE e.estado = 'publicado' AND e.tipo IN ('procedimiento', 'pagina')
      ORDER BY e.tipo, e.clave`);
  await fs.mkdir(salida, { recursive: true });
  const archivos: string[] = [];
  const usados = new Set<string>();
  for (const r of rows) {
    const base = nombreArchivoFicha(r.codigo, r.url_origen);
    let nombre = base;
    for (let n = 2; usados.has(nombre); n++) nombre = base.replace(/\.md$/, `-${n}.md`);
    usados.add(nombre);
    await fs.writeFile(path.join(salida, nombre), r.contenido_md, "utf8");
    archivos.push(nombre);
  }
  await registrarAccion(db, actor, "exportar_fichas", salida, `${archivos.length} archivos`);
  return { directorio: salida, archivos };
}

/** Notificaciones al administrador: las sin revisar, o todas (RF-C3-IV-03, IV-04, IV-07; FR-018). */
export async function notificaciones(db: Pool = kbPool(), opciones: { todas?: boolean } = {}): Promise<Notificacion[]> {
  return listarNotificaciones(db, opciones);
}

/** Marca una notificación como revisada y lo audita. false si no existe o ya estaba revisada. */
export async function revisarNotificacion(db: Pool, id: string, actor: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ErrorPublicacion(`"${id}" no es un identificador de notificación.`);
  }
  const revisada = await marcarRevisada(db, id, actor);
  if (revisada) await registrarAccion(db, actor, "revisar_notificacion", id, "revisada");
  return revisada;
}

// ── Reindexación completa sin interrupción (US5 SPEC001; protocolo de generación SPEC007) ──

/** Desde este número de elementos la CLI avisa que la publicación reconstruye la colección. */
export const UMBRAL_PUBLICACION_MASIVA = 50;

export type FaseGeneracion = "preparing" | "prepared" | "committed" | "reconciling" | "cleaning";

export type ResultadoReindexacion = {
  indexacionId: string; coleccion: string; anterior: string | undefined;
  elementos: number; puntos: number; avgdl: number;
  duracionEtapasMs: { conversion: number; ocr: number; embeddings: number; indexacion: number };
  promovidos: string[];
  /** La limpieza de la colección anterior no se confirmó: el contenido ya está servido; se reanuda después. */
  limpiezaPendiente: boolean;
};

type FilaReindexable = {
  id: string; clave: string; codigo: string | null; nombre: string; tipo: string; direccion: string;
  url_origen: string; url_padre: string | null; fecha_actualizacion: Date | null;
  version_id: string; contenido_md: string; fecha_acceso: Date; ocr_aplicado: boolean | null;
  procesamiento_ms: number | null; procesamiento_ocr: boolean | null; hash_contenido: string; revision: string;
  candidatos: Record<string, unknown> | null;
};

const MAPA_DIRECCION: Record<string, string> = {
  "Ecosistemas": "ecosistemas", "Bienestar Animal": "bienestar_animal",
  "Gestión Ambiental": "gestion_ambiental", "Secretaría (general)": "secretaria_general",
};
const MAPA_TIPO: Record<string, string> = {
  "Procedimiento": "procedimiento", "Formato": "formato", "Norma": "norma", "Página": "pagina", "Documento": "documento",
};

/** Qué cambia en el elemento cuando su versión candidata se publica (metadata de la versión). */
export function metadataPublicada(candidatos: Record<string, unknown> | null): {
  nombre?: string; tipo?: string; direccion?: string; urlOrigen?: string; version?: string | null;
  fechaActualizacion?: string | null; validoHasta?: string | null; procedimientos?: string[];
} {
  if (!candidatos) return {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const out: ReturnType<typeof metadataPublicada> = {};
  const nombre = str(candidatos.title); if (nombre) out.nombre = nombre;
  const tipo = str(candidatos.type); if (tipo && MAPA_TIPO[tipo]) out.tipo = MAPA_TIPO[tipo];
  const dir = str(candidatos.direction); if (dir && MAPA_DIRECCION[dir]) out.direccion = MAPA_DIRECCION[dir];
  const url = str(candidatos.publicUrl); if (url) out.urlOrigen = url;
  if ("version" in candidatos) out.version = str(candidatos.version) ?? null;
  if ("updatedDate" in candidatos) out.fechaActualizacion = str(candidatos.updatedDate) ?? null;
  if ("validUntil" in candidatos) out.validoHasta = str(candidatos.validUntil) ?? null;
  const proc = str(candidatos.associatedProcedure);
  if (proc) out.procedimientos = proc.toLowerCase() === "ninguno" ? [] : [proc];
  return out;
}

async function heredarCalibracion(db: Pool | import("pg").PoolClient, nueva: string, anterior: string | undefined): Promise<void> {
  if (!anterior) return;
  await db.query(
    `INSERT INTO kb.kb_calibracion (coleccion, umbral, embedding_version, reranker_version, politica_version, corpus_hash, oro_hash, reporte)
     SELECT $1, umbral, embedding_version, reranker_version, politica_version, corpus_hash, oro_hash,
            jsonb_set(reporte, '{heredadaDe}', to_jsonb($2::text))
       FROM kb.kb_calibracion WHERE coleccion = $2
     ON CONFLICT (coleccion) DO NOTHING`, [nueva, anterior]);
}

/** Espera de gracia antes de borrar la colección anterior: las consultas en vuelo la terminan. */
export function graciaLimpiezaMs(): number {
  const v = Number(process.env.KB_GRACIA_LIMPIEZA_MS ?? 15_000);
  return Number.isFinite(v) && v >= 0 ? v : 15_000;
}

/**
 * Elimina una colección física que ya no es la activa y comprueba su ausencia. Nunca toca la
 * generación activa. Devuelve true si la ausencia quedó confirmada.
 */
export async function limpiarColeccion(
  db: Pool, coleccion: string, opciones: { operacionId?: string | null; graciaMs?: number } = {},
): Promise<boolean> {
  const activa = (await db.query<{ collection_name: string }>("SELECT collection_name FROM kb.active_generation")).rows[0]?.collection_name;
  if (!activa || coleccion === activa) return true;
  const gracia = opciones.graciaMs ?? graciaLimpiezaMs();
  if (gracia > 0) await new Promise(resolve => setTimeout(resolve, gracia));
  const cliente = qdrant(120_000);
  const existe = (await cliente.collectionExists(coleccion)).exists;
  if (existe) await cliente.deleteCollection(coleccion);
  const ausente = !(await cliente.collectionExists(coleccion)).exists;
  await db.query(
    `INSERT INTO kb.cleanup_receipt (operation_id, object_kind, object_ref, verified_absent, detail)
     VALUES ($1, 'coleccion', $2, $3, $4)`,
    [opciones.operacionId ?? null, coleccion, ausente, ausente ? "colección eliminada" : "la colección sigue presente"]);
  return ausente;
}

/**
 * Construye una colección CANDIDATA con todo lo publicado más las versiones a promover, la
 * verifica y solo entonces confirma, en una transacción SQL, la nueva generación (versiones,
 * metadata vigente y manifiesto). El alias de Qdrant se reconcilia DESPUÉS como espejo y la
 * colección anterior se elimina al final.
 *
 *  · Antes del commit cualquier fallo borra solo la candidata: la generación activa y el contenido
 *    publicado siguen intactos y nada parcial fue recuperable.
 *  · Después del commit jamás se borra la activa ni se revierte a contenido ya eliminado: un fallo
 *    de alias o de limpieza se reporta como `limpiezaPendiente` y se reanuda.
 *
 * `promover` (claves con versión pendiente) se indexa en la candidata y, solo si todo salió bien,
 * pasa a publicada: es la publicación atómica. `onFase` permite al worker persistir cada fase.
 */
export async function reconstruirColeccion(
  db: Pool, actor: string,
  opciones: {
    embedder?: Embedder; promover?: string[]; tipo?: "completa";
    /**
     * Versión aprobada por clave (SPEC008, NV-02/NV-03). Si se indica, la promoción solo ocurre
     * cuando el pendiente es exactamente esa versión y está procesada; si no, se aborta el commit
     * con `candidata_cambiada` y lo vigente no se toca.
     */
    objetivos?: Record<string, string>;
    /**
     * Calibra la colección CANDIDATA (RF-C3-DI-05). Se ejecuta antes del commit y su resultado se
     * guarda junto a la colección; si falla, la candidata se descarta y la activa sigue sirviendo.
     * Sin esta opción la candidata hereda la calibración vigente de la colección que reemplaza.
     */
    calibrar?: (coleccion: string, info: { corpusHash: string }) => Promise<CalibrationReport>;
    onFase?: (fase: FaseGeneracion, info: { candidata: string; anterior?: string }) => Promise<void>;
    graciaMs?: number;
    operacionId?: string | null;
    /** El worker de operaciones avisa solo tras agotar el reintento; la CLI avisa en cada fallo. */
    avisarFallo?: boolean;
  } = {},
): Promise<ResultadoReindexacion> {
  const promover = opciones.promover ?? [];
  const nueva = nombreColeccionNueva();
  let indexacionId: string;
  try {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO kb.kb_indexacion (tipo, coleccion, estado) VALUES ('completa', $1, 'en_curso') RETURNING id", [nueva]);
    indexacionId = rows[0].id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ErrorPublicacion("Ya hay una indexación en curso.");
    throw error;
  }
  const inicio = Date.now();
  let creada = false;
  let confirmada = false;
  try {
    await opciones.onFase?.("preparing", { candidata: nueva });
    if (opciones.objetivos) {
      const { rows: vigentes } = await db.query<{ clave: string; version_pendiente_id: string | null; estado_tecnico: string | null }>(
        `SELECT e.clave, e.version_pendiente_id, v.estado_tecnico
           FROM kb.kb_elemento e LEFT JOIN kb.kb_version v ON v.id = e.version_pendiente_id
          WHERE e.clave = ANY($1::text[])`, [promover]);
      for (const [clave, objetivo] of Object.entries(opciones.objetivos)) {
        const f = vigentes.find(x => x.clave === clave);
        if (!f || f.version_pendiente_id !== objetivo || f.estado_tecnico !== "procesado") {
          throw new ErrorPublicacion("La versión pendiente cambió o no está procesada; no se publica.", "candidata_cambiada");
        }
      }
    }
    const { rows } = await db.query<FilaReindexable>(
      `SELECT e.id, e.clave, e.codigo, e.nombre, e.tipo, e.direccion, e.url_origen, e.url_padre, e.fecha_actualizacion,
              v.id AS version_id, v.contenido_md, v.fecha_acceso, v.hash_contenido, e.revision::text AS revision,
              v.metadatos_candidatos AS candidatos,
              p.duracion_ms AS procesamiento_ms, p.ocr_aplicado AS procesamiento_ocr, e.ocr_aplicado
         FROM kb.kb_elemento e
         JOIN kb.kb_version v ON v.id = CASE WHEN e.clave = ANY($1::text[]) THEN e.version_pendiente_id ELSE e.version_publicada_id END
         LEFT JOIN kb.kb_procesamiento p ON p.id = v.procesamiento_id
        WHERE e.retirado_en IS NULL AND (e.estado IN ('publicado', 'vencido') OR e.clave = ANY($1::text[]))
          AND v.estado_tecnico = 'procesado'
        ORDER BY e.clave`, [promover]);

    const indexables = rows.map(r => {
      const meta = promover.includes(r.clave) ? metadataPublicada(r.candidatos) : {};
      const base = aIndexable(r);
      return {
        r, meta,
        version: { id: r.version_id, contenidoMd: r.contenido_md, fechaAcceso: r.fecha_acceso },
        elemento: {
          ...base,
          nombre: meta.nombre ?? base.nombre, tipo: meta.tipo ?? base.tipo, direccion: meta.direccion ?? base.direccion,
          urlOrigen: meta.urlOrigen ?? base.urlOrigen,
          fechaActualizacion: meta.fechaActualizacion !== undefined ? meta.fechaActualizacion : base.fechaActualizacion,
        } as ElementoIndexable,
      };
    });
    // avgdl de la colección que se va a servir (R3), calculado sobre lo que se indexa.
    let longitudTotal = 0; let fragmentosTotal = 0;
    for (const { version, elemento } of indexables) {
      const largos = longitudesDe(version, elemento);
      longitudTotal += largos.reduce((a, b) => a + b, 0);
      fragmentosTotal += largos.length;
    }
    const avgdl = fragmentosTotal ? longitudTotal / fragmentosTotal : AVGDL_POR_DEFECTO;
    await db.query("UPDATE kb.kb_indexacion SET puntos_esperados = $2, avgdl = $3 WHERE id = $1", [indexacionId, fragmentosTotal, avgdl]);

    await crearColeccion(nueva);
    creada = true;
    const embedderBase = opciones.embedder ?? (await import("../services/embeddings.js")).embed;
    let msEmbeddings = 0;
    const embedder: Embedder = async (textos, tipo) => {
      const t0 = Date.now();
      try { return await embedderBase(textos, tipo); } finally { msEmbeddings += Date.now() - t0; }
    };
    const forzado = process.env.NODE_ENV === "test" ? /^(\d+)%$/.exec(process.env.KB_FALLO_FORZADO_EN ?? "") : null;
    const corteForzado = forzado ? Math.ceil(indexables.length * Number(forzado[1]) / 100) : Infinity;
    const t0 = Date.now();
    let puntos = 0; let hechos = 0;
    for (const { version, elemento } of indexables) {
      if (hechos >= corteForzado) throw new Error(`fallo forzado al ${forzado![1]} % (KB_FALLO_FORZADO_EN)`);
      puntos += await indexarVersion(version, elemento, { coleccion: nueva, avgdl, embedder });
      hechos++;
    }
    const msIndexacion = Date.now() - t0 - msEmbeddings;

    const indexados = await contarPuntos(nueva);
    if (indexados !== fragmentosTotal || puntos !== fragmentosTotal) {
      throw new Error(`la colección nueva tiene ${indexados} puntos y se esperaban ${fragmentosTotal}`);
    }
    const generacionPrevia = (await db.query<{ collection_name: string }>("SELECT collection_name FROM kb.active_generation")).rows[0]?.collection_name
      ?? await coleccionDelAlias(qdrant(), aliasKb());
    if (opciones.calibrar) {
      const corpusHash = createHash("sha256").update(indexables.map(v => v.version.id).sort().join("\n")).digest("hex");
      const informe = await opciones.calibrar(nueva, { corpusHash });
      await saveCalibration(db, informe);
    } else {
      await heredarCalibracion(db, nueva, generacionPrevia);
    }
    await opciones.onFase?.("prepared", { candidata: nueva, anterior: generacionPrevia });

    // COMMIT SQL ÚNICO: promoción de versiones, metadata vigente y manifiesto. Desde aquí la
    // colección nueva es la autoridad; el contenido anterior deja de existir en SQL.
    const { anterior } = await enTransaccion(db, async client => {
      if (promover.length) {
        const { rows: promovidas } = await client.query<{ id: string; clave: string; ver_pend: string; ver_pub: string | null; cand: Record<string, unknown> | null; ocr: boolean | null; estado_tecnico: string }>(
          `SELECT e.id, e.clave, e.version_pendiente_id AS ver_pend, e.version_publicada_id AS ver_pub,
                  v.metadatos_candidatos AS cand, v.estado_tecnico,
                  (SELECT p.ocr_aplicado FROM kb.kb_procesamiento p WHERE p.id = v.procesamiento_id) AS ocr
             FROM kb.kb_elemento e JOIN kb.kb_version v ON v.id = e.version_pendiente_id
            WHERE e.clave = ANY($1::text[]) FOR UPDATE OF e`, [promover]);
        if (opciones.objetivos) {
          // Solo se promueve la versión aprobada y procesada; cualquier otra cosa aborta el commit.
          for (const clave of promover) {
            const objetivo = opciones.objetivos[clave];
            if (!objetivo) continue;
            const p = promovidas.find(x => x.clave === clave);
            if (!p || p.ver_pend !== objetivo || p.estado_tecnico !== "procesado") {
              throw new ErrorPublicacion("La versión pendiente cambió o no está procesada; no se publica.", "candidata_cambiada");
            }
          }
        }
        for (const p of promovidas) {
          const m = metadataPublicada(p.cand);
          await client.query(
            `UPDATE kb.kb_elemento SET estado = 'publicado', version_publicada_id = version_pendiente_id, version_pendiente_id = NULL,
                    ocr_aplicado = COALESCE($2, false), derogado_en = NULL, actualizado_en = now(),
                    nombre = COALESCE($3, nombre), tipo = COALESCE($4::kb.tipo_elemento, tipo),
                    direccion = COALESCE($5::kb.direccion, direccion), url_origen = COALESCE($6, url_origen),
                    version_documento = CASE WHEN $7::boolean THEN $8 ELSE version_documento END,
                    fecha_actualizacion = CASE WHEN $9::boolean THEN $10::date ELSE fecha_actualizacion END,
                    valido_hasta = CASE WHEN $11::boolean THEN $12::date ELSE valido_hasta END,
                    procedimientos_origen = COALESCE($13::text[], procedimientos_origen),
                    -- Un reemplazo vuelve a ser «automático»: se retira la marca de fuente quitada.
                    actualizacion_automatica_deshabilitada = false,
                    revision = revision + 1
              WHERE id = $1`,
            [p.id, p.ocr, m.nombre ?? null, m.tipo ?? null, m.direccion ?? null, m.urlOrigen ?? null,
              "version" in m, m.version ?? null, "fechaActualizacion" in m, m.fechaActualizacion ?? null,
              "validoHasta" in m, m.validoHasta ?? null, m.procedimientos ?? null]);
          if (p.ver_pub && p.ver_pub !== p.ver_pend) {
            await client.query("DELETE FROM kb.kb_version WHERE id = $1", [p.ver_pub]);
          }
        }
        for (const clave of promover) await registrarAccion(client, actor, "publicar", clave, "publicado (generación candidata)");
      }
      return confirmarGeneracion(client, nueva, await manifiestoDeMatriz(client));
    });
    confirmada = true;
    await opciones.onFase?.("committed", { candidata: nueva, anterior: anterior?.coleccion ?? generacionPrevia });

    // Reconciliación y limpieza: nunca deshacen el commit; un fallo se reanuda después.
    let limpiezaPendiente = false;
    try {
      await opciones.onFase?.("reconciling", { candidata: nueva, anterior: anterior?.coleccion });
      await reconciliarAlias(db, aliasKb());
      await opciones.onFase?.("cleaning", { candidata: nueva, anterior: anterior?.coleccion });
      const previa = anterior?.coleccion ?? generacionPrevia;
      if (previa && previa !== nueva) {
        limpiezaPendiente = !(await limpiarColeccion(db, previa, { operacionId: opciones.operacionId, graciaMs: opciones.graciaMs }));
      }
    } catch (error) {
      limpiezaPendiente = true;
      await notificar(db, "indexacion_fallida", "kb_chunks",
        `La publicación quedó confirmada pero la reconciliación o limpieza falló y se reanudará: ${error instanceof Error ? error.message : error}`);
    }
    const sumaMs = (ocr: boolean) => rows.filter(r => Boolean(r.procesamiento_ocr) === ocr).reduce((a, r) => a + (r.procesamiento_ms ?? 0), 0);
    const duracionEtapasMs = { conversion: sumaMs(false), ocr: sumaMs(true), embeddings: msEmbeddings, indexacion: msIndexacion };
    await db.query(
      `UPDATE kb.kb_indexacion SET estado = 'terminada', terminada_en = now(), puntos_indexados = $2, duracion_etapas_ms = $3 WHERE id = $1`,
      [indexacionId, indexados, JSON.stringify(duracionEtapasMs)]);
    await registrarAccion(db, actor, "reconstruir_coleccion", nueva, `${indexables.length} elementos, ${indexados} puntos, ${Date.now() - inicio} ms`);
    return {
      indexacionId, coleccion: nueva, anterior: anterior?.coleccion ?? generacionPrevia, elementos: indexables.length,
      puntos: indexados, avgdl, duracionEtapasMs, promovidos: promover, limpiezaPendiente,
    };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    // Antes del commit se descarta SOLO la candidata; tras el commit nunca se borra la activa.
    if (creada && !confirmada) await qdrant(120_000).deleteCollection(nueva).catch(() => undefined);
    await db.query("UPDATE kb.kb_indexacion SET estado = 'fallida', terminada_en = now(), detalle = $2 WHERE id = $1", [indexacionId, detalle.slice(0, 1000)]);
    if (!confirmada && opciones.avisarFallo !== false) {
      await notificar(db, "indexacion_fallida", "kb_chunks", `La reindexación completa falló y se conserva la versión anterior: ${detalle}`);
    }
    await registrarAccion(db, actor, "reconstruir_coleccion", nueva, `fallida: ${detalle}`.slice(0, 500));
    throw error;
  }
}

export { exportarMatriz } from "./exportMatrix.js";
export { purgarRetencion } from "./retention.js";
