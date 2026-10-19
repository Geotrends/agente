/**
 * Documentos del panel (SPEC007 US2): carga manual en streaming, matriz, y comandos de
 * publicar/rechazar/retirar/editar/reindexar. El panel NUNCA escribe contenido ni toca Qdrant:
 *   · la carga entra por `kb.registrar_carga_manual` (versión pendiente, «en cola»);
 *   · las acciones privilegiadas crean un comando durable en `kb.document_operation` con la
 *     cuenta de la SESIÓN; el kb-worker (único escritor) las ejecuta por fases.
 * Un 202 significa «aceptada/En curso», jamás «Terminada».
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import Busboy from "busboy";
import type pg from "pg";
import { adminPool, adminTx } from "./db.js";
import { writeAudit } from "./audit.js";
import { ApiError, decodeCursor, encodeCursor, type Page } from "./contracts.js";
import {
  bogotaDate, isUuid, parseCivilDate, parseEnum, parsePublicUrl, parseRevision, parseUuid,
  requiredText, strictObject, ValidationError,
} from "./validation.js";
import { adminClock } from "./sessions.js";
import {
  dirArchivos, dirStaging, eliminarArchivo, nuevaReferencia, resolverReferencia, rutaStaging,
} from "../kb/documentFiles.js";
import { detectarFormato, type LimitesZip } from "../kb/zipInspect.js";

// ── Límites configurables (R06): defaults de propuesta, no métricas de aceptación ───────────────

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export function limitesCarga() {
  return {
    maxArchivo: num(process.env.KB_UPLOAD_MAX_BYTES, 32 * 1024 * 1024),
    maxMetadata: num(process.env.KB_UPLOAD_META_MAX_BYTES, 32 * 1024),
    zip: {
      maxEntradas: num(process.env.KB_UPLOAD_ZIP_MAX_ENTRIES, 100),
      maxExpandido: num(process.env.KB_UPLOAD_ZIP_MAX_EXPANDED, 256 * 1024 * 1024),
      maxRazon: num(process.env.KB_UPLOAD_ZIP_MAX_RATIO, 100),
    } satisfies LimitesZip,
  };
}

// ── Catálogos ───────────────────────────────────────────────────────────────

export const TIPOS = ["Procedimiento", "Formato", "Norma", "Página", "Documento"] as const;
export const DIRECCIONES = ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental", "Secretaría (general)"] as const;
const TIPO_SQL: Record<string, string> = { Procedimiento: "procedimiento", Formato: "formato", Norma: "norma", "Página": "pagina", Documento: "documento" };
const DIR_SQL: Record<string, string> = {
  Ecosistemas: "ecosistemas", "Bienestar Animal": "bienestar_animal", "Gestión Ambiental": "gestion_ambiental", "Secretaría (general)": "secretaria_general",
};
const CODIGO_PROCEDIMIENTO = /^[A-Z]{2,3}-[A-Z]{1,2}-\d{1,5}$/;
const CODIGO_DOCUMENTO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/;

export type MetadataCarga = {
  type: string; title: string; direction: string; publicUrl: string; associatedProcedure: string;
  code: string | null; version: string | null; updatedDate: string | null; validUntil: string | null;
};

const esNA = (v: unknown) => v === undefined || v === null || (typeof v === "string" && ["", "n/a"].includes(v.trim().toLowerCase()));

/** Normaliza la URL para usarla como clave de identidad (host en minúsculas, sin fragmento ni «/» final). */
export function normalizarUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  const s = u.toString();
  return s.endsWith("/") && u.pathname !== "/" ? s.slice(0, -1) : s;
}

