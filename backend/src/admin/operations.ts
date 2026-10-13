/**
 * Estado operativo y avisos del panel (RF-C3-AD-28/29/30/48, RF-C3-DI-06).
 *
 * El estado de modelos, reranker y registro es OBSERVADO: se actualiza con eventos reales
 * del runtime (una consulta que usó el modelo, una escritura que falló), nunca por «hay
 * credencial». Mientras no haya evento, el componente figura «no comprobado». Todo vive
 * primero en memoria —lo ve el panel aunque la base esté caída— y se persiste cuando se
 * puede, sin texto de consultas. Los avisos se agrupan por tipo+objeto mientras estén sin
 * revisar; revisar conserva la fila y la siguiente ocurrencia abre otra.
 */
import type pg from "pg";
import { adminPool } from "./db.js";
import { writeAudit } from "./audit.js";
import { adminTx } from "./db.js";
import { adminClock } from "./sessions.js";

export const COMPONENTS = ["gpt-oss-20b", "gpt-oss-120b", "reranker", "registro", "scraper"] as const;
export type Component = (typeof COMPONENTS)[number];
export type ComponentStatus = "normal" | "degradado" | "no comprobado";

/** Ocho tipos de aviso de operación (los de la KB se suman al listar). */
export const NOTIFICATION_TYPES = [
  "modelo_no_disponible", "doble_fallo_modelos", "reranker_degradado", "registro_no_disponible",
  "cuenta_bloqueada", "calibracion_pendiente", "publicacion_fallida", "tarifa_faltante",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type ObjectType = "componente" | "cuenta" | "documento";

export type ComponentState = {
  component: Component;
  status: ComponentStatus;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  thresholdApplied?: boolean;
  safeReason?: string;
};

export type NotificationView = {
  id: string;
  origen: "operacion" | "kb";
  type: string;
  description: string;
  state: "no_revisada" | "revisada";
  firstAt: string;
  lastAt: string;
  repetitions: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

type Pending = { type: string; objectType: ObjectType; objectId: string; description: string; at: number };

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export class Operations {
  private state = new Map<Component, { status: ComponentStatus; ok: number | null; fail: number | null; threshold?: boolean; reason?: string }>();
  /** Avisos que no se pudieron guardar (base caída): se muestran y se persisten al volver. */
  private volatile: Array<Pending & { id: string; repetitions: number; firstAt: number }> = [];

  constructor(private readonly db: () => pg.Pool = adminPool) {
    for (const c of COMPONENTS) this.state.set(c, { status: "no comprobado", ok: null, fail: null });
  }

  reset(): void {
    for (const c of COMPONENTS) this.state.set(c, { status: "no comprobado", ok: null, fail: null });
    this.volatile = [];
    this.hydrated = false;
  }

  /** Evento real de un componente. Persistencia de mejor esfuerzo. */
  async reportComponent(c: Component, ok: boolean, opts: { degraded?: boolean; reason?: string; thresholdApplied?: boolean } = {}): Promise<void> {
    const now = adminClock.now();
    const prev = this.state.get(c)!;
    const status: ComponentStatus = !ok || opts.degraded ? "degradado" : "normal";
    this.state.set(c, {
      status, ok: ok ? now : prev.ok, fail: ok ? prev.fail : now,
      threshold: c === "reranker" ? opts.thresholdApplied ?? (ok && !opts.degraded) : undefined,
      reason: ok && !opts.degraded ? undefined : opts.reason,
    });
    await this.persistComponent(c).catch(() => { /* la base caída no impide ver el estado */ });
    await this.flushVolatile().catch(() => {});
  }

  private async persistComponent(c: Component): Promise<void> {
    const s = this.state.get(c)!;
    await this.db().query(
      `INSERT INTO admin.component_status (component, status, last_success_at, last_failure_at, updated_at, threshold_applied, safe_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (component) DO UPDATE SET status = EXCLUDED.status, last_success_at = EXCLUDED.last_success_at,
         last_failure_at = EXCLUDED.last_failure_at, updated_at = EXCLUDED.updated_at, threshold_applied = EXCLUDED.threshold_applied, safe_reason = EXCLUDED.safe_reason`,
      [c, s.status, iso(s.ok), iso(s.fail), new Date(adminClock.now()), s.threshold ?? null, s.reason ?? null]);
  }

  /**
   * Abre o repite un aviso. Si la base falla, queda en memoria para mostrarlo ya y guardarlo
   * después (sin ningún texto de consulta: solo tipo, objeto y descripción segura).
   */
  async notify(type: string, objectType: ObjectType, objectId: string, description: string): Promise<void> {
    const at = adminClock.now();
    try {
      await this.upsert({ type, objectType, objectId, description, at });
    } catch {
      const same = this.volatile.find(v => v.type === type && v.objectType === objectType && v.objectId === objectId);
      if (same) { same.repetitions++; same.at = at; }
      else this.volatile.push({ id: `volatil-${at}-${this.volatile.length}`, type, objectType, objectId, description, at, repetitions: 1, firstAt: at });
    }
  }

  private async upsert(p: Pending, repetitions = 1, firstAt = p.at): Promise<void> {
    await this.db().query(
      `INSERT INTO admin.notification (type, object_type, object_id, safe_description, first_at, last_at, repetitions)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (type, object_type, object_id, scope, owner_key) WHERE state = 'no_revisada'
       DO UPDATE SET last_at = EXCLUDED.last_at, repetitions = admin.notification.repetitions + EXCLUDED.repetitions,
                     revision = admin.notification.revision + 1`,
      [p.type, p.objectType, p.objectId, p.description, new Date(firstAt), new Date(p.at), repetitions]);
  }

  private flushing: Promise<void> | undefined;

  /**
   * Drena los avisos en memoria hacia la base. Está SERIALIZADO: dos llamadas simultáneas (p. ej.
   * dos eventos de componente al volver la base) comparten un solo drenaje, de modo que ningún
   * aviso se escribe dos ni se descarta sin persistir.
   */
  flushVolatile(): Promise<void> {
    if (this.flushing) return this.flushing;
    const p = (async () => {
      while (this.volatile.length) {
        const v = this.volatile[0];
        const escritas = v.repetitions;
        await this.upsert(v, escritas, v.firstAt);
        // Las repeticiones que llegaron mientras se escribía quedan para la siguiente vuelta:
        // ni se pierden ni se escriben dos veces.
        v.repetitions -= escritas;
        if (v.repetitions <= 0) {
          const i = this.volatile.indexOf(v);
          if (i >= 0) this.volatile.splice(i, 1);
        }
      }
    })();
    this.flushing = p;
    const done = () => { if (this.flushing === p) this.flushing = undefined; };
    p.then(done, done);
    return p;
  }

  private hydrated = false;

  /**
   * Hidrata el estado observado desde la base al reiniciar el proceso (SPEC007 AD48): un fallo
   * persistido antes del reinicio no puede volver a verse «no comprobado»/normal. No pisa lo
   * observado en memoria: solo completa los componentes sin evidencia local.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      const { rows } = await this.db().query(
        "SELECT component, status, last_success_at, last_failure_at, threshold_applied, safe_reason FROM admin.component_status");
      for (const r of rows) {
        const actual = this.state.get(r.component as Component);
        if (!actual || actual.ok !== null || actual.fail !== null) continue;
        this.state.set(r.component as Component, {
          status: r.status, ok: r.last_success_at ? new Date(r.last_success_at).getTime() : null,
          fail: r.last_failure_at ? new Date(r.last_failure_at).getTime() : null,
          threshold: r.threshold_applied ?? undefined, reason: r.safe_reason ?? undefined,
        });
      }
      this.hydrated = true;
    } catch { /* la base no responde: se reintenta en la siguiente lectura */ }
  }

  /** Estado completo; el scraper sale de la última corrida de la KB, o «no comprobado» si no se puede leer. */
  async status(): Promise<ComponentState[]> {
    const out: ComponentState[] = COMPONENTS.filter(c => c !== "scraper").map(c => {
      const s = this.state.get(c)!;
      return { component: c, status: s.status, lastSuccessAt: iso(s.ok), lastFailureAt: iso(s.fail),
        ...(c === "reranker" && s.threshold !== undefined ? { thresholdApplied: s.threshold } : {}),
        ...(s.reason ? { safeReason: s.reason } : {}) };
    });
    out.push(await this.scraperState());
    return out;
  }

  private async scraperState(): Promise<ComponentState> {
    try {
      const { rows } = await this.db().query(
        "SELECT terminada_en, completa FROM kb.kb_corrida WHERE programada ORDER BY terminada_en DESC LIMIT 1");
      if (!rows.length) return { component: "scraper", status: "no comprobado", lastSuccessAt: null, lastFailureAt: null };
      const t = new Date(rows[0].terminada_en).toISOString();
      return rows[0].completa
        ? { component: "scraper", status: "normal", lastSuccessAt: t, lastFailureAt: null }
        : { component: "scraper", status: "degradado", lastSuccessAt: null, lastFailureAt: t, safeReason: "La última corrida terminó incompleta." };
    } catch {
      return { component: "scraper", status: "no comprobado", lastSuccessAt: null, lastFailureAt: null };
    }
  }

  /** Avisos de operación + de la KB, por última ocurrencia descendente. */
  async list(estado: "no_revisada" | "todas"): Promise<{ avisos: NotificationView[]; noRevisadas: number }> {
    const vol: NotificationView[] = this.volatile.map(v => ({
      id: v.id, origen: "operacion", type: v.type, description: v.description, state: "no_revisada",
      firstAt: new Date(v.firstAt).toISOString(), lastAt: new Date(v.at).toISOString(), repetitions: v.repetitions, reviewedBy: null, reviewedAt: null }));
    let rows: NotificationView[] = [];
    try {
      const where = estado === "todas" ? "" : "WHERE state = 'no_revisada'";
      const op = await this.db().query(`SELECT * FROM admin.notification ${where}`);
      rows = op.rows.map(r => ({ id: r.id, origen: "operacion" as const, type: r.type, description: r.safe_description, state: r.state,
        firstAt: new Date(r.first_at).toISOString(), lastAt: new Date(r.last_at).toISOString(), repetitions: r.repetitions,
        reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null }));
      try {
        const kbWhere = estado === "todas" ? "" : "WHERE estado = 'no_revisada'";
        const kb = await this.db().query(`SELECT id, tipo, descripcion, estado, repeticiones, primera_en, ultima_en, revisada_por, revisada_en FROM kb.kb_notificacion ${kbWhere}`);
        rows.push(...kb.rows.map(r => ({ id: r.id, origen: "kb" as const, type: String(r.tipo), description: r.descripcion, state: r.estado,
          firstAt: new Date(r.primera_en).toISOString(), lastAt: new Date(r.ultima_en).toISOString(), repetitions: r.repeticiones,
          reviewedBy: r.revisada_por, reviewedAt: r.revisada_en ? new Date(r.revisada_en).toISOString() : null })));
      } catch { /* la KB no es obligatoria para ver los avisos de operación */ }
    } catch { /* base caída: solo los volátiles */ }
    const avisos = [...vol, ...rows].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return { avisos, noRevisadas: avisos.filter(a => a.state === "no_revisada").length };
  }

  async unreviewedCount(): Promise<number> {
    return (await this.list("no_revisada")).noRevisadas;
  }

  /** Marca revisada UNA vez, con actor y fecha, y conserva la fila. Requiere la base. */
  async review(id: string, actor: string): Promise<"ok" | "no_encontrada" | "ya_revisada"> {
    const at = new Date(adminClock.now());
    return adminTx(async c => {
      const op = await c.query(
        "UPDATE admin.notification SET state = 'revisada', reviewed_by = $2, reviewed_at = $3 WHERE id = $1 AND state = 'no_revisada' RETURNING id", [id, actor, at]);
      let found = !!op.rowCount;
      if (!found) {
        const exists = await c.query("SELECT state FROM admin.notification WHERE id = $1", [id]);
        if (exists.rowCount) return "ya_revisada" as const;
        const kb = await c.query(
          "UPDATE kb.kb_notificacion SET estado = 'revisada', revisada_por = $2, revisada_en = $3 WHERE id = $1 AND estado = 'no_revisada' RETURNING id", [id, actor, at]);
        found = !!kb.rowCount;
        if (!found) {
          const k = await c.query("SELECT 1 FROM kb.kb_notificacion WHERE id = $1", [id]);
          return k.rowCount ? "ya_revisada" as const : "no_encontrada" as const;
        }
      }
      await writeAudit(c, { actor, action: "aviso.revisar", objectType: "notificacion", objectId: id, result: "ok" }, at);
      return "ok" as const;
    }, this.db());
  }
}

export const operations = new Operations();
