/**
 * Propuestas y enlaces del scraper (SPEC007 US3, RF-C3-AD-14..19, 33, 34).
 *
 * El panel no escribe en `kb`: toda mutación llama a una función SQL con la cuenta de la SESIÓN.
 * La lista de hosts nunca es editable (solo cambia con un despliegue); aquí solo se valida contra ella.
 */
import type pg from "pg";
import { adminPool, adminTx } from "./db.js";
import { writeAudit } from "./audit.js";
import { ApiError, decodeCursor, encodeCursor, type Page } from "./contracts.js";
import { adminClock } from "./sessions.js";
import { DIRECCIONES } from "./documents.js";
import { parseEnum, parseRevision, parseUuid, requiredText, strictObject, ValidationError } from "./validation.js";
import { validarUrlEnlace } from "../kb/managedLinks.js";

const DIR_SQL: Record<string, string> = {
  Ecosistemas: "ecosistemas", "Bienestar Animal": "bienestar_animal", "Gestión Ambiental": "gestion_ambiental", "Secretaría (general)": "secretaria_general",
};
const DIR_ETIQUETA: Record<string, string> = Object.fromEntries(Object.entries(DIR_SQL).map(([k, v]) => [v, k]));

export type PropuestaDto = {
  id: string; tipo: "add" | "remove"; url: string; direccion: string; justificacion: string; estado: string;
  creadaEn: string; propietario: { id: string; nombre: string | null } | null;
  decididaPor: string | null; decididaEn: string | null; motivoRechazo: string | null; revision: string;
};

const aDto = (r: Record<string, unknown>, verPropietario: boolean): PropuestaDto => ({
  id: r.id as string, tipo: r.type as "add" | "remove", url: r.url as string, direccion: DIR_ETIQUETA[r.direction as string] ?? String(r.direction),
  justificacion: r.justification as string, estado: r.state as string, creadaEn: new Date(r.created_at as string).toISOString(),
  propietario: verPropietario ? { id: r.owner_account_id as string, nombre: (r.owner_name as string | null) ?? null } : null,
  decididaPor: (r.decided_by_name as string | null) ?? null,
  decididaEn: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
  motivoRechazo: (r.rejection_reason as string | null) ?? null, revision: String(r.revision),
});

function mapear(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === "KB404") throw new ApiError(404, "NO_ENCONTRADO", "El elemento no existe o no está disponible.");
  if (code === "KB409") {
    const msg = (error as { message?: string }).message ?? "";
    throw new ApiError(409, /ya_vigente/.test(msg) ? "ENLACE_YA_VIGENTE" : /no_pendiente|ya_decidida/.test(msg) ? "ESTADO_NO_PENDIENTE" : "CONFLICTO",
      /ya_vigente/.test(msg) ? "El enlace ya está en la lista." : "La propuesta ya no está pendiente de validación.");
  }
  if (code === "KB412") throw new ApiError(409, "REVISION_OBSOLETA", "El elemento cambió. Recargue y vuelva a intentar.");
  if (code === "KB400") throw new ApiError(422, "VALIDACION", "El motivo es obligatorio para rechazar.", "motivo");
  throw error;
}

function validarEnlace(url: unknown, campo = "url"): { url: string; fuente: string } {
  const texto = requiredText(url, campo, 2048);
  const r = validarUrlEnlace(texto);
  if (!r.ok) throw new ValidationError(campo, r.motivo);
  return { url: r.url, fuente: r.fuente };
}

// ── Propuestas ──────────────────────────────────────────────────────────────

export async function crearPropuesta(actor: string, nombre: string, body: unknown, db: pg.Pool = adminPool()): Promise<PropuestaDto> {
  const b = strictObject(body, ["type", "url", "direction", "justification"], ["type", "url", "direction", "justification"]);
  const tipo = parseEnum(b.type, ["add", "remove"] as const, "type");
  const { url } = validarEnlace(b.url);
  const direccion = parseEnum(b.direction, DIRECCIONES, "direction");
  const justificacion = requiredText(b.justification, "justification", 1000);
  return adminTx(async c => {
    let id: string;
    try {
      id = (await c.query("SELECT kb.proponer_enlace($1,$2,$3,$4,$5::kb.direccion,$6) AS id",
        [actor, nombre, tipo, url, DIR_SQL[direccion], justificacion])).rows[0].id;
    } catch (error) { mapear(error); }
    await writeAudit(c, { actor, action: "propuesta.crear", objectType: "propuesta_enlace", objectId: id!, result: "ok" }, new Date(adminClock.now()));
    const { rows } = await c.query("SELECT * FROM kb.link_proposal WHERE id = $1", [id!]);
    return aDto(rows[0], true);
  }, db);
}

