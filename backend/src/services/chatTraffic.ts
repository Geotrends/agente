import fs from "node:fs/promises";
import path from "node:path";
import { ipKeyGenerator } from "express-rate-limit";
import { fingerprintClient } from "./auth.js";
import { setting } from "./settings.js";
import { safeErrorCode } from "./safeLog.js";

const HOUR_MS = 60 * 60 * 1_000;

type TrafficState = {
  version: 1;
  day: string;
  globalCount: number;
  perIp: Record<string, number>;
  longEvents: Record<string, number[]>;
  blockedUntil: Record<string, number>;
  emittedAlerts: number[];
};

export type TrafficRejectionCode =
  | "daily_ip_limit"
  | "daily_global_limit"
  | "ip_temporarily_blocked";

export type TrafficDecision =
  | { ok: true }
  | { ok: false; code: TrafficRejectionCode; retryAfterSeconds: number; message: string };

/** America/Bogotá es UTC−5 todo el año (sin horario de verano): el día cambia a las 05:00 UTC. */
const BOGOTA_OFFSET_MS = 5 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;

function bogotaDay(now: number): string {
  return new Date(now - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

function secondsUntilNextBogotaDay(now: number): number {
  const local = now - BOGOTA_OFFSET_MS;
  const next = (Math.floor(local / DAY_MS) + 1) * DAY_MS;
  return Math.max(1, Math.ceil((next - local) / 1_000));
}

function emptyState(now: number): TrafficState {
  return {
    version: 1, day: bogotaDay(now), globalCount: 0, perIp: {},
    longEvents: {}, blockedUntil: {}, emittedAlerts: [],
  };
}

function isTrafficState(value: unknown): value is TrafficState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<TrafficState>;
  const numberRecord = (candidate: unknown): candidate is Record<string, number> =>
    Boolean(candidate) && !Array.isArray(candidate) && typeof candidate === "object" &&
    Object.values(candidate as Record<string, unknown>).every(item => Number.isFinite(item) && Number(item) >= 0);
  const eventRecord = (candidate: unknown): candidate is Record<string, number[]> =>
    Boolean(candidate) && !Array.isArray(candidate) && typeof candidate === "object" &&
    Object.values(candidate as Record<string, unknown>).every(item =>
      Array.isArray(item) && item.every(stamp => Number.isFinite(stamp) && Number(stamp) >= 0));
  return state.version === 1 && /^\d{4}-\d{2}-\d{2}$/.test(state.day ?? "") &&
    Number.isInteger(state.globalCount) && state.globalCount! >= 0 &&
    numberRecord(state.perIp) && eventRecord(state.longEvents) && numberRecord(state.blockedUntil) &&
    Array.isArray(state.emittedAlerts) && state.emittedAlerts.every(item => Number.isInteger(item) && item >= 1 && item <= 100);
}

function normalizedIp(ip: string | undefined): string {
  return ipKeyGenerator(ip || "unknown", 64);
}

/** Cuotas persistentes para el despliegue actual de una sola réplica. */
export class ChatTrafficController {
  private state = emptyState(Date.now());
  private loadedPath: string | undefined;
  private serial = Promise.resolve();
  /**
   * Con el archivo de estado ilegible o no escribible (FR-002a) el contador sigue en memoria por
   * proceso y con un tope más estricto (la mitad), en lugar de rechazar todo o quedar sin límite.
   */
  private degraded = false;
  private lastDegradedNotice = 0;
  private degradedSink: (() => void) | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  /** Cableado de producción: avisa al administrador técnico (agrupado por el destino). */
  setDegradedSink(sink: (() => void) | undefined): void { this.degradedSink = sink; }

  isDegraded(): boolean { return this.degraded; }

  private markDegraded(error: unknown): void {
    this.degraded = true;
    const now = this.now();
    if (now - this.lastDegradedNotice < 5 * 60_000) return;
    this.lastDegradedNotice = now;
    console.error(`[traffic] state_degraded error=${safeErrorCode(error)}`);
    try { this.degradedSink?.(); } catch { /* informar jamás impide contestar */ }
  }

  private effectiveLimit(limit: number): number {
    return this.degraded ? Math.max(1, Math.floor(limit / 2)) : limit;
  }

  /** Persistir nunca rompe la consulta: ante un fallo el estado en memoria sigue siendo la autoridad. */
  private async persistSafe(): Promise<void> {
    try {
      await this.persist();
      this.degraded = false;
    } catch (error) {
      this.markDegraded(error);
    }
  }

  private statePath(): string {
    return path.resolve(setting("chatLimitStateFile"));
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation);
    this.serial = result.then(() => undefined, () => undefined);
    return result;
  }

  private async load(): Promise<void> {
    const file = this.statePath();
    if (this.loadedPath === file) return;
    this.loadedPath = file;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (!isTrafficState(parsed)) throw new Error("estructura no válida");
      this.state = parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        const corrupt = `${file}.corrupt-${this.now()}`;
        console.error(`[traffic] state_corrupt file=${file} backup=${corrupt} error=${safeErrorCode(error)}`);
        await fs.rename(file, corrupt).catch(renameError => {
          console.error(`[traffic] state_backup_failed error=${safeErrorCode(renameError)}`);
        });
      }
      this.state = emptyState(this.now());
      if (code !== "ENOENT") this.markDegraded(error);
    }
  }

  private cleanup(now: number): boolean {
    let changed = false;
    const day = bogotaDay(now);
    if (this.state.day !== day) {
      this.state.day = day;
      this.state.globalCount = 0;
      this.state.perIp = {};
      this.state.emittedAlerts = [];
      changed = true;
    }
    const cutoff = now - HOUR_MS;
    for (const [key, events] of Object.entries(this.state.longEvents)) {
      const current = events.filter(stamp => Number.isFinite(stamp) && stamp > cutoff);
      if (current.length) this.state.longEvents[key] = current;
      else delete this.state.longEvents[key];
      if (current.length !== events.length) changed = true;
    }
    for (const [key, until] of Object.entries(this.state.blockedUntil)) {
      if (!Number.isFinite(until) || until <= now) {
        delete this.state.blockedUntil[key];
        console.info(`[traffic] ip_block_expired client=${key.slice(0, 12)}`);
        changed = true;
      }
    }
    return changed;
  }

  private async persist(): Promise<void> {
    const file = this.statePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.state)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, file);
  }

  private key(ip: string | undefined): string {
    return fingerprintClient(normalizedIp(ip));
  }

  async checkAndRecordLongRequest(ip: string | undefined, messageChars: number): Promise<TrafficDecision> {
    return this.run(async () => {
      await this.load();
      const now = this.now();
      let changed = this.cleanup(now);
      const key = this.key(ip);
      const blockedUntil = this.state.blockedUntil[key] ?? 0;
      if (blockedUntil > now) {
        if (changed) await this.persistSafe();
        return {
          ok: false, code: "ip_temporarily_blocked",
          retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1_000)),
          message: "Esta red está temporalmente bloqueada por exceso de consultas extensas.",
        };
      }
      if (messageChars <= setting("chatLongMessageChars")) {
        if (changed) await this.persistSafe();
        return { ok: true };
      }
      const events = [...(this.state.longEvents[key] ?? []), now];
      this.state.longEvents[key] = events;
      changed = true;
      if (events.length > setting("chatLongMessageHourlyLimit")) {
        const until = now + setting("chatLongMessageBlockHours") * HOUR_MS;
        this.state.blockedUntil[key] = until;
        delete this.state.longEvents[key];
        await this.persistSafe();
        console.warn(`[traffic] ip_block_started client=${key.slice(0, 12)} until=${new Date(until).toISOString()} reason=long_messages`);
        return {
          ok: false, code: "ip_temporarily_blocked",
          retryAfterSeconds: Math.max(1, Math.ceil((until - now) / 1_000)),
          message: "Esta red fue bloqueada temporalmente por exceso de consultas extensas.",
        };
      }
      if (changed) await this.persistSafe();
      return { ok: true };
    });
  }

  async consumeDailyQuota(ip: string | undefined): Promise<TrafficDecision> {
    return this.run(async () => {
      await this.load();
      const now = this.now();
      const changed = this.cleanup(now);
      const key = this.key(ip);
      const globalLimit = this.effectiveLimit(setting("chatDailyGlobalLimit"));
      const ipLimit = this.effectiveLimit(setting("chatDailyPerIpLimit"));
      if (this.state.globalCount >= globalLimit) {
        if (changed) await this.persistSafe();
        console.warn(`[traffic] daily_limit_rejected scope=global day=${this.state.day} count=${this.state.globalCount} limit=${globalLimit}`);
        return { ok: false, code: "daily_global_limit", retryAfterSeconds: secondsUntilNextBogotaDay(now), message: "Se alcanzó el límite global de consultas de hoy." };
      }
      const ipCount = this.state.perIp[key] ?? 0;
      if (ipCount >= ipLimit) {
        if (changed) await this.persistSafe();
        console.warn(`[traffic] daily_limit_rejected scope=ip client=${key.slice(0, 12)} day=${this.state.day} count=${ipCount} limit=${ipLimit}`);
        return { ok: false, code: "daily_ip_limit", retryAfterSeconds: secondsUntilNextBogotaDay(now), message: "Esta red alcanzó el límite de consultas de hoy." };
      }
      this.state.globalCount++;
      this.state.perIp[key] = ipCount + 1;
      for (const percentage of setting("chatDailyAlertPercentages")) {
        const threshold = Math.ceil(globalLimit * percentage / 100);
        if (this.state.globalCount >= threshold && !this.state.emittedAlerts.includes(percentage)) {
          this.state.emittedAlerts.push(percentage);
          console.warn(`[traffic] daily_global_threshold day=${this.state.day} count=${this.state.globalCount} limit=${globalLimit} percentage=${percentage}`);
        }
      }
      await this.persistSafe();
      return { ok: true };
    });
  }
}

