/**
 * Bandeja de avisos, contadores, pendientes y auditoría del panel (SPEC007 US5, RF-C3-AD-28..31, 40, 41).
 *
 * Una sola unión SQL autorizada (avisos de operación `admin.notification` + de la base de
 * conocimiento `kb.kb_notificacion`) con identificadores con espacio de nombres («adm:», «kb:»).
 * El técnico ve todo; el Gestor únicamente los avisos de carga de rechazo/OCR/indexación cuyo
 * propietario VERIFICADO es su cuenta. El mismo predicado se usa para listar, contar y revisar:
 * nunca se acepta un propietario enviado por el cliente.
 */
import type pg from "pg";
import { adminPool, adminTx } from "./db.js";
import { writeAudit } from "./audit.js";
import { ApiError, decodeCursor, encodeCursor, type Page } from "./contracts.js";
import { adminClock } from "./sessions.js";
import { operations } from "./operations.js";
import { bogotaDayStartUtc, parseCivilDate } from "./validation.js";

export type Viewer = { accountId: string; perfil: "administrador técnico" | "Gestor documental" };
const esTecnico = (v: Viewer) => v.perfil === "administrador técnico";

/** Tipos de aviso de carga que un Gestor puede ver cuando son suyos (rechazo, OCR, indexación). */
export const TIPOS_DE_CARGA_DEL_GESTOR = [
  "carga_rechazada", "formato_con_datos_personales", "descarte_ocr", "texto_nativo_ilegible", "indexacion_fallida",
] as const;

export type AvisoDto = {
  id: string; origen: "operacion" | "kb"; type: string; description: string; state: "no_revisada" | "revisada";
  firstAt: string; lastAt: string; repetitions: number; reviewedBy: string | null; reviewedAt: string | null;
  scope: "sistema" | "carga"; revision: string; objectId: string | null;
};

const UNION = `
  SELECT 'adm:' || id::text AS id, 'operacion'::text AS origen, type, safe_description AS description, state,
         first_at, last_at, repetitions, reviewed_by::text AS reviewed_by, reviewed_at, scope, owner_account_id AS owner,
         revision, object_id
    FROM admin.notification
  UNION ALL
  SELECT 'kb:' || id::text, 'kb', tipo::text, descripcion, estado::text, primera_en, ultima_en, repeticiones,
         revisada_por, revisada_en, alcance, propietario_cuenta, revision, objeto
    FROM kb.kb_notificacion`;

/** Predicado de visibilidad: parametrizado ($1 = técnico, $2 = cuenta de la sesión, $3 = tipos del Gestor). */
const VISIBLE = `($1::boolean OR (n.scope = 'carga' AND n.owner = $2::uuid AND n.type = ANY($3::text[])))`;

const toDto = (r: Record<string, unknown>): AvisoDto => ({
  id: r.id as string, origen: r.origen as "operacion" | "kb", type: r.type as string, description: r.description as string,
  state: r.state as "no_revisada" | "revisada", firstAt: new Date(r.first_at as string).toISOString(),
  lastAt: new Date(r.last_at as string).toISOString(), repetitions: Number(r.repetitions), reviewedBy: (r.reviewed_by as string | null) ?? null,
  reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as string).toISOString() : null, scope: r.scope as "sistema" | "carga",
  revision: String(r.revision), objectId: (r.object_id as string | null) ?? null,
});