export async function listarPropuestas(
  actor: string, esTecnico: boolean, query: { state?: unknown; owner?: unknown; cursor?: unknown; limit: number }, db: pg.Pool = adminPool(),
): Promise<Page<PropuestaDto>> {
  const estado = query.state === undefined || query.state === "" ? null
    : parseEnum(query.state, ["Pendiente de validación", "Aprobada", "Rechazada", "Retirada"] as const, "state");
  // El Gestor solo ve las suyas; el técnico ve todas (y puede filtrar por propietario).
  const propietario = esTecnico ? (query.owner ? parseUuid(query.owner, "owner") : null) : actor;
  const cur = decodeCursor(query.cursor);
  const filtros = "($1::uuid IS NULL OR owner_account_id = $1) AND ($2::text IS NULL OR state = $2)";
  const total = Number((await db.query(`SELECT count(*) FROM kb.link_proposal WHERE ${filtros}`, [propietario, estado])).rows[0].count);
  const { rows } = await db.query(
    `SELECT * FROM kb.link_proposal WHERE ${filtros}
        AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
      ORDER BY created_at DESC, id DESC LIMIT $5`,
    [propietario, estado, cur ? cur[0] : null, cur ? cur[1] : null, query.limit + 1]);
  const pagina = rows.slice(0, query.limit);
  const ultimo = pagina[pagina.length - 1];
  return {
    items: pagina.map(r => aDto(r, esTecnico)), total,
    nextCursor: rows.length > query.limit && ultimo ? encodeCursor([new Date(ultimo.created_at).toISOString(), ultimo.id]) : null,
  };
}

export async function retirarPropuesta(actor: string, idRaw: unknown, body: unknown, db: pg.Pool = adminPool()): Promise<{ revision: string }> {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["expectedRevision"], ["expectedRevision"]);
  const revision = parseRevision(b.expectedRevision);
  return adminTx(async c => {
    let nueva: string;
    try {
      nueva = String((await c.query("SELECT kb.retirar_propuesta($1,$2,$3) AS r", [id, actor, revision])).rows[0].r);
    } catch (error) { mapear(error); }
    await writeAudit(c, { actor, action: "propuesta.retirar", objectType: "propuesta_enlace", objectId: id, result: "ok" }, new Date(adminClock.now()));
    return { revision: nueva! };
  }, db);
}

async function decidir(actor: string, nombre: string, idRaw: unknown, body: unknown, aprobar: boolean, db: pg.Pool) {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, aprobar ? ["expectedRevision"] : ["expectedRevision", "motivo"], aprobar ? ["expectedRevision"] : ["expectedRevision", "motivo"]);
  const revision = parseRevision(b.expectedRevision);
  const motivo = aprobar ? null : requiredText(b.motivo, "motivo", 1000);
  return adminTx(async c => {
    const p = (await c.query("SELECT url FROM kb.link_proposal WHERE id = $1", [id])).rows[0];
    if (!p) throw new ApiError(404, "NO_ENCONTRADO", "La propuesta no existe.");
    const v = validarUrlEnlace(p.url);
    const fuente = v.ok ? v.fuente : "envigado_com";
    let resultado: Record<string, unknown>;
    try {
      resultado = (await c.query("SELECT kb.decidir_propuesta($1,$2,$3,$4,$5,$6,$7) AS r", [id, actor, nombre, revision, aprobar, motivo, fuente])).rows[0].r;
    } catch (error) { mapear(error); }
    await writeAudit(c, { actor, action: aprobar ? "propuesta.aprobar" : "propuesta.rechazar", objectType: "propuesta_enlace", objectId: id, result: "ok" },
      new Date(adminClock.now()));
    const { rows } = await c.query("SELECT * FROM kb.link_proposal WHERE id = $1", [id]);
    return { propuesta: aDto(rows[0], true), efecto: resultado! };
  }, db);
}