export type ChatQueueErrorCode = "chat_queue_full" | "chat_queue_busy" | "chat_queue_timeout";

const QUEUE_ERROR_MESSAGES: Record<ChatQueueErrorCode, string> = {
  chat_queue_full: "La cola de consultas está llena.",
  chat_queue_busy: "Hay muchas consultas en curso y la tuya no alcanzaría a atenderse a tiempo.",
  chat_queue_timeout: "La consulta esperó demasiado tiempo en la cola.",
};

export class ChatQueueError extends Error {
  constructor(readonly code: ChatQueueErrorCode, readonly retryAfterSeconds: number) {
    super(QUEUE_ERROR_MESSAGES[code]);
    this.name = "ChatQueueError";
  }
}

/**
 * Una consulta rechazada por saturación es la señal de que la capacidad no
 * alcanza; la degradación se refleja en el panel, no por otro canal (Const. VI).
 */
function saturated(code: ChatQueueErrorCode, retryAfterSeconds: number, active: number, queued: number): ChatQueueError {
  console.warn(`[traffic] chat_saturated code=${code} active=${active} queued=${queued}`);
  return new ChatQueueError(code, retryAfterSeconds);
}

export type AcquireOptions = {
  /**
   * Espera máxima que todavía deja tiempo para responder dentro del plazo de
   * la petición. Si la espera estimada ya la supera, se rechaza de inmediato:
   * esperar para luego fallar solo empeora la experiencia y retiene la conexión.
   */
  maxWaitMs?: number;
};

