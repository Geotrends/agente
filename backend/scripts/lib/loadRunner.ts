/**
 * Carga contra una instancia real por HTTP (RNF-C3-IN-02/03, SPEC005 R10).
 *
 * Secuencial: 100 consultas de a una (40 simples / 30 medias / 30 complejas), de las cuales 10
 * son AUTORIZADAS con exactamente 10 pares de historial efectivos y 10 piden respuestas largas
 * (se valida ≥700 y ≤2200 tokens visibles de la respuesta recibida). Oleadas: 25 simultáneas =
 * 15 autorizadas de 5 conversaciones (3 cada una) + 10 anónimas; 3 oleadas con pausa de 120 s.
 *
 * Reglas de medición:
 *  - Sesiones, tokens y conversaciones se preparan FUERA del cronómetro y sin consumir la cuota
 *    de consultas (tienen su propia ventana en el backend).
 *  - El cronómetro corre desde el envío hasta leer y VALIDAR el cuerpo completo: un 200 sin el
 *    contrato (modo/IDs coherentes, tipo, fuentes) NO es éxito.
 *  - Todo caso cuenta en el denominador, errores incluidos; p95 por nearest-rank.
 *  - Una corrida degenerada (respuestas fijas idénticas, casi todo «sin información») se marca.
 * Usa solo preguntas sintéticas; no conserva textos de respuesta (solo longitud y huella).
 */
import { createHash } from "node:crypto";
import { countTokens } from "../../src/chat/outputTokenizer.js";

export type LoadKind = "simple" | "media" | "compleja";

const SIMPLES = ["¿Qué es el RUM?", "¿Cuál es el horario de atención?", "¿Dónde queda la Secretaría de Medio Ambiente?", "¿Qué es un GT-F?", "¿Cómo contacto a Bienestar Animal?", "¿Qué hace Gestión Ambiental?", "¿Qué es el Observatorio?", "¿Qué es un trámite ambiental?"];
const MEDIAS = ["¿Qué requisitos tiene el procedimiento de adopción y cuánto tiempo tarda?", "¿Cuál es el plazo y el procedimiento para pedir una visita técnica?", "Necesito saber los requisitos y el plazo del registro de mi mascota", "¿Qué requisitos y plazo tiene la poda de un árbol?"];
const COMPLEJAS = [
  "Compara el procedimiento de adopción con el de registro RUM, indicando requisitos, plazos y responsables, y explica qué normas aplican a cada uno y cómo se relacionan entre sí",
  "Necesito un análisis detallado de las diferencias entre la licencia ambiental y el permiso de aprovechamiento forestal, con sus normas, plazos, costos y responsables",
  "¿Qué dice el artículo 45 de la ley sobre sanciones y multas por incumplimiento y cuál es la diferencia entre ambas?",
];
/** Preguntas diseñadas para producir respuestas largas (la longitud real se valida sobre la respuesta). */
export const LARGAS = [
  "Explica con el mayor detalle posible, paso a paso, todo el procedimiento de registro de una mascota en el RUM: requisitos, documentos, plazos, responsables, normas aplicables y qué ocurre si falta algo",
  "Necesito una explicación completa y ordenada del trámite de visita técnica: quién la solicita, cómo, en qué plazos, qué normas aplican, qué documentos se anexan y cómo se hace seguimiento",
  "Describe detalladamente cada etapa del procedimiento de adopción de animales, con los requisitos de cada una, los formatos, los responsables, los tiempos y las normas que lo respaldan",
  "Dame una guía exhaustiva sobre los permisos de aprovechamiento forestal: tipos, requisitos, documentos, plazos, costos, responsables, normas y diferencias entre cada tipo",
  "Explica de forma completa cómo se tramita una denuncia por maltrato animal, qué datos debe aportar quien denuncia, qué sigue después, quién responde, en cuánto tiempo y bajo qué normas",
  "Resume todo lo que debo saber sobre la poda de árboles en espacio público: quién autoriza, requisitos, procedimiento, plazos, normas, sanciones y excepciones",
  "Detalla el procedimiento completo para solicitar una licencia ambiental, incluyendo requisitos, estudios, plazos, responsables, normas y posibles resultados del trámite",
  "Explícame con ejemplos y en orden todas las obligaciones de un tenedor de animales de compañía según la normativa aplicable, y qué dependencia verifica cada una",
  "Describe con precisión cómo funciona el trámite de registro de un establecimiento que maneja animales, con documentos, plazos, inspecciones, responsables y normas",
  "Necesito un panorama completo de los procedimientos de Gestión Ambiental que puede iniciar un ciudadano, con requisitos, plazos, responsables y normas de cada uno",
];