export async function listarAvisos(
  v: Viewer, q: { estado?: unknown; cursor?: unknown; limit: number }, db: pg.Pool = adminPool(),
): Promise<Page<AvisoDto> & { noRevisadas: number }> {
  const estado = q.estado === "todas" ? "todas" : "no_revisada";
  const cur = decodeCursor(q.cursor);
  const params = [esTecnico(v), v.accountId, TIPOS_DE_CARGA_DEL_GESTOR as unknown as string[]];
  const filtroEstado = estado === "todas" ? "TRUE" : "n.state = 'no_revisada'";
  const total = Number((await db.query(`SELECT count(*) FROM (${UNION}) n WHERE ${VISIBLE} AND ${filtroEstado}`, params)).rows[0].count);
  const { rows } = await db.query(
    `SELECT *, n.last_at::text AS cursor_last_at FROM (${UNION}) n WHERE ${VISIBLE} AND ${filtroEstado}
        AND ($4::timestamptz IS NULL OR (n.last_at, n.id) < ($4::timestamptz, $5::text))
      ORDER BY n.last_at DESC, n.id DESC LIMIT $6`,
    [...params, cur ? cur[0] : null, cur ? cur[1] : null, q.limit + 1]);
  const pagina = rows.slice(0, q.limit);
  let items = pagina.map(toDto);
  // Avisos que no se pudieron guardar (base lenta o caída un instante): el técnico los ve ya.
  if (esTecnico(v) && !cur) {
    const vol = (await operations.list(estado)).avisos.filter(a => a.id.startsWith("volatil-"));
    items = [...vol.map(a => ({ id: a.id, origen: "operacion" as const, type: a.type, description: a.description, state: a.state, firstAt: a.firstAt,
      lastAt: a.lastAt, repetitions: a.repetitions, reviewedBy: null, reviewedAt: null, scope: "sistema" as const, revision: "1", objectId: null })), ...items];
  }
  const ultimo = pagina[pagina.length - 1];
  return {
    items, total, noRevisadas: await contarAvisos(v, db),
    nextCursor: rows.length > q.limit && ultimo ? encodeCursor([String(ultimo.cursor_last_at), ultimo.id]) : null,
  };
}