type Waiting = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
};

/** Cola FIFO acotada para el ciclo completo de cada consulta. */
export class ChatAdmissionQueue {
  private active = 0;
  private waiting: Waiting[] = [];
  /** Promedio supuesto en frío; se reemplaza por la media móvil de las consultas reales. */
  private averageMs = setting("chatQueueInitialAverageMs");

  status(): { active: number; queued: number; averageMs: number } {
    return { active: this.active, queued: this.waiting.length, averageMs: Math.round(this.averageMs) };
  }

  /** Espera estimada de quien entre ahora al final de la cola. */
  private estimatedWaitMs(): number {
    const waves = Math.max(1, Math.ceil((this.waiting.length + 1) / setting("chatMaxConcurrent")));
    return waves * this.averageMs;
  }

  private retryAfterSeconds(): number {
    return Math.max(1, Math.ceil(this.estimatedWaitMs() / 1_000));
  }

  private releaseFor(started: number): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const elapsed = Date.now() - started;
      this.averageMs = this.averageMs * 0.8 + elapsed * 0.2;
      this.drain();
    };
  }

  private admit(entry: Waiting): void {
    clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
    this.active++;
    entry.resolve(this.releaseFor(Date.now()));
  }

  private drain(): void {
    while (this.active < setting("chatMaxConcurrent") && this.waiting.length) {
      const next = this.waiting.shift()!;
      if (next.signal?.aborted) continue;
      this.admit(next);
    }
  }

  acquire(signal?: AbortSignal, options: AcquireOptions = {}): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error("client_disconnected"));
    if (this.active < setting("chatMaxConcurrent")) {
      this.active++;
      return Promise.resolve(this.releaseFor(Date.now()));
    }
    if (this.waiting.length >= setting("chatMaxQueue")) {
      console.warn(`[traffic] chat_queue_full active=${this.active} queued=${this.waiting.length}`);
      return Promise.reject(saturated("chat_queue_full", this.retryAfterSeconds(), this.active, this.waiting.length));
    }
    const maxWaitMs = Math.max(0, Math.min(setting("chatQueueTimeoutMs"), options.maxWaitMs ?? Infinity));
    const estimatedMs = this.estimatedWaitMs();
    if (options.maxWaitMs !== undefined && estimatedMs > maxWaitMs) {
      console.warn(`[traffic] chat_queue_busy active=${this.active} queued=${this.waiting.length} estimated_ms=${Math.round(estimatedMs)} max_wait_ms=${maxWaitMs}`);
      return Promise.reject(saturated("chat_queue_busy", this.retryAfterSeconds(), this.active, this.waiting.length));
    }
    return new Promise((resolve, reject) => {
      const entry = {} as Waiting;
      const remove = () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
      };
      entry.resolve = resolve;
      entry.reject = reject;
      entry.signal = signal;
      entry.onAbort = () => {
        remove();
        clearTimeout(entry.timer);
        reject(new Error("client_disconnected"));
      };
      entry.timer = setTimeout(() => {
        remove();
        if (signal && entry.onAbort) signal.removeEventListener("abort", entry.onAbort);
        console.warn(`[traffic] chat_queue_timeout active=${this.active} queued=${this.waiting.length}`);
        reject(saturated("chat_queue_timeout", this.retryAfterSeconds(), this.active, this.waiting.length));
      }, maxWaitMs);
      if (signal && entry.onAbort) signal.addEventListener("abort", entry.onAbort, { once: true });
      this.waiting.push(entry);
    });
  }
}

export const chatTraffic = new ChatTrafficController();
export const chatAdmissionQueue = new ChatAdmissionQueue();