export const LARGA_MIN_TOKENS = 700;
export const LARGA_MAX_TOKENS = 2200;

export type LoadItem = {
  id: string; kind: LoadKind; pregunta: string;
  /** Modo autorizado: usa una conversación creada por el backend. */
  autorizada: boolean;
  /** Lleva exactamente 10 pares de historial (solo autorizadas). */
  conHistorial: boolean;
  /** Pide respuesta larga: se valida ≥700 y ≤2200 tokens visibles. */
  larga: boolean;
};

export function buildSequentialPlan(total = 100): LoadItem[] {
  const n = (frac: number) => Math.round(total * frac);
  const plan: LoadItem[] = [];
  const push = (kind: LoadKind, pregunta: string) => plan.push({ id: `S${String(plan.length + 1).padStart(3, "0")}`, kind, pregunta, autorizada: false, conHistorial: false, larga: false });
  for (let i = 0; i < n(0.4); i++) push("simple", SIMPLES[i % SIMPLES.length]);
  for (let i = 0; i < n(0.3); i++) push("media", MEDIAS[i % MEDIAS.length]);
  while (plan.length < total) push("compleja", COMPLEJAS[plan.length % COMPLEJAS.length]);
  // Mezcla determinista de niveles a lo largo de la corrida (no todos los simples primero).
  const mixed: LoadItem[] = [];
  const buckets = { simple: plan.filter(p => p.kind === "simple"), media: plan.filter(p => p.kind === "media"), compleja: plan.filter(p => p.kind === "compleja") };
  const order: LoadKind[] = ["simple", "media", "compleja", "simple", "media", "simple", "compleja", "simple", "media", "compleja"];
  for (let i = 0; mixed.length < total; i++) {
    const k = order[i % order.length];
    const next = buckets[k].shift() ?? buckets.simple.shift() ?? buckets.media.shift() ?? buckets.compleja.shift();
    if (next) mixed.push(next);
  }
  plan.splice(0, plan.length, ...mixed.map((m, i) => ({ ...m, id: `S${String(i + 1).padStart(3, "0")}` })));
  // 10 % autorizadas con 10 pares y 10 % largas, en posiciones distintas y repartidas.
  const marks = Math.max(1, Math.round(total * 0.1));
  const stride = Math.max(2, Math.floor(total / marks));
  for (let k = 0; k < marks; k++) {
    const h = plan[(k * stride) % total];
    h.autorizada = true; h.conHistorial = true;
    const l = plan[(k * stride + Math.floor(stride / 2)) % total];
    l.larga = true; l.pregunta = LARGAS[k % LARGAS.length];
  }
  return plan;
}

/** Percentil por nearest-rank: índice ceil(p·n) − 1 sobre las duraciones completas. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export type Sample = {
  id: string; kind: LoadKind; ms: number; status: number;
  /** 200 con cuerpo completo y contrato válido. */
  ok: boolean;
  autorizada: boolean; historial: number; larga: boolean;
  modo?: string; tipo?: string; tokens?: number; fuentes?: number; responseId?: string; conversationId?: string;
  /** Huella de la respuesta (no se guarda el texto). */
  huella?: string;
  /** Motivo si no es válida. */
  motivo?: string;
  inicioMs: number;
  grupo?: "autorizada" | "anonima"; conversacion?: number;
};

export type Summary = { total: number; ok: number; errores: number; p50: number; p95: number; max: number; superan40s: number; porEstado: Record<string, number> };

export function summarize(samples: Sample[]): Summary {
  const ms = samples.map(s => s.ms);
  const porEstado: Record<string, number> = {};
  for (const s of samples) porEstado[String(s.status)] = (porEstado[String(s.status)] ?? 0) + 1;
  return {
    total: samples.length, ok: samples.filter(s => s.ok).length, errores: samples.filter(s => !s.ok).length,
    p50: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)), max: Math.round(Math.max(0, ...ms)),
    superan40s: samples.filter(s => s.ms > 40_000).length, porEstado,
  };
}

export type Target = {
  baseUrl: string; policyVersion: string; origin?: string; fetchImpl?: typeof fetch;
  /** Pausa inyectable (pruebas). */
  sleep?: (ms: number) => Promise<void>;
  /** Consultas por minuto que la carga se permite (defecto 60, la cuota real; no se pide elevarla). */
  queriesPerMinute?: number;
};

const doFetch = (t: Target): typeof fetch => t.fetchImpl ?? fetch;
const sleepOf = (t: Target) => t.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
const originHeader = (t: Target): Record<string, string> => (t.origin ? { Origin: t.origin } : {});