/** Cantidad de FILAS sin revisar (no suma repeticiones). */
export async function contarAvisos(v: Viewer, db: pg.Pool = adminPool()): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*) FROM (${UNION}) n WHERE ${VISIBLE} AND n.state = 'no_revisada'`,
    [esTecnico(v), v.accountId, TIPOS_DE_CARGA_DEL_GESTOR]);
  return Number(rows[0].count);
}

const ID_RE = /^(?:(adm|kb):)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Revisa un aviso UNA vez, con actor y fecha. 404 si no existe o no es visible para esa persona. */
export async function revisarAviso(v: Viewer, rawId: string, expectedRevision?: unknown, db: pg.Pool = adminPool()): Promise<{ noRevisadas: number }> {
  const m = ID_RE.exec(rawId);
  if (!m) throw new ApiError(404, "NO_ENCONTRADO", "El aviso no existe.");
  const [, ns, uuid] = m;
  const expected = expectedRevision === undefined ? null : /^[1-9][0-9]{0,18}$/.test(String(expectedRevision)) ? String(expectedRevision)
    : (() => { throw new ApiError(422, "VALIDACION", "La revisión no es válida.", "expectedRevision"); })();
  const at = new Date(adminClock.now());
  await adminTx(async c => {
    const tablas = ns === "kb" ? ["kb"] : ns === "adm" ? ["adm"] : ["adm", "kb"]; // sin espacio de nombres: legado
    for (const t of tablas) {
      const vis = t === "adm"
        ? `AND ($3::boolean OR (scope = 'carga' AND owner_account_id = $4::uuid AND type = ANY($5::text[])))`
        : `AND ($3::boolean OR (alcance = 'carga' AND propietario_cuenta = $4::uuid AND tipo::text = ANY($5::text[])))`;
      const base = t === "adm"
        ? `UPDATE admin.notification SET state = 'revisada', reviewed_by = $6, reviewed_at = $7, revision = revision + 1
            WHERE id = $1 AND ($2::bigint IS NULL OR revision = $2) AND state = 'no_revisada' ${vis} RETURNING id`
        : `UPDATE kb.kb_notificacion SET estado = 'revisada', revisada_por = $6::text, revisada_en = $7, revision = revision + 1
            WHERE id = $1 AND ($2::bigint IS NULL OR revision = $2) AND estado = 'no_revisada' ${vis} RETURNING id`;
      const r = await c.query(base, [uuid, expected, esTecnico(v), v.accountId, TIPOS_DE_CARGA_DEL_GESTOR, v.accountId, at]);
      if (r.rowCount) {
        await writeAudit(c, { actor: v.accountId, action: "aviso.revisar", objectType: "notificacion", objectId: `${t === "adm" ? "adm" : "kb"}:${uuid}`, result: "ok" }, at);
        return;
      }
    }
    // ¿Existe y es visible pero ya estaba revisada, o la revisión es obsoleta?
    const existe = await c.query(`SELECT n.state, n.revision FROM (${UNION}) n WHERE right(n.id, 36) = $4::text AND ${VISIBLE}`,
      [esTecnico(v), v.accountId, TIPOS_DE_CARGA_DEL_GESTOR, uuid.toLowerCase()]);
    if (!existe.rowCount) throw new ApiError(404, "NO_ENCONTRADO", "El aviso no existe.");
    if (existe.rows[0].state === "revisada") throw new ApiError(409, "YA_REVISADA", "El aviso ya estaba revisado.");
    throw new ApiError(409, "REVISION_OBSOLETA", "El aviso cambió. Recargue y vuelva a intentar.");
  }, db);
  return { noRevisadas: await contarAvisos(v, db) };
}

/**
 * Revisa de una vez TODOS los avisos sin revisar que esa persona puede ver (mismo predicado que
 * listar y contar). Cada aviso queda con actor y fecha y con su propia entrada de auditoría.
 * Los avisos volátiles (aún no guardados) no se pueden revisar y se quedan como están.
 */
export async function revisarTodosLosAvisos(v: Viewer, db: pg.Pool = adminPool()): Promise<{ revisados: number; noRevisadas: number }> {
  const at = new Date(adminClock.now());
  let revisados = 0;
  await adminTx(async c => {
    const params = [esTecnico(v), v.accountId, TIPOS_DE_CARGA_DEL_GESTOR, at];
    const adm = await c.query(
      `WITH r AS (
         UPDATE admin.notification SET state = 'revisada', reviewed_by = $2::uuid, reviewed_at = $4, revision = revision + 1
          WHERE state = 'no_revisada' AND ($1::boolean OR (scope = 'carga' AND owner_account_id = $2::uuid AND type = ANY($3::text[])))
          RETURNING id)
       INSERT INTO admin.audit (actor_account_id, action, object_type, object_id, result, occurred_at)
       SELECT $2::uuid, 'aviso.revisar', 'notificacion', 'adm:' || r.id::text, 'ok', $4 FROM r`, params);
    const kb = await c.query(
      `WITH r AS (
         UPDATE kb.kb_notificacion SET estado = 'revisada', revisada_por = $2::text, revisada_en = $4, revision = revision + 1
          WHERE estado = 'no_revisada' AND ($1::boolean OR (alcance = 'carga' AND propietario_cuenta = $2::uuid AND tipo::text = ANY($3::text[])))
          RETURNING id)
       INSERT INTO admin.audit (actor_account_id, action, object_type, object_id, result, occurred_at)
       SELECT $2::uuid, 'aviso.revisar', 'notificacion', 'kb:' || r.id::text, 'ok', $4 FROM r`, params);
    revisados = (adm.rowCount ?? 0) + (kb.rowCount ?? 0);
  }, db);
  return { revisados, noRevisadas: await contarAvisos(v, db) };
}

// ── Contadores ──────────────────────────────────────────────────────────────

export type Contadores = { notifications: number; pending?: number; openImprovements?: number };

export async function contadores(v: Viewer, db: pg.Pool = adminPool()): Promise<Contadores> {
  const out: Contadores = { notifications: await contarAvisos(v, db) };
  if (esTecnico(v)) {
    out.pending = (await listarPendientes({ limit: 1 }, db)).total;
    const hay = (await db.query("SELECT to_regclass('admin.improvement_case') AS t")).rows[0].t;
    out.openImprovements = hay
      ? Number((await db.query("SELECT count(*) FROM admin.improvement_case WHERE status <> 'Cerrada'")).rows[0].count) : 0;
  }
  return out;
}

// ── Pendientes por validar (documentos + propuestas) ────────────────────────

export type PendienteDto = { tipo: "documento" | "propuesta"; id: string; nombre: string; origen: string; fecha: string; dias: number };

export async function listarPendientes(q: { limit: number; cursor?: unknown }, db: pg.Pool = adminPool()): Promise<Page<PendienteDto>> {
  const cur = decodeCursor(q.cursor);
  const fuente = `
    SELECT 'documento'::text AS tipo, m.id::text AS id, m.nombre AS nombre, m.origen::text AS origen,
           COALESCE(m.candidata_subida_en, m.fecha_carga_ts) AS fecha
      FROM kb.v_matriz_admin m WHERE m.estado = 'Pendiente de aprobación' OR m.tiene_candidata
    UNION ALL
    SELECT 'propuesta', p.id::text, p.url, CASE p.type WHEN 'add' THEN 'propuesta: agregar' ELSE 'propuesta: quitar' END, p.created_at
      FROM kb.link_proposal p WHERE p.state = 'Pendiente de validación'`;
  const total = Number((await db.query(`SELECT count(*) FROM (${fuente}) x`)).rows[0].count);
  const { rows } = await db.query(
    `SELECT x.*, x.fecha::text AS cursor_fecha, GREATEST(0, (now() AT TIME ZONE 'America/Bogota')::date - (x.fecha AT TIME ZONE 'America/Bogota')::date) AS dias
       FROM (${fuente}) x
      WHERE ($1::timestamptz IS NULL OR (x.fecha, x.id) > ($1::timestamptz, $2::text))
      ORDER BY x.fecha ASC, x.id ASC LIMIT $3`, [cur ? cur[0] : null, cur ? cur[1] : null, q.limit + 1]);
  const pagina = rows.slice(0, q.limit);
  const ultimo = pagina[pagina.length - 1];
  return {
    items: pagina.map(r => ({ tipo: r.tipo, id: r.id, nombre: r.nombre, origen: r.origen, fecha: new Date(r.fecha).toISOString(), dias: Number(r.dias) })),
    total, nextCursor: rows.length > q.limit && ultimo ? encodeCursor([String(ultimo.cursor_fecha), ultimo.id]) : null,
  };
}

// ── Auditoría (solo lectura) ────────────────────────────────────────────────

export type AuditoriaDto = { id: string; actor: { id: string | null; nombre: string | null; rol: string | null }; accion: string; objeto: string; objetoId: string | null; resultado: string; fecha: string };

export async function listarAuditoria(
  q: { usuario?: unknown; accion?: unknown; desde?: unknown; hasta?: unknown; cursor?: unknown; limit: number }, db: pg.Pool = adminPool(),
): Promise<Page<AuditoriaDto>> {
  const usuario = typeof q.usuario === "string" && q.usuario.trim() ? q.usuario.trim() : null;
  const accion = typeof q.accion === "string" && q.accion.trim() ? q.accion.trim() : null;
  const desde = q.desde ? bogotaDayStartUtc(parseCivilDate(q.desde, "desde")) : null;
  const hasta = q.hasta ? new Date(bogotaDayStartUtc(parseCivilDate(q.hasta, "hasta")).getTime() + 86_400_000) : null; // [desde, hasta+1día)
  const cur = decodeCursor(q.cursor);
  const fuente = `
    SELECT 'adm:' || a.id::text AS id, a.actor_account_id::text AS actor_id, a.actor_db_role AS actor_role, a.action,
           a.object_type, a.object_id, a.result, a.occurred_at AS fecha FROM admin.audit a
    UNION ALL
    SELECT 'kb:' || k.id::text, CASE WHEN k.actor LIKE 'cuenta:%' THEN substr(k.actor, 8) END,
           CASE WHEN k.actor NOT LIKE 'cuenta:%' THEN k.actor END, k.accion, 'kb', k.objeto, k.resultado, k.fecha FROM kb.kb_auditoria k`;
  const filtros = `($1::text IS NULL OR x.actor_id = $1 OR x.actor_role = $1)
                   AND ($2::text IS NULL OR x.action = $2 OR x.action LIKE $2 || '.%')
                   AND ($3::timestamptz IS NULL OR x.fecha >= $3) AND ($4::timestamptz IS NULL OR x.fecha < $4)`;
  const params = [usuario, accion, desde, hasta];
  const total = Number((await db.query(`SELECT count(*) FROM (${fuente}) x WHERE ${filtros}`, params)).rows[0].count);
  const { rows } = await db.query(
    `SELECT x.*, x.fecha::text AS cursor_fecha, c.display_name FROM (${fuente}) x LEFT JOIN admin.account c ON c.id::text = x.actor_id
      WHERE ${filtros} AND ($5::timestamptz IS NULL OR (x.fecha, x.id) < ($5::timestamptz, $6::text))
      ORDER BY x.fecha DESC, x.id DESC LIMIT $7`,
    [...params, cur ? cur[0] : null, cur ? cur[1] : null, q.limit + 1]);
  const pagina = rows.slice(0, q.limit);
  const ultimo = pagina[pagina.length - 1];
  return {
    items: pagina.map(r => ({
      id: r.id, actor: { id: r.actor_id, nombre: r.display_name ?? null, rol: r.actor_role },
      accion: r.action, objeto: r.object_type, objetoId: r.object_id, resultado: r.result, fecha: new Date(r.fecha).toISOString(),
    })),
    total, nextCursor: rows.length > q.limit && ultimo ? encodeCursor([String(ultimo.cursor_fecha), ultimo.id]) : null,
  };
}