export const aprobarPropuesta = (actor: string, nombre: string, id: unknown, body: unknown, db: pg.Pool = adminPool()) => decidir(actor, nombre, id, body, true, db);
export const rechazarPropuesta = (actor: string, nombre: string, id: unknown, body: unknown, db: pg.Pool = adminPool()) => decidir(actor, nombre, id, body, false, db);

// ── Enlaces vigentes ────────────────────────────────────────────────────────

export type EnlaceDto = { id: string; url: string; fuente: string; direccion: string; justificacion: string; revision: string; cambiadoPor: string | null; cambiadoEn: string };

export async function listarEnlaces(db: pg.Pool = adminPool()): Promise<{ items: EnlaceDto[]; listRevision: string }> {
  const { rows } = await db.query("SELECT * FROM kb.scraper_link WHERE active ORDER BY source, url");
  const lista = (await db.query("SELECT revision FROM kb.scraper_link_list")).rows[0];
  return {
    listRevision: String(lista?.revision ?? 1),
    items: rows.map(r => ({
      id: r.id, url: r.url, fuente: r.source, direccion: DIR_ETIQUETA[r.direction] ?? r.direction, justificacion: r.justification,
      revision: String(r.revision), cambiadoPor: r.changed_by_name ?? null, cambiadoEn: new Date(r.changed_at).toISOString(),
    })),
  };
}

export async function agregarEnlace(actor: string, nombre: string, body: unknown, db: pg.Pool = adminPool()): Promise<{ id: string; listVersion: string }> {
  const b = strictObject(body, ["url", "direction", "justification", "expectedListRevision"], ["url", "direction", "justification", "expectedListRevision"]);
  const { url, fuente } = validarEnlace(b.url);
  const direccion = parseEnum(b.direction, DIRECCIONES, "direction");
  const justificacion = requiredText(b.justification, "justification", 1000);
  const lista = parseRevision(b.expectedListRevision, "expectedListRevision");
  return adminTx(async c => {
    let r: { id: string; listVersion: number };
    try {
      r = (await c.query("SELECT kb.agregar_enlace_directo($1,$2,$3,$4,$5::kb.direccion,$6,$7) AS r",
        [actor, nombre, url, fuente, DIR_SQL[direccion], justificacion, lista])).rows[0].r;
    } catch (error) { mapear(error); }
    await writeAudit(c, { actor, action: "enlace.agregar", objectType: "enlace_scraper", objectId: r!.id, result: "ok" }, new Date(adminClock.now()));
    return { id: r!.id, listVersion: String(r!.listVersion) };
  }, db);
}

export async function quitarEnlace(actor: string, nombre: string, idRaw: unknown, body: unknown, db: pg.Pool = adminPool()) {
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["direction", "justification", "expectedRevision", "expectedListRevision"],
    ["direction", "justification", "expectedRevision", "expectedListRevision"]);
  parseEnum(b.direction, DIRECCIONES, "direction");
  const justificacion = requiredText(b.justification, "justification", 1000);
  const revision = parseRevision(b.expectedRevision);
  const lista = parseRevision(b.expectedListRevision, "expectedListRevision");
  return adminTx(async c => {
    let r: { listVersion: number; documents: Array<{ id: string; clave: string; nombre: string }> };
    try {
      r = (await c.query("SELECT kb.quitar_enlace_directo($1,$2,$3,$4,$5,$6) AS r", [actor, nombre, id, justificacion, revision, lista])).rows[0].r;
    } catch (error) { mapear(error); }
    await writeAudit(c, { actor, action: "enlace.quitar", objectType: "enlace_scraper", objectId: id, result: "ok" }, new Date(adminClock.now()));
    return { listVersion: String(r!.listVersion), documentosAfectados: r!.documents.length, documentos: r!.documents };
  }, db);
}
