/**
 * Eventos operativos de indisponibilidad (RF-C3-IN-04, RF-C3-IN-08).
 *
 * Un evento es la huella mínima de que el servicio no pudo atender: cuándo, qué código y qué
 * componente cayó (`modelos`, `busqueda`, `plazo`) y el modo si ya estaba validado. Nunca lleva
 * texto, categoría, identificadores, IP ni métricas de consumo, y no se vincula a ninguna consulta
 * anónima. Se guarda de mejor esfuerzo junto con un aviso del panel: si la base operativa no
 * responde, solo ese evento seguro se retiene en memoria hasta que vuelva, sin bloquear nunca el
 * error al ciudadano.
 */
import type pg from "pg";
import { adminPool } from "./db.js";

export const SERVICE_COMPONENTS = ["modelos", "busqueda", "plazo"] as const;
export type ServiceComponent = (typeof SERVICE_COMPONENTS)[number];
export type ServiceMode = "conversación" | "anónima";
export type ServiceEvent = { occurredAt: Date; code: "SERVICIO_NO_DISPONIBLE"; component: ServiceComponent; mode?: ServiceMode };

/** Tope del buffer en memoria: una caída larga no crece sin límite. */
const BUFFER_MAX = 500;

export class ServiceEvents {
  private pending: ServiceEvent[] = [];
  private flushing: Promise<void> | undefined;

  constructor(private readonly db: () => pg.Pool = adminPool) {}

  reset(): void { this.pending = []; this.flushing = undefined; }

  /** Eventos que aún no se pudieron guardar (solo metadatos seguros). */
  get buffered(): readonly ServiceEvent[] { return this.pending; }

  /** Registra el evento sin lanzar ni esperar: la respuesta de error no depende de la base. */
  record(component: ServiceComponent, mode?: ServiceMode, at: Date = new Date()): void {
    this.pending.push({ occurredAt: at, code: "SERVICIO_NO_DISPONIBLE", component, ...(mode ? { mode } : {}) });
    if (this.pending.length > BUFFER_MAX) this.pending.splice(0, this.pending.length - BUFFER_MAX);
    void this.flush().catch(() => { /* queda en memoria hasta que la base vuelva */ });
  }

  /** Drenaje serializado: dos llamadas simultáneas comparten una sola vuelta. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const p = (async () => {
      while (this.pending.length) {
        const e = this.pending[0];
        await this.db().query(
          "INSERT INTO admin.service_event (occurred_at, code, component, mode) VALUES ($1,$2,$3,$4)",
          [e.occurredAt, e.code, e.component, e.mode ?? null]);
        this.pending.shift();
      }
    })();
    this.flushing = p;
    const done = () => { if (this.flushing === p) this.flushing = undefined; };
    p.then(done, done);
    return p;
  }
}

export const serviceEvents = new ServiceEvents();
