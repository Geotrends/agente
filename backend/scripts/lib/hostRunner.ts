/**
 * No degradación del anfitrión (N313, RNF-C3-IN-13): 180 muestras = 30 peticiones × 2 destinos
 * (página del Observatorio y una petición de referencia al Geoportal) × 3 condiciones (sin carga,
 * reindexación completa, oleada de 25 consultas). Cada destino se compara con SU propia línea base;
 * un error, un timeout (120 s, contado como error y como duración) o un cuerpo fuera del criterio
 * invalidan la muestra pero NUNCA salen del denominador. CPU/salud NO sustituyen la medición.
 */
import { percentile } from "./loadRunner.js";

export const HOST_TIMEOUT_MS = 120_000;
export const MUESTRAS_POR_CELDA = 30;
export const RAZON_MAXIMA = 1.2;

export type DestinoId = "observatorio" | "geoportal";
export type Condicion = "sin_carga" | "reindexacion" | "oleada_25";
export const CONDICIONES: readonly Condicion[] = ["sin_carga", "reindexacion", "oleada_25"];
export const DESTINOS: readonly DestinoId[] = ["observatorio", "geoportal"];

export type DestinoSpec = {
  id: DestinoId;
  /** URL oficial identificada (la configuración sensible no se guarda en el informe). */
  url: string;
  method: "GET" | "POST";
  /** Cuerpo sintético si el método lo requiere. */
  body?: string;
  headers?: Record<string, string>;
  /** Criterio de éxito: estados aceptados, tamaño mínimo y esquema opcional. */
  criterio: { status: number[]; minBytes?: number; esquema?: (cuerpo: string) => boolean };
};

export type HostSample = {
  destino: DestinoId; condicion: Condicion; indice: number;
  inicioMs: number; finMs: number; ms: number; status: number; bytes: number;
  ok: boolean; motivo?: string;
  /** La muestra transcurrió completa dentro de la ventana de carga de su condición. */
  enCarga: boolean;
  /** Cabecera `age`/`x-cache` observada: evidencia de que no se sirvió de caché. */
  cacheEvidencia?: string;
};

export type VentanaCarga = { inicioMs: number; finMs: number };

/** Mismo cliente y configuración de caché para toda la medición. */
export const CACHE_HEADERS: Record<string, string> = { "Cache-Control": "no-cache", Pragma: "no-cache" };

export type MedirOptions = {
  fetchImpl?: typeof fetch; timeoutMs?: number; n?: number;
  /** Ventana de carga activa (se evalúa solapamiento por muestra). */
  ventana?: () => VentanaCarga | undefined;
  now?: () => number;
  /** Pausa entre muestras para no saturar el destino. */
  pausaMs?: number;
};

export async function medirDestino(destino: DestinoSpec, condicion: Condicion, opts: MedirOptions = {}): Promise<HostSample[]> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const n = opts.n ?? MUESTRAS_POR_CELDA;
  const timeout = opts.timeoutMs ?? HOST_TIMEOUT_MS;
  const out: HostSample[] = [];
  for (let i = 0; i < n; i++) {
    const inicio = now();
    const t0 = performance.now();
    let status = 0; let bytes = 0; let ok = false; let motivo: string | undefined; let cacheEvidencia: string | undefined;
    try {
      const r = await f(destino.url, {
        method: destino.method, headers: { ...CACHE_HEADERS, ...destino.headers }, body: destino.body,
        signal: AbortSignal.timeout(timeout),
      });
      status = r.status;
      cacheEvidencia = r.headers.get("age") ?? r.headers.get("x-cache") ?? undefined;
      const texto = await r.text();
      bytes = Buffer.byteLength(texto);
      if (!destino.criterio.status.includes(status)) motivo = `estado_${status}`;
      else if (destino.criterio.minBytes !== undefined && bytes < destino.criterio.minBytes) motivo = "cuerpo_corto";
      else if (destino.criterio.esquema && !destino.criterio.esquema(texto)) motivo = "esquema_invalido";
      else ok = true;
    } catch (error) {
      motivo = (error as { name?: string })?.name === "TimeoutError" || (error as { name?: string })?.name === "AbortError" ? "timeout" : "red";
    }
    const ms = performance.now() - t0;
    const fin = now();
    const v = opts.ventana?.();
    out.push({
      destino: destino.id, condicion, indice: i, inicioMs: inicio, finMs: fin, ms, status, bytes, ok,
      ...(motivo ? { motivo } : {}), enCarga: !!v && inicio >= v.inicioMs && fin <= v.finMs, ...(cacheEvidencia ? { cacheEvidencia } : {}),
    });
    if (opts.pausaMs) await new Promise(r => setTimeout(r, opts.pausaMs));
  }
  return out;
}