export function parseMetadataCarga(raw: unknown): MetadataCarga {
  const b = strictObject(raw, ["type", "title", "direction", "publicUrl", "associatedProcedure", "code", "version", "updatedDate", "validUntil"],
    ["type", "title", "direction", "publicUrl", "associatedProcedure"]);
  const procedimiento = requiredText(b.associatedProcedure, "associatedProcedure", 40);
  const esNinguno = procedimiento.toLowerCase() === "ninguno";
  if (!esNinguno && !CODIGO_PROCEDIMIENTO.test(procedimiento.toUpperCase())) {
    throw new ValidationError("associatedProcedure", "Indique un código de procedimiento válido o «ninguno».");
  }
  let code: string | null = null;
  if (!esNA(b.code)) {
    code = requiredText(b.code, "code", 60);
    if (!CODIGO_DOCUMENTO.test(code)) throw new ValidationError("code", "El código contiene caracteres no permitidos.");
  }
  return {
    type: parseEnum(b.type, TIPOS, "type"),
    title: requiredText(b.title, "title", 300),
    direction: parseEnum(b.direction, DIRECCIONES, "direction"),
    publicUrl: parsePublicUrl(b.publicUrl, "publicUrl"),
    associatedProcedure: esNinguno ? "ninguno" : procedimiento.toUpperCase(),
    code,
    version: esNA(b.version) ? null : requiredText(b.version, "version", 40),
    updatedDate: esNA(b.updatedDate) ? null : parseCivilDate(b.updatedDate, "updatedDate"),
    validUntil: esNA(b.validUntil) ? null : parseCivilDate(b.validUntil, "validUntil"),
  };
}

// ── Carga manual en streaming ───────────────────────────────────────────────

export type ResultadoCarga = { id: string; versionId: string; estado: "Pendiente de aprobación"; origen: "manual"; nuevo: boolean };

function mapearErrorBase(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === "KB409") throw new ApiError(409, "IDENTIDAD_AMBIGUA", "El código y el enlace corresponden a documentos distintos. Revise antes de cargar.");
  if (code === "KB410") throw new ApiError(409, "CONTENIDO_REPETIDO", "Ese contenido ya está cargado para este documento.");
  throw error;
}

/**
 * Recibe `multipart/form-data`: primero la parte `metadata` (JSON), luego UN `file`. La metadata se
 * valida antes de abrir el archivo de staging: un dato inválido deja cero archivos y cero filas.
 * El formato se verifica por estructura, no por el MIME declarado.
 */