/** Credencial técnica nueva (preparación; no consume la cuota de consultas). */
export async function newSession(t: Target): Promise<string> {
  const r = await doFetch(t)(`${t.baseUrl}/session`, { method: "POST", headers: originHeader(t) });
  const b = (await r.json()) as { token?: string };
  if (r.status !== 200 || !b.token) throw new Error(`sesion_${r.status}`);
  return b.token;
}

/** Conversación autorizada ligada a la credencial; undefined si el backend no la emite. */
export async function newConversation(t: Target, tk: string): Promise<string | undefined> {
  const r = await doFetch(t)(`${t.baseUrl}/conversations`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}`, ...originHeader(t) },
    body: JSON.stringify({ autorizacion: true, policyVersion: t.policyVersion }),
  });
  if (r.status !== 201) { await r.arrayBuffer().catch(() => {}); return undefined; }
  return ((await r.json()) as { conversationId?: string }).conversationId;
}

export type LoadContext = { token: string; conversationId?: string };

const TIPOS = new Set(["respondida", "sin información", "fuera de alcance", "aclaración"]);
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Valida el cuerpo contra el contrato y lo contrasta con lo que se pidió. Devuelve el motivo si no vale. */
export function validateBody(item: LoadItem, ctx: LoadContext, body: unknown): { ok: true; modo: string; tipo: string; tokens: number; fuentes: number; responseId?: string; huella: string } | { ok: false; motivo: string } {
  if (typeof body !== "object" || body === null) return { ok: false, motivo: "cuerpo_no_json" };
  const b = body as Record<string, unknown>;
  if (typeof b.respuesta !== "string" || !b.respuesta.trim()) return { ok: false, motivo: "respuesta_vacia" };
  if (typeof b.tipo !== "string" || !TIPOS.has(b.tipo)) return { ok: false, motivo: "tipo_invalido" };
  if (!Array.isArray(b.fuentes)) return { ok: false, motivo: "fuentes_invalidas" };
  if (b.tipo !== "respondida" && b.fuentes.length > 0) return { ok: false, motivo: "fuentes_en_no_respondida" };
  const esperado = item.autorizada && ctx.conversationId ? "conversación" : "anónima";
  if (b.modo !== esperado) return { ok: false, motivo: `modo_${String(b.modo)}_esperado_${esperado}` };
  if (esperado === "anónima" && ("conversationId" in b || "responseId" in b)) return { ok: false, motivo: "anonima_con_id" };
  if (esperado === "conversación") {
    if (b.conversationId !== ctx.conversationId) return { ok: false, motivo: "conversationId_distinto" };
    if (b.responseId !== undefined && (typeof b.responseId !== "string" || !UUID4.test(b.responseId))) return { ok: false, motivo: "responseId_invalido" };
  }
  const tokens = countTokens(b.respuesta);
  if (tokens > LARGA_MAX_TOKENS) return { ok: false, motivo: "respuesta_supera_2200_tokens" };
  return {
    ok: true, modo: b.modo as string, tipo: b.tipo, tokens, fuentes: b.fuentes.length,
    ...(typeof b.responseId === "string" ? { responseId: b.responseId } : {}),
    huella: createHash("sha256").update(b.respuesta).digest("hex").slice(0, 16),
  };
}

/**
 * Una consulta medida: desde el envío hasta leer el cuerpo COMPLETO y validarlo. El historial
 * efectivo de un caso autorizado son exactamente 10 pares válidos.
 */
export async function oneRequest(t: Target, item: LoadItem, ctx: LoadContext): Promise<Sample> {
  const usaConversacion = item.autorizada && !!ctx.conversationId;
  const historial = item.conHistorial && usaConversacion
    ? Array.from({ length: 10 }, (_, i) => ({ pregunta: `pregunta previa ${i + 1} sobre el trámite`, respuesta: `respuesta previa ${i + 1} orientadora` }))
    : undefined;
  const base: Sample = {
    id: item.id, kind: item.kind, ms: 0, status: 0, ok: false, autorizada: usaConversacion, historial: historial?.length ?? 0,
    larga: item.larga, inicioMs: Date.now(),
  };
  const started = performance.now();
  try {
    const r = await doFetch(t)(`${t.baseUrl}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.token}`, ...originHeader(t) },
      body: JSON.stringify({ pregunta: item.pregunta, ...(usaConversacion ? { conversationId: ctx.conversationId } : {}), ...(historial ? { historial } : {}) }),
    });
    const texto = await r.text();
    const ms = performance.now() - started;
    if (r.status !== 200) return { ...base, ms, status: r.status, motivo: `http_${r.status}` };
    let body: unknown;
    try { body = JSON.parse(texto); } catch { return { ...base, ms, status: 200, motivo: "cuerpo_no_json" }; }
    const v = validateBody(item, ctx, body);
    if (!v.ok) return { ...base, ms, status: 200, motivo: v.motivo };
    return { ...base, ms, status: 200, ok: true, modo: v.modo, tipo: v.tipo, tokens: v.tokens, fuentes: v.fuentes, huella: v.huella,
      ...(v.responseId ? { responseId: v.responseId } : {}), ...(usaConversacion ? { conversationId: ctx.conversationId } : {}) };
  } catch {
    return { ...base, ms: performance.now() - started, status: 0, motivo: "red" };
  }
}

/** Ventana de 60 consultas por minuto: la carga respeta la cuota real sin pedir que se eleve. */
export class QueryPacer {
  private readonly sent: number[] = [];
  constructor(private readonly t: Target, private readonly limit = t.queriesPerMinute ?? 60, private readonly windowMs = 60_000, private readonly now: () => number = Date.now) {}
  async wait(): Promise<void> {
    for (;;) {
      const t0 = this.now();
      while (this.sent.length && t0 - this.sent[0] >= this.windowMs) this.sent.shift();
      if (this.sent.length < this.limit) { this.sent.push(t0); return; }
      await sleepOf(this.t)(this.sent[0] + this.windowMs - t0 + 5);
    }
  }
}

/**
 * Secuencial: una por una. Las 10 autorizadas comparten UNA conversación creada antes de medir;
 * el resto va en modo anónimo con su sesión técnica.
 */
export async function runSequential(t: Target, plan: LoadItem[] = buildSequentialPlan()): Promise<Sample[]> {
  const tk = await newSession(t);
  const conv = plan.some(p => p.autorizada) ? await newConversation(t, tk) : undefined;
  const pacer = new QueryPacer(t);
  const out: Sample[] = [];
  for (const item of plan) {
    await pacer.wait();
    out.push(await oneRequest(t, item, { token: tk, ...(conv ? { conversationId: conv } : {}) }));
  }
  return out;
}

export type WaveSpec = { autorizadas: number; conversaciones: number; anonimas: number };
export const WAVE_25: WaveSpec = { autorizadas: 15, conversaciones: 5, anonimas: 10 };

/**
 * Oleadas: en cada una, `autorizadas` consultas repartidas en `conversaciones` conversaciones
 * (cada una con su propia credencial técnica) + `anonimas` con sesión propia, todas SIMULTÁNEAS.
 * La preparación va antes del disparo; `gapMs` se cuenta desde que termina la oleada anterior.
 */
export async function runWaves(
  t: Target, waves = 3, size = 25, gapMs = 120_000,
  spec: WaveSpec = size === 25 ? WAVE_25 : { autorizadas: Math.round(size * 0.6), conversaciones: Math.max(1, Math.round(size * 0.2)), anonimas: size - Math.round(size * 0.6) },
): Promise<Sample[][]> {
  const out: Sample[][] = [];
  for (let w = 0; w < waves; w++) {
    if (w > 0) await sleepOf(t)(gapMs);
    // Preparación fuera del cronómetro.
    const convs: Array<{ token: string; conversationId?: string }> = [];
    for (let c = 0; c < spec.conversaciones; c++) {
      const token = await newSession(t);
      convs.push({ token, conversationId: await newConversation(t, token) });
    }
    const anon = await Promise.all(Array.from({ length: spec.anonimas }, () => newSession(t)));
    const plan = buildSequentialPlan(spec.autorizadas + spec.anonimas).map((i, idx) => ({ ...i, id: `W${w + 1}-${String(idx + 1).padStart(2, "0")}`, conHistorial: false, larga: false, autorizada: false }));
    const jobs: Array<Promise<Sample>> = [];
    plan.slice(0, spec.autorizadas).forEach((item, i) => {
      const c = i % spec.conversaciones;
      jobs.push(oneRequest(t, { ...item, autorizada: true }, convs[c]).then(s => ({ ...s, grupo: "autorizada" as const, conversacion: c })));
    });
    plan.slice(spec.autorizadas).forEach((item, i) => {
      jobs.push(oneRequest(t, item, { token: anon[i] }).then(s => ({ ...s, grupo: "anonima" as const })));
    });
    out.push(await Promise.all(jobs));
  }
  return out;
}

// ── Auditoría de la muestra ────────────────────────────────────────────────────────────────

export type SequentialAudit = {
  total: number; autorizadas: number; historiasEfectivas: number; largasSolicitadas: number; largasValidadas: number;
  simples: number; medias: number; complejas: number; respondidas: number; invalidas: number; degenerada: boolean; motivoDegenerada?: string;
};

export function auditSequential(samples: Sample[]): SequentialAudit {
  const respondidas = samples.filter(s => s.ok && s.tipo === "respondida").length;
  const frecuencia = new Map<string, number>();
  for (const s of samples) if (s.huella) frecuencia.set(s.huella, (frecuencia.get(s.huella) ?? 0) + 1);
  const masFrecuente = Math.max(0, ...frecuencia.values());
  let degenerada = false; let motivo: string | undefined;
  if (samples.length >= 10 && masFrecuente / samples.length > 0.5) { degenerada = true; motivo = "más de la mitad de las respuestas son idénticas"; }
  if (samples.length >= 10 && respondidas / samples.length < 0.8) { degenerada = true; motivo ??= "menos del 80 % son respuestas documentales"; }
  return {
    total: samples.length,
    autorizadas: samples.filter(s => s.autorizada && s.ok).length,
    historiasEfectivas: samples.filter(s => s.ok && s.autorizada && s.historial === 10).length,
    largasSolicitadas: samples.filter(s => s.larga).length,
    largasValidadas: samples.filter(s => s.larga && s.ok && s.tipo === "respondida" && (s.tokens ?? 0) >= LARGA_MIN_TOKENS && (s.tokens ?? 0) <= LARGA_MAX_TOKENS).length,
    simples: samples.filter(s => s.kind === "simple").length, medias: samples.filter(s => s.kind === "media").length, complejas: samples.filter(s => s.kind === "compleja").length,
    respondidas, invalidas: samples.filter(s => !s.ok).length, degenerada, ...(motivo ? { motivoDegenerada: motivo } : {}),
  };
}

/** Problemas de una corrida secuencial frente a N302 (vacío = la muestra es válida). */
export function checkSequentialAudit(a: SequentialAudit, exp = { total: 100, simples: 40, medias: 30, complejas: 30, historias: 10, largas: 10 }): string[] {
  const p: string[] = [];
  if (a.total !== exp.total) p.push(`muestra de ${a.total} en lugar de ${exp.total}`);
  if (a.simples !== exp.simples || a.medias !== exp.medias || a.complejas !== exp.complejas) p.push(`mezcla ${a.simples}/${a.medias}/${a.complejas} en lugar de ${exp.simples}/${exp.medias}/${exp.complejas}`);
  if (a.historiasEfectivas !== exp.historias) p.push(`${a.historiasEfectivas} historiales efectivos de ${exp.historias} requeridos`);
  if (a.largasValidadas !== exp.largas) p.push(`${a.largasValidadas} respuestas largas validadas de ${exp.largas} requeridas`);
  if (a.degenerada) p.push(`corrida degenerada: ${a.motivoDegenerada}`);
  return p;
}

export type WaveAudit = { total: number; autorizadas: number; conversaciones: number; anonimas: number; errores: number; sinResponseId: number };

export function auditWave(samples: Sample[]): WaveAudit {
  const aut = samples.filter(s => s.grupo === "autorizada");
  return {
    total: samples.length, autorizadas: aut.length, conversaciones: new Set(aut.map(s => s.conversacion)).size,
    anonimas: samples.filter(s => s.grupo === "anonima").length, errores: samples.filter(s => !s.ok).length,
    sinResponseId: aut.filter(s => s.ok && !s.responseId).length,
  };
}

/** Problemas de una oleada frente a N303 (vacío = válida). */
export function checkWaveAudit(a: WaveAudit, exp: WaveSpec & { total: number } = { total: 25, ...WAVE_25 }): string[] {
  const p: string[] = [];
  if (a.total !== exp.total) p.push(`${a.total} solicitudes en lugar de ${exp.total}`);
  if (a.autorizadas !== exp.autorizadas) p.push(`${a.autorizadas} autorizadas en lugar de ${exp.autorizadas}`);
  if (a.conversaciones !== exp.conversaciones) p.push(`${a.conversaciones} conversaciones en lugar de ${exp.conversaciones}`);
  if (a.anonimas !== exp.anonimas) p.push(`${a.anonimas} anónimas en lugar de ${exp.anonimas}`);
  if (a.errores !== 0) p.push(`${a.errores} errores`);
  if (a.sinResponseId !== 0) p.push(`${a.sinResponseId} respuestas autorizadas sin identificador`);
  return p;
}

/** Fecha local America/Bogota (AAAA-MM-DD): distingue «dos días distintos» de la ejecución. */
export function bogotaDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