export type Celda = { destino: DestinoId; condicion: Condicion; n: number; errores: number; invalidas: number; p50: number; p95: number; max: number; enCarga: number };

export function resumirCelda(samples: HostSample[], destino: DestinoId, condicion: Condicion): Celda {
  const s = samples.filter(x => x.destino === destino && x.condicion === condicion);
  const ms = s.map(x => x.ms);
  return {
    destino, condicion, n: s.length, errores: s.filter(x => x.motivo === "timeout" || x.motivo === "red" || /^estado_/.test(x.motivo ?? "")).length,
    invalidas: s.filter(x => !x.ok).length, p50: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)),
    max: Math.round(Math.max(0, ...ms)), enCarga: s.filter(x => x.enCarga).length,
  };
}

export type Evaluacion = {
  celdas: Celda[];
  razones: Array<{ destino: DestinoId; condicion: Condicion; p95: number; base: number; razon: number }>;
  total: number; problemas: string[]; aprobado: boolean;
};

/** Problemas frente al criterio N313 (vacío = cumple): línea base propia, 0 errores, solapamiento y p95 ≤ 120 %. */
export function evaluarNoDegradacion(samples: HostSample[]): Evaluacion {
  const problemas: string[] = [];
  const celdas: Celda[] = [];
  const razones: Evaluacion["razones"] = [];
  if (samples.length !== 180) problemas.push(`${samples.length} muestras en lugar de 180`);
  for (const destino of DESTINOS) {
    const base = resumirCelda(samples, destino, "sin_carga");
    celdas.push(base);
    for (const condicion of CONDICIONES) {
      const c = condicion === "sin_carga" ? base : resumirCelda(samples, destino, condicion);
      if (condicion !== "sin_carga") celdas.push(c);
      if (c.n !== MUESTRAS_POR_CELDA) problemas.push(`${destino}/${condicion}: ${c.n} muestras en lugar de ${MUESTRAS_POR_CELDA}`);
      if (c.invalidas !== 0) problemas.push(`${destino}/${condicion}: ${c.invalidas} muestras con error, timeout o cuerpo inválido`);
      if (condicion !== "sin_carga" && c.enCarga !== c.n) problemas.push(`${destino}/${condicion}: solo ${c.enCarga} de ${c.n} muestras se solaparon con la carga`);
    }
    if (base.p95 <= 0 || base.n === 0) { problemas.push(`${destino}: línea base inválida (p95 ${base.p95} ms)`); continue; }
    for (const condicion of ["reindexacion", "oleada_25"] as const) {
      const c = resumirCelda(samples, destino, condicion);
      const razon = c.p95 / base.p95;
      razones.push({ destino, condicion, p95: c.p95, base: base.p95, razon: Math.round(razon * 1000) / 1000 });
      if (razon > RAZON_MAXIMA) problemas.push(`${destino}/${condicion}: p95 ${c.p95} ms = ${razon.toFixed(2)}× su línea base (${base.p95} ms) > ${RAZON_MAXIMA}`);
    }
  }
  return { celdas, razones, total: samples.length, problemas, aprobado: problemas.length === 0 };
}

// ── Orquestación de las tres condiciones ───────────────────────────────────────────────────────

export type CargaActiva = { terminada: Promise<void>; etiqueta: string };

export type EjecucionConfig = {
  destinos: DestinoSpec[];
  /** Dispara la reindexación completa de SPEC001; devuelve su terminación. */
  iniciarReindexacion: () => CargaActiva;
  /** Dispara UNA oleada real de 25 consultas; devuelve su terminación. */
  iniciarOleada: () => CargaActiva;
  n?: number; timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number;
  /** Ventanas de carga adicionales permitidas cuando una no alcanza para las 30 muestras. */
  maxVentanasExtra?: number;
  pausaMs?: number;
};