export function recibirCarga(req: Request, actor: string, db: pg.Pool = adminPool()): Promise<ResultadoCarga> {
  const lim = limitesCarga();
  return new Promise<ResultadoCarga>((resolve, reject) => {
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({ headers: req.headers, limits: { files: 1, fields: 1, parts: 3, fieldSize: lim.maxMetadata, fileSize: lim.maxArchivo } });
    } catch {
      reject(new ApiError(415, "VALIDACION", "El contenido debe ser multipart/form-data.", "file"));
      return;
    }
    let meta: MetadataCarga | undefined;
    let failure: unknown;
    let staging: string | undefined;
    let filePromise: Promise<void> | undefined;
    let size = 0;
    let truncated = false;
    let archivoVisto = false;
    const hash = createHash("sha256");

    const fail = (e: unknown) => { failure ??= e; };
    const limpiar = async () => { if (staging) await fs.promises.rm(staging, { force: true }).catch(() => {}); };

    bb.on("field", (name, value, info) => {
      if (archivoVisto) return fail(new ApiError(422, "VALIDACION", "La metadata debe enviarse antes del archivo.", "metadata"));
      if (name !== "metadata") return fail(new ApiError(422, "VALIDACION", "Parte no permitida.", name));
      if (meta) return fail(new ApiError(422, "VALIDACION", "La metadata solo puede enviarse una vez.", "metadata"));
      if (info.valueTruncated) return fail(new ApiError(413, "CUERPO_EXCESIVO", "La metadata supera el tamaño permitido.", "metadata"));
      try {
        meta = parseMetadataCarga(JSON.parse(value));
      } catch (error) {
        if (error instanceof SyntaxError) fail(new ApiError(422, "VALIDACION", "La metadata no es un JSON válido.", "metadata"));
        else fail(error);
      }
    });
    bb.on("file", (name, stream) => {
      archivoVisto = true;
      if (failure || name !== "file" || !meta) {
        if (!failure) fail(new ApiError(422, "VALIDACION", meta ? "Parte no permitida." : "Falta la metadata antes del archivo.", name === "file" ? "metadata" : name));
        stream.resume();
        return;
      }
      stream.on("limit", () => { truncated = true; });
      // La huella y el tamaño se calculan en la misma tubería que escribe el archivo: sin
      // «escuchar» el flujo aparte (eso lo pondría en marcha antes de conectar el destino).
      const medir = new Transform({
        transform(chunk: Buffer, _enc, cb) { size += chunk.length; hash.update(chunk); cb(null, chunk); },
      });
      staging = rutaStaging();
      fs.mkdirSync(dirStaging(), { recursive: true, mode: 0o700 });
      fs.mkdirSync(dirArchivos(), { recursive: true, mode: 0o700 });
      filePromise = pipeline(stream, medir, fs.createWriteStream(staging, { mode: 0o600 })).catch(fail);
    });
    bb.on("filesLimit", () => fail(new ApiError(422, "VALIDACION", "Solo se admite un archivo.", "file")));
    bb.on("partsLimit", () => fail(new ApiError(422, "VALIDACION", "La solicitud tiene partes de más.", "file")));
    bb.on("error", error => fail(error));

    bb.on("close", () => {
      void (async () => {
        try {
          await filePromise;
          if (failure) throw failure;
          if (!meta) throw new ApiError(422, "VALIDACION", "Falta la metadata.", "metadata");
          if (!staging) throw new ApiError(422, "VALIDACION", "Falta el archivo.", "file");
          if (truncated) throw new ApiError(413, "CUERPO_EXCESIVO", "El archivo supera el tamaño permitido.", "file");
          if (size === 0) throw new ApiError(422, "VALIDACION", "El archivo está vacío.", "file");
          const detectado = await detectarFormato(staging, lim.zip);
          if ("error" in detectado) throw new ApiError(422, "VALIDACION", detectado.error, "file");
          const ref = nuevaReferencia(detectado.formato);
          await fs.promises.rename(staging, resolverReferencia(ref));
          staging = undefined;
          const clave = meta.code ?? normalizarUrl(meta.publicUrl);
          let fila: { elemento_id: string; version_id: string; nuevo: boolean; archivo_reemplazado: string | null };
          try {
            const { rows } = await db.query(
              `SELECT * FROM kb.registrar_carga_manual($1,$2,$3,$4,$5::kb.tipo_elemento,$6::kb.direccion,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
              [actor, clave, meta.code, meta.title, TIPO_SQL[meta.type], DIR_SQL[meta.direction], meta.publicUrl, meta.version,
                meta.updatedDate, meta.validUntil, meta.associatedProcedure === "ninguno" ? [] : [meta.associatedProcedure],
                detectado.formato, hash.digest("hex"), ref, JSON.stringify(meta)]);
            fila = rows[0];
          } catch (error) {
            await eliminarArchivo(ref).catch(() => {});
            mapearErrorBase(error);
          }
          if (fila!.archivo_reemplazado) await eliminarArchivo(fila!.archivo_reemplazado).catch(() => {});
          await writeAudit(db, { actor, action: "documento.cargar", objectType: "documento", objectId: fila!.elemento_id, result: "ok" },
            new Date(adminClock.now()));
          resolve({ id: fila!.elemento_id, versionId: fila!.version_id, estado: "Pendiente de aprobación", origen: "manual", nuevo: fila!.nuevo });
        } catch (error) {
          await limpiar();
          reject(error);
        }
      })();
    });

    // Desconexión del cliente a mitad de carga: no queda temporal ni fila.
    req.once("aborted", () => { fail(new ApiError(499, "CANCELADA", "La carga se interrumpió.")); });
    req.pipe(bb);
  });
}

// ── Matriz ──────────────────────────────────────────────────────────────────

export type DocumentoDto = {
  id: string; revision: string; codigo: string; nombre: string; tipo: string; direccion: string; enlace: string;
  estado: string; version: string; fechaActualizacion: string; formatoOriginal: string; usoOcr: string; fechaCarga: string;
  procedimientoOrigen: string; origen: "manual" | "scraper"; autor: { id: string; nombre: string } | null;
  validoHasta: string; sinActualizacionAutomatica: boolean;
  candidata: { versionId: string; estadoTecnico: string; subidaEn: string | null; autor: { id: string; nombre: string } | null } | null;
};

export const ESTADOS_VISIBLES = ["Pendiente de aprobación", "Publicado", "Vencido", "Derogado"] as const;

async function nombresDeCuentas(db: pg.Pool, ids: Array<string | null>): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map();
  const { rows } = await db.query("SELECT id, display_name FROM admin.account WHERE id = ANY($1::uuid[])", [unicos]);
  return new Map(rows.map(r => [r.id as string, r.display_name as string]));
}

export async function listarDocumentos(
  actor: string, query: { mine?: unknown; state?: unknown; cursor?: unknown; limit: number; search?: unknown; id?: unknown; page?: unknown; order?: unknown }, db: pg.Pool = adminPool(),
): Promise<Page<DocumentoDto>> {
  const mine = query.mine === "true" || query.mine === true;
  let estado: string | null = null;
  if (query.state !== undefined && query.state !== "") estado = parseEnum(query.state, ESTADOS_VISIBLES, "state");
  const cur = decodeCursor(query.cursor);
  const search = query.search === undefined || query.search === "" ? "" : requiredText(query.search, "search", 300);
  const tokens = search.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/\s+/).filter(Boolean);
  const id = query.id ? parseUuid(query.id, "id") : null;
  if (query.page !== undefined && (typeof query.page !== "string" || !/^\d{1,6}$/.test(query.page))) throw new ValidationError("page", "La página no es válida.");
  const page = query.page === undefined ? null : Number(query.page);
  if (page !== null && (!Number.isSafeInteger(page) || page < 1 || page > 100000)) throw new ValidationError("page", "La página no es válida.");
  const orders: Record<string, string> = { recent: "fecha_carga_ts DESC, id DESC", name: "nombre ASC, id ASC", code: "codigo ASC, id ASC" };
  const order = query.order === undefined ? "recent" : parseEnum(query.order, ["recent", "name", "code"] as const, "order");
  const filtros = `($1::boolean = false OR autor_cuenta_id = $2 OR candidata_autor_cuenta_id = $2)
    AND ($3::text IS NULL OR estado = $3) AND ($5::uuid IS NULL OR id = $5)
    AND NOT EXISTS (SELECT 1 FROM unnest($4::text[]) AS t(token)
      WHERE strpos(translate(lower(concat_ws(' ', codigo, nombre, tipo, direccion, url_origen, estado, version,
        formato_original, procedimiento_origen, origen,
        CASE WHEN estado = 'Pendiente de aprobación' THEN 'por aprobar' END,
        (SELECT display_name FROM admin.account WHERE id = autor_cuenta_id))), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'), token) = 0)`;
  const params = [mine, actor, estado, tokens, id];
  const total = Number((await db.query(`SELECT count(*) FROM kb.v_matriz_admin WHERE ${filtros}`, params)).rows[0].count);
  const { rows } = await db.query(
    `SELECT *, fecha_carga_ts::text AS cursor_fecha FROM kb.v_matriz_admin WHERE ${filtros}
      AND ($6::timestamptz IS NULL OR (fecha_carga_ts, id) < ($6::timestamptz, $7::uuid))
      ORDER BY ${page === null ? orders.recent : orders[order]} LIMIT $8 OFFSET $9`,
    [...params, page === null && cur ? cur[0] : null, page === null && cur ? cur[1] : null, query.limit + 1, page === null ? 0 : (page - 1) * query.limit]);
  const pagina = rows.slice(0, query.limit);
  const nombres = await nombresDeCuentas(db, pagina.flatMap(r => [r.autor_cuenta_id, r.candidata_autor_cuenta_id]));
  const persona = (id: string | null) => (id ? { id, nombre: nombres.get(id) ?? "Cuenta eliminada" } : null);
  const items: DocumentoDto[] = pagina.map(r => ({
    id: r.id, revision: String(r.revision), codigo: r.codigo, nombre: r.nombre, tipo: r.tipo, direccion: r.direccion,
    enlace: r.url_origen, estado: r.estado, version: r.version, fechaActualizacion: r.fecha_actualizacion,
    formatoOriginal: r.formato_original, usoOcr: r.uso_ocr, fechaCarga: r.fecha_carga, procedimientoOrigen: r.procedimiento_origen,
    origen: r.origen, autor: persona(r.autor_cuenta_id), validoHasta: r.valido_hasta ?? "N/A",
    sinActualizacionAutomatica: r.sin_actualizacion_automatica,
    candidata: r.tiene_candidata ? {
      versionId: r.candidata_version_id, estadoTecnico: r.estado_candidata,
      subidaEn: r.candidata_subida_en ? new Date(r.candidata_subida_en).toISOString() : null,
      autor: persona(r.candidata_autor_cuenta_id),
    } : null,
  }));
  const ultimo = pagina[pagina.length - 1];
  return { items, total, nextCursor: page === null && rows.length > query.limit && ultimo ? encodeCursor([String(ultimo.cursor_fecha), ultimo.id]) : null };
}

// ── Comandos privilegiados (solo técnico; la ruta ya filtra el perfil) ──────────────────────────

type Elemento = {
  id: string; revision: string; tiene_vigente: boolean; tiene_candidata: boolean; estado_candidata: string | null;
  estado: string; codigo: string; nombre: string; url_origen: string;
};

async function cargarElemento(db: pg.Pool | pg.PoolClient, id: string): Promise<Elemento> {
  const { rows } = await db.query<Elemento>(
    `SELECT id, revision::text AS revision, tiene_vigente, tiene_candidata, estado_candidata, estado, codigo, nombre, url_origen
       FROM kb.v_matriz_admin WHERE id = $1`, [id]);
  if (!rows.length) throw new ApiError(404, "NO_ENCONTRADO", "El documento no existe.");
  return rows[0];
}

export type OperacionCreada = { operationId: string; estado: "En curso"; repetida: boolean };

/**
 * Inserta el comando con idempotencia ligada a usuario+clave: la misma clave con el mismo
 * contenido devuelve la misma operación; con otro contenido, 409.
 */
async function encolar(
  c: pg.PoolClient, actor: string, kind: string, elementoId: string | null, expectedRevision: string | null,
  payload: Record<string, unknown>, idempotencyKey: string | undefined, ruta: string,
  targetVersionId: string | null = null,
): Promise<{ id: string; repetida: boolean }> {
  const payloadHash = createHash("sha256").update(JSON.stringify({ ruta, kind, elementoId, expectedRevision, payload })).digest("hex");
  if (idempotencyKey) {
    const { rows } = await c.query("SELECT id, payload_hash FROM kb.document_operation WHERE actor_account_id = $1 AND idempotency_key = $2",
      [actor, idempotencyKey]);
    if (rows[0]) {
      if (rows[0].payload_hash !== payloadHash) throw new ApiError(409, "IDEMPOTENCIA_CONFLICTO", "La clave de idempotencia se usó con otro contenido.");
      return { id: rows[0].id, repetida: true };
    }
  }
  if (elementoId) {
    const activa = await c.query(
      "SELECT 1 FROM kb.document_operation WHERE element_id = $1 AND kind IN ('publish','replace','reject','withdraw') AND phase NOT IN ('complete','failed')", [elementoId]);
    if (activa.rowCount) throw new ApiError(409, "OPERACION_EN_CURSO", "Ya hay una operación en curso para este documento.");
  }
  try {
    const { rows } = await c.query(
      `INSERT INTO kb.document_operation (kind, actor_account_id, element_id, expected_revision, idempotency_key, payload_hash, payload, target_version_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
      [kind, actor, elementoId, expectedRevision, idempotencyKey ?? null, payloadHash, JSON.stringify(payload), targetVersionId]);
    return { id: rows[0].id, repetida: false };
  } catch (error) {
    if ((error as { code?: string }).code === "23505" && kind === "reindex") {
      throw new ApiError(409, "REINDEXACION_EN_CURSO", "Ya hay una reindexación en curso.");
    }
    throw error;
  }
}

function claveIdempotencia(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(raw)) throw new ValidationError("Idempotency-Key", "La clave de idempotencia no es válida.");
  return raw;
}

export async function publicarDocumento(
  actor: string, idRaw: unknown, body: unknown, key: string | undefined, db: pg.Pool = adminPool(),
): Promise<OperacionCreada> {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["expectedRevision"], ["expectedRevision"]);
  const expected = parseRevision(b.expectedRevision);
  const idem = claveIdempotencia(key);
  return adminTx(async c => {
    const e = await cargarElemento(c, id);
    if (e.revision !== expected) throw new ApiError(409, "REVISION_OBSOLETA", "El documento cambió. Recargue y vuelva a intentar.");
    if (!e.tiene_candidata) throw new ApiError(409, "SIN_CANDIDATA", "El documento no tiene una versión pendiente por publicar.");
    if (e.estado_candidata !== "procesado") {
      throw new ApiError(409, "NO_PUBLICABLE", e.estado_candidata === "en_cola"
        ? "El documento todavía se está procesando. Intente de nuevo en unos minutos."
        : "El documento no superó el procesamiento y no puede publicarse.");
    }
    // La operación queda atada a la versión que se aprueba ahora (NV-02): el commit la exige.
    const { rows: [objetivo] } = await c.query<{ v: string | null }>("SELECT kb.version_pendiente_de($1) AS v", [id]);
    if (!objetivo?.v) throw new ApiError(409, "SIN_CANDIDATA", "El documento no tiene una versión pendiente por publicar.");
    const op = await encolar(c, actor, e.tiene_vigente ? "replace" : "publish", id, expected, {}, idem, `publish:${id}`, objetivo.v);
    if (!op.repetida) await writeAudit(c, { actor, action: "documento.publicar", objectType: "documento", objectId: id, result: "ok" }, new Date(adminClock.now()));
    return { operationId: op.id, estado: "En curso" as const, repetida: op.repetida };
  }, db);
}

export async function rechazarDocumento(
  actor: string, idRaw: unknown, body: unknown, key: string | undefined, db: pg.Pool = adminPool(),
): Promise<OperacionCreada> {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["expectedRevision", "motivo"], ["expectedRevision", "motivo"]);
  const expected = parseRevision(b.expectedRevision);
  const motivo = requiredText(b.motivo, "motivo", 500);
  const idem = claveIdempotencia(key);
  return adminTx(async c => {
    const e = await cargarElemento(c, id);
    if (e.revision !== expected) throw new ApiError(409, "REVISION_OBSOLETA", "El documento cambió. Recargue y vuelva a intentar.");
    if (!e.tiene_candidata) throw new ApiError(409, "SIN_CANDIDATA", "El documento no tiene una versión pendiente. Para quitar uno publicado use «Retirar».");
    const op = await encolar(c, actor, "reject", id, expected, { motivo }, idem, `reject:${id}`);
    if (!op.repetida) await writeAudit(c, { actor, action: "documento.rechazar", objectType: "documento", objectId: id, result: "ok" }, new Date(adminClock.now()));
    return { operationId: op.id, estado: "En curso" as const, repetida: op.repetida };
  }, db);
}

export async function retirarDocumento(
  actor: string, idRaw: unknown, body: unknown, key: string | undefined, db: pg.Pool = adminPool(),
): Promise<OperacionCreada> {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["expectedRevision", "motivo", "confirmedDocumentId"], ["expectedRevision", "motivo", "confirmedDocumentId"]);
  const expected = parseRevision(b.expectedRevision);
  const motivo = requiredText(b.motivo, "motivo", 500);
  if (!isUuid(b.confirmedDocumentId) || String(b.confirmedDocumentId).toLowerCase() !== id) {
    throw new ValidationError("confirmedDocumentId", "La confirmación no coincide con el documento.");
  }
  const idem = claveIdempotencia(key);
  return adminTx(async c => {
    const e = await cargarElemento(c, id);
    if (e.revision !== expected) throw new ApiError(409, "REVISION_OBSOLETA", "El documento cambió. Recargue y vuelva a intentar.");
    if (!e.tiene_vigente) throw new ApiError(409, "SIN_VIGENTE", "El documento no está publicado. Para descartar uno pendiente use «Rechazar».");
    const op = await encolar(c, actor, "withdraw", id, expected, { motivo }, idem, `withdraw:${id}`);
    if (!op.repetida) await writeAudit(c, { actor, action: "documento.retirar", objectType: "documento", objectId: id, result: "ok" }, new Date(adminClock.now()));
    return { operationId: op.id, estado: "En curso" as const, repetida: op.repetida };
  }, db);
}

export async function reindexar(actor: string, body: unknown, key: string | undefined, db: pg.Pool = adminPool()): Promise<OperacionCreada> {
  strictObject(body ?? {}, []);
  const idem = claveIdempotencia(key);
  return adminTx(async c => {
    const op = await encolar(c, actor, "reindex", null, null, {}, idem, "reindex");
    if (!op.repetida) await writeAudit(c, { actor, action: "documento.reindexar", objectType: "base", objectId: op.id, result: "ok" }, new Date(adminClock.now()));
    return { operationId: op.id, estado: "En curso" as const, repetida: op.repetida };
  }, db);
}

// ── Edición de metadata ─────────────────────────────────────────────────────

const CAMPOS_EDITABLES = ["title", "type", "direction", "publicUrl", "associatedProcedure", "version", "updatedDate", "validUntil"] as const;

export async function editarMetadata(actor: string, idRaw: unknown, body: unknown, db: pg.Pool = adminPool()): Promise<{ revision: string }> {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["expectedRevision", "target", "changes"], ["expectedRevision", "changes"]);
  const expected = parseRevision(b.expectedRevision);
  const cambios = strictObject(b.changes, CAMPOS_EDITABLES);
  if (!Object.keys(cambios).length) throw new ValidationError("changes", "Indique al menos un cambio.");
  const sql: Record<string, unknown> = {};
  const candidatos: Record<string, unknown> = {};
  if ("title" in cambios) { sql.nombre = requiredText(cambios.title, "title", 300); candidatos.title = sql.nombre; }
  if ("type" in cambios) { const t = parseEnum(cambios.type, TIPOS, "type"); sql.tipo = TIPO_SQL[t]; candidatos.type = t; }
  if ("direction" in cambios) { const d = parseEnum(cambios.direction, DIRECCIONES, "direction"); sql.direccion = DIR_SQL[d]; candidatos.direction = d; }
  if ("publicUrl" in cambios) { sql.urlOrigen = parsePublicUrl(cambios.publicUrl, "publicUrl"); candidatos.publicUrl = sql.urlOrigen; }
  if ("associatedProcedure" in cambios) {
    const p = requiredText(cambios.associatedProcedure, "associatedProcedure", 40);
    const ninguno = p.toLowerCase() === "ninguno";
    if (!ninguno && !CODIGO_PROCEDIMIENTO.test(p.toUpperCase())) throw new ValidationError("associatedProcedure", "Indique un código de procedimiento válido o «ninguno».");
    sql.procedimientos = ninguno ? [] : [p.toUpperCase()];
    candidatos.associatedProcedure = ninguno ? "ninguno" : p.toUpperCase();
  }
  if ("version" in cambios) { sql.version = esNA(cambios.version) ? null : requiredText(cambios.version, "version", 40); candidatos.version = sql.version; }
  if ("updatedDate" in cambios) { sql.fechaActualizacion = esNA(cambios.updatedDate) ? null : parseCivilDate(cambios.updatedDate, "updatedDate"); candidatos.updatedDate = sql.fechaActualizacion; }
  if ("validUntil" in cambios) { sql.validoHasta = esNA(cambios.validUntil) ? null : parseCivilDate(cambios.validUntil, "validUntil"); candidatos.validUntil = sql.validoHasta; }

  return adminTx(async c => {
    const e = await cargarElemento(c, id);
    const target = b.target === undefined ? (e.tiene_vigente ? "vigente" : "candidata") : parseEnum(b.target, ["vigente", "candidata"] as const, "target");
    const destino = target === "candidata" && !e.tiene_candidata && !e.tiene_vigente ? "candidata" : target;
    try {
      const { rows } = await c.query(
        "SELECT kb.editar_metadata_documento($1,$2,$3,$4::jsonb,$5) AS revision",
        [id, expected, destino, JSON.stringify({ ...sql, candidatos }), actor]);
      await writeAudit(c, { actor, action: "documento.editar_metadata", objectType: "documento", objectId: id, result: "ok" }, new Date(adminClock.now()));
      return { revision: String(rows[0].revision) };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "KB412") throw new ApiError(409, "REVISION_OBSOLETA", "El documento cambió. Recargue y vuelva a intentar.");
      if (code === "KB404") throw new ApiError(404, "NO_ENCONTRADO", "El documento no existe.");
      if (code === "KB422") throw new ApiError(409, "DESTINO_NO_DISPONIBLE", "El documento no tiene esa versión para editar.");
      throw error;
    }
  }, db);
}

// ── Estado de una operación ─────────────────────────────────────────────────

export type OperacionDto = {
  id: string; tipo: string; estado: "En curso" | "Terminada" | "Fallida"; fase: string; inicio: string | null; fin: string | null;
  intentos: number; error: string | null; limpiezaPendiente: boolean;
  /** SPEC008: reintento programado, intentos de limpieza y si requiere atención del administrador. */
  proximoIntento: string | null; intentosLimpieza: number; requiereAtencion: boolean;
};

export async function obtenerOperacion(idRaw: unknown, db: pg.Pool = adminPool()): Promise<OperacionDto> {
  const id = parseUuid(idRaw, "id");
  const { rows } = await db.query("SELECT * FROM kb.document_operation WHERE id = $1", [id]);
  const r = rows[0];
  if (!r) throw new ApiError(404, "NO_ENCONTRADO", "La operación no existe.");
  return {
    id: r.id, tipo: r.kind, fase: r.phase,
    estado: r.phase === "complete" ? "Terminada" : r.phase === "failed" ? "Fallida" : "En curso",
    inicio: r.started_at ? new Date(r.started_at).toISOString() : null,
    fin: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    intentos: r.attempts, error: r.error_code ?? null, limpiezaPendiente: r.cleanup_pending,
    proximoIntento: r.next_attempt_at ? new Date(r.next_attempt_at).toISOString() : null,
    intentosLimpieza: r.cleanup_attempts ?? 0, requiereAtencion: r.needs_attention === true,
  };
}

/**
 * Reanuda de inmediato una operación en espera o que requiere atención (SPEC008, FR-008). No
 * cambia la operación ni su objetivo: solo quita la espera; el worker la toma en su siguiente ciclo.
 */
export async function reanudarOperacion(
  actor: string, idRaw: unknown, body: unknown, db: pg.Pool = adminPool(),
): Promise<{ id: string; estado: "En curso" }> {
  const id = parseUuid(idRaw, "id");
  strictObject(body ?? {}, []);
  return adminTx(async c => {
    const { rows: [o] } = await c.query("SELECT phase FROM kb.document_operation WHERE id = $1 FOR UPDATE", [id]);
    if (!o) throw new ApiError(404, "NO_ENCONTRADO", "La operación no existe.");
    if (o.phase === "complete" || o.phase === "failed") throw new ApiError(409, "OPERACION_TERMINADA", "La operación ya terminó.");
    await c.query("UPDATE kb.document_operation SET next_attempt_at = NULL, needs_attention = false WHERE id = $1", [id]);
    await writeAudit(c, { actor, action: "documento.reanudar_operacion", objectType: "operacion", objectId: id, result: "ok" }, new Date(adminClock.now()));
    return { id, estado: "En curso" as const };
  }, db);
}

/** Última operación de reindexación (estado/inicio/fin en la pantalla de estado, AD47). */
export async function ultimaReindexacion(db: pg.Pool = adminPool()): Promise<OperacionDto | null> {
  const { rows } = await db.query("SELECT id FROM kb.document_operation WHERE kind = 'reindex' ORDER BY created_at DESC LIMIT 1");
  return rows[0] ? obtenerOperacion(rows[0].id, db) : null;
}

/** Útil para pruebas y para el diagnóstico: fecha civil de Bogotá del reloj del panel. */
export const hoyBogota = (): string => bogotaDate(new Date(adminClock.now()));
