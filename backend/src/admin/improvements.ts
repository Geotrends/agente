/**
 * Casos de mejora (SPEC007 US6, RF-C4-AD-03..05).
 *
 * Un caso por interacción autorizada elegible (sin información / No útil), creado por el registro
 * al confirmarse, sin copiar la pregunta: categoría, texto y motivo se leen por JOIN y desaparecen
 * con la purga. Estados estrictos, sin saltos ni retrocesos; el tipo de fallo (REAL, SPEC006) es
 * condición para «En ajuste», una nota para «Cerrada» y evidencia VERIFICABLE y posterior al ajuste
 * para «Validada». Cambiar un caso NO cierra hallazgos ni actas de SPEC006.
 */
import type pg from "pg";
import { adminPool, adminTx } from "./db.js";
import { writeAudit } from "./audit.js";
import { ApiError, decodeCursor, encodeCursor, type Page } from "./contracts.js";
import { adminClock } from "./sessions.js";
import { bogotaDayStartUtc, parseCivilDate, parseEnum, parseRevision, parseUuid, strictObject, ValidationError } from "./validation.js";
import { EvidenceError, parseEvidenceRefs, verifyEvidence, type EvidenceVerifier } from "./validationEvidence.js";
import { maskPersonalData } from "../services/pii.js";

export const ESTADOS_CASO = ["Registrada", "En análisis", "En ajuste", "Ajustada", "Validada", "Cerrada"] as const;
export const TIPOS_FALLO = ["Datos", "Recuperación", "Modelo"] as const;
const ORIGENES = ["sin información", "No útil"] as const;

export type CasoDto = {
  id: string; fecha: string; categoria: string | null; origenes: string[]; tipoFallo: string | null; estado: string;
  antiguedadDias: number; revision: string; hallazgoRef: string | null;
};
export type CasoDetalle = CasoDto & {
  pregunta: string | null; motivoValoracion: string | null; disponibilidad: "disponible" | "depurada";
  historial: Array<{ de: string; a: string; usuarioId: string; fecha: string; nota: string | null; tipoFallo: string | null; evidencias: unknown[] }>;
};

const SELECT = `
  SELECT c.id, c.created_at, c.created_at::text AS cursor_created_at, c.origins, c.failure_type, c.status, c.revision, c.finding_ref, i.category,
         GREATEST(0, (now() AT TIME ZONE 'America/Bogota')::date - (c.created_at AT TIME ZONE 'America/Bogota')::date) AS dias,
         (i.purged_at IS NOT NULL OR i.received_at + interval '12 months' <= now()) AS depurada,
         CASE WHEN i.purged_at IS NULL AND i.received_at + interval '12 months' > now() THEN i.question_text END AS question_text,
         v.motivo
    FROM admin.improvement_case c
    JOIN chat.interaction i ON i.row_id = c.interaction_row_id
    LEFT JOIN chat.valoracion v ON v.interaction_row_id = c.interaction_row_id`;

const aCaso = (r: Record<string, unknown>): CasoDto => ({
  id: r.id as string, fecha: new Date(r.created_at as string).toISOString(), categoria: (r.category as string | null) ?? null,
  origenes: r.origins as string[], tipoFallo: (r.failure_type as string | null) ?? null, estado: r.status as string,
  antiguedadDias: Number(r.dias), revision: String(r.revision), hallazgoRef: (r.finding_ref as string | null) ?? null,
});