export type VentanaRegistrada = { condicion: Condicion; etiqueta: string; inicioMs: number; finMs: number; extra: boolean };

/** Mide un destino y su condición bajo carga, repitiendo ventanas equivalentes (documentadas) si hace falta. */
async function medirBajoCarga(cfg: EjecucionConfig, condicion: Exclude<Condicion, "sin_carga">, iniciar: () => CargaActiva): Promise<{ muestras: HostSample[]; ventanas: VentanaRegistrada[] }> {
  const now = cfg.now ?? Date.now;
  const n = cfg.n ?? MUESTRAS_POR_CELDA;
  const muestras: HostSample[] = [];
  const ventanas: VentanaRegistrada[] = [];
  const extraMax = cfg.maxVentanasExtra ?? 6;
  for (let intento = 0; intento <= extraMax; intento++) {
    const carga = iniciar();
    const v: VentanaRegistrada = { condicion, etiqueta: carga.etiqueta, inicioMs: now(), finMs: Number.POSITIVE_INFINITY, extra: intento > 0 };
    ventanas.push(v);
    void carga.terminada.finally(() => { v.finMs = now(); });
    // Cada destino aporta lo que le falte, EN la ventana: se mide mientras la carga corre.
    const faltan = (d: DestinoId) => n - muestras.filter(m => m.destino === d && m.enCarga).length;
    const lote = await Promise.all(cfg.destinos.map(async d => {
      const out: HostSample[] = [];
      while (faltan(d.id) - out.filter(m => m.enCarga).length > 0 && v.finMs === Number.POSITIVE_INFINITY) {
        const [s] = await medirDestino(d, condicion, {
          n: 1, fetchImpl: cfg.fetchImpl, timeoutMs: cfg.timeoutMs, now,
          ventana: () => ({ inicioMs: v.inicioMs, finMs: v.finMs }),
        });
        out.push({ ...s, indice: muestras.filter(m => m.destino === d.id).length + out.length });
        if (cfg.pausaMs) await new Promise(r => setTimeout(r, cfg.pausaMs));
      }
      return out;
    }));
    await carga.terminada;
    // Solo cuentan muestras dentro de su ventana; el resto se conserva como evidencia de la ventana fallida.
    muestras.push(...lote.flat());
    if (cfg.destinos.every(d => muestras.filter(m => m.destino === d.id && m.enCarga).length >= n)) break;
  }
  // Exactamente n por destino, tomando primero las que se solaparon con la carga.
  const finales: HostSample[] = [];
  for (const d of cfg.destinos) {
    const delDestino = muestras.filter(m => m.destino === d.id);
    const dentro = delDestino.filter(m => m.enCarga);
    const fuera = delDestino.filter(m => !m.enCarga);
    finales.push(...[...dentro, ...fuera].slice(0, n).map((m, i) => ({ ...m, indice: i })));
  }
  return { muestras: finales, ventanas };
}

export async function ejecutarNoDegradacion(cfg: EjecucionConfig): Promise<{ muestras: HostSample[]; ventanas: VentanaRegistrada[]; evaluacion: Evaluacion }> {
  const muestras: HostSample[] = [];
  const ventanas: VentanaRegistrada[] = [];
  const n = cfg.n ?? MUESTRAS_POR_CELDA;
  // Condición 1: sin carga, con el mismo cliente y configuración.
  for (const d of cfg.destinos) muestras.push(...await medirDestino(d, "sin_carga", { n, fetchImpl: cfg.fetchImpl, timeoutMs: cfg.timeoutMs, now: cfg.now, pausaMs: cfg.pausaMs }));
  // Condiciones 2 y 3: bajo carga real, con solapamiento comprobado por muestra.
  const reindex = await medirBajoCarga(cfg, "reindexacion", cfg.iniciarReindexacion);
  muestras.push(...reindex.muestras); ventanas.push(...reindex.ventanas);
  const oleada = await medirBajoCarga(cfg, "oleada_25", cfg.iniciarOleada);
  muestras.push(...oleada.muestras); ventanas.push(...oleada.ventanas);
  return { muestras, ventanas, evaluacion: evaluarNoDegradacion(muestras) };
}