export async function listarCasos(
  q: { estado?: unknown; tipoFallo?: unknown; desde?: unknown; hasta?: unknown; origen?: unknown; categoria?: unknown; cursor?: unknown; limit: number },
  db: pg.Pool = adminPool(),
): Promise<Page<CasoDto> & { abiertos: number }> {
  const estado = q.estado ? parseEnum(q.estado, ESTADOS_CASO, "estado") : null;
  const fallo = q.tipoFallo ? parseEnum(q.tipoFallo, TIPOS_FALLO, "tipoFallo") : null;
  const origen = q.origen ? parseEnum(q.origen, ORIGENES, "origen") : null;
  const categoria = q.categoria ? parseEnum(q.categoria, ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental"] as const, "categoria") : null;
  const desde = q.desde ? bogotaDayStartUtc(parseCivilDate(q.desde, "desde")) : null;
  const hasta = q.hasta ? new Date(bogotaDayStartUtc(parseCivilDate(q.hasta, "hasta")).getTime() + 86_400_000) : null;
  const cur = decodeCursor(q.cursor);
  const filtros = `($1::text IS NULL OR c.status = $1) AND ($2::text IS NULL OR c.failure_type = $2)
    AND ($3::timestamptz IS NULL OR c.created_at >= $3) AND ($4::timestamptz IS NULL OR c.created_at < $4)
    AND ($5::text IS NULL OR $5 = ANY(c.origins)) AND ($6::text IS NULL OR i.category = $6)`;
  const params = [estado, fallo, desde, hasta, origen, categoria];
  const base = `FROM admin.improvement_case c JOIN chat.interaction i ON i.row_id = c.interaction_row_id WHERE ${filtros}`;
  const total = Number((await db.query(`SELECT count(*) ${base}`, params)).rows[0].count);
  const abiertos = Number((await db.query("SELECT count(*) FROM admin.improvement_case WHERE status <> 'Cerrada'")).rows[0].count);
  const { rows } = await db.query(
    `${SELECT} WHERE ${filtros} AND ($7::timestamptz IS NULL OR (c.created_at, c.id) < ($7::timestamptz, $8::uuid))
      ORDER BY c.created_at DESC, c.id DESC LIMIT $9`, [...params, cur ? cur[0] : null, cur ? cur[1] : null, q.limit + 1]);
  const pagina = rows.slice(0, q.limit);
  const ultimo = pagina[pagina.length - 1];
  return {
    items: pagina.map(aCaso), total, abiertos,
    nextCursor: rows.length > q.limit && ultimo ? encodeCursor([String(ultimo.cursor_created_at), ultimo.id]) : null,
  };
}

export async function detalleCaso(idRaw: unknown, db: pg.Pool = adminPool()): Promise<CasoDetalle> {
  const id = parseUuid(idRaw, "id");
  const { rows } = await db.query(`${SELECT} WHERE c.id = $1`, [id]);
  if (!rows.length) throw new ApiError(404, "NO_ENCONTRADO", "El caso no existe.");
  const r = rows[0];
  const h = await db.query("SELECT * FROM admin.improvement_transition WHERE case_id = $1 ORDER BY at, id", [id]);
  return {
    ...aCaso(r), pregunta: r.question_text ?? null, motivoValoracion: r.motivo ?? null, disponibilidad: r.depurada ? "depurada" : "disponible",
    historial: h.rows.map(t => ({
      de: t.from_state, a: t.to_state, usuarioId: t.actor_account_id, fecha: new Date(t.at).toISOString(),
      nota: t.note, tipoFallo: t.failure_type, evidencias: t.evidence_refs,
    })),
  };
}

/** Nota saneada: sin caracteres de control, con datos personales enmascarados y acotada. */
function sanearNota(v: unknown, campo: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new ValidationError(campo, "La nota debe ser texto.");
  // eslint-disable-next-line no-control-regex
  const t = maskPersonalData(v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")).trim();
  if ([...t].length > 500) throw new ValidationError(campo, "La nota no puede superar 500 caracteres.");
  return t || null;
}

export async function transicionarCaso(
  actor: string, idRaw: unknown, body: unknown,
  opciones: { verificar?: EvidenceVerifier; db?: pg.Pool } = {},
): Promise<CasoDetalle> {
  const db = opciones.db ?? adminPool();
  const verificar = opciones.verificar ?? verifyEvidence;
  const id = parseUuid(idRaw, "id");
  const b = strictObject(body, ["expectedRevision", "to", "failureType", "note", "evidenceRefs", "findingRef"], ["expectedRevision", "to"]);
  const revision = parseRevision(b.expectedRevision);
  const a = parseEnum(b.to, ESTADOS_CASO, "to");
  const fallo = b.failureType === undefined ? null : parseEnum(b.failureType, TIPOS_FALLO, "failureType");
  const nota = sanearNota(b.note, "note");
  const hallazgo = b.findingRef === undefined ? undefined : typeof b.findingRef === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(b.findingRef)
    ? b.findingRef : (() => { throw new ValidationError("findingRef", "La referencia al hallazgo no es válida."); })();
  const at = new Date(adminClock.now());

  await adminTx(async c => {
    const { rows } = await c.query("SELECT * FROM admin.improvement_case WHERE id = $1 FOR UPDATE", [id]);
    const caso = rows[0];
    if (!caso) throw new ApiError(404, "NO_ENCONTRADO", "El caso no existe.");
    if (String(caso.revision) !== revision) throw new ApiError(409, "REVISION_OBSOLETA", "El caso cambió. Recargue y vuelva a intentar.");
    const i = ESTADOS_CASO.indexOf(caso.status);
    if (ESTADOS_CASO[i + 1] !== a) {
      throw new ApiError(409, "TRANSICION_INVALIDA", `Desde «${caso.status}» solo se puede pasar a «${ESTADOS_CASO[i + 1] ?? "ningún estado"}»: no se admiten saltos ni retrocesos.`, "to");
    }
    const tipo = fallo ?? caso.failure_type;
    if (a === "En ajuste" && !tipo) throw new ApiError(422, "VALIDACION", "El tipo de fallo (Datos, Recuperación o Modelo) es obligatorio para pasar a «En ajuste».", "failureType");
    if (a === "Cerrada" && !nota) throw new ApiError(422, "VALIDACION", "La nota es obligatoria para cerrar el caso.", "note");

    let evidencias: unknown[] = [];
    if (a === "Validada" || a === "Cerrada") {
      const previa = (await c.query(
        "SELECT evidence_refs, at FROM admin.improvement_transition WHERE case_id = $1 AND to_state = 'Validada' ORDER BY at DESC LIMIT 1", [id])).rows[0];
      const ajustada = (await c.query(
        "SELECT at FROM admin.improvement_transition WHERE case_id = $1 AND to_state = 'Ajustada' ORDER BY at DESC LIMIT 1", [id])).rows[0];
      if (a === "Cerrada" && b.evidenceRefs === undefined) {
        // Cerrada hereda la evidencia verificada de «Validada».
        if (!previa || !Array.isArray(previa.evidence_refs) || !previa.evidence_refs.length) {
          throw new ApiError(422, "VALIDACION", "El cierre requiere la evidencia de validación verificada.", "evidenceRefs");
        }
        evidencias = previa.evidence_refs;
      } else {
        try {
          const refs = parseEvidenceRefs(b.evidenceRefs);
          evidencias = await verificar(refs, ajustada ? new Date(ajustada.at) : new Date(0));
        } catch (error) {
          if (error instanceof EvidenceError) throw new ApiError(422, "EVIDENCIA_INVALIDA", error.message, "evidenceRefs");
          throw error;
        }
      }
    }
    await c.query(
      `UPDATE admin.improvement_case SET status = $2, failure_type = COALESCE($3, failure_type), finding_ref = COALESCE($4, finding_ref),
              revision = revision + 1, updated_at = $5 WHERE id = $1`, [id, a, a === "En ajuste" || fallo ? tipo : null, hallazgo ?? null, at]);
    await c.query(
      `INSERT INTO admin.improvement_transition (case_id, from_state, to_state, actor_account_id, at, note, failure_type, evidence_refs, revision_from, revision_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [id, caso.status, a, actor, at, nota, tipo ?? null, JSON.stringify(evidencias), caso.revision, Number(caso.revision) + 1]);
    await writeAudit(c, { actor, action: "mejora.transicion", objectType: "caso_mejora", objectId: id, result: "ok" }, at);
  }, db);
  return detalleCaso(id, db);
}
