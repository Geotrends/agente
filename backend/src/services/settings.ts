/**
 * Declaración única de toda la configuración numérica y booleana (M-8).
 *
 * `config.ts` resolvió la mitad del hallazgo: dio un camino validado que avisa
 * en vez de tragarse `OCR_MIN_TEXT_CHARS=8O` con la letra O. Pero la otra
 * mitad seguía abierta: **el nombre, el defecto y el rango de cada variable
 * vivían en el módulo que la usaba**, repartidos por ocho archivos. No había
 * dónde mirar para saber qué se puede configurar, y el rango de una variable
 * solo se descubría leyendo la línea que la lee.
 *
 * Aquí está cada una declarada una vez. Los módulos importan el accesor, no el
 * literal, así que el nombre y el rango dejan de poder desincronizarse de su
 * documentación.
 *
 * NO es una instantánea congelada al arrancar, y eso es deliberado: las
 * pruebas ajustan variables en caliente (`INDEX_REVALIDATE_MS=0` para forzar
 * la revalidación síncrona, `CHAT_LOG_FILE` para no escribir en el CSV real) y
 * una clave de API rotada debe surtir efecto sin reiniciar —la asimetría de
 * Gemini que este mismo hallazgo denuncia—. Cada accesor lee el entorno en el
 * momento de la llamada; lo que se centraliza es la DECLARACIÓN, no el valor.
 *
 * No se adopta Zod: para dieciséis escalares, sumar una dependencia al árbol
 * que A-10 señala como problema no compensa.
 */
import { boolFromEnv, floatFromEnv, intFromEnv } from "./config.js";

type IntSpec = { kind: "int"; env: string; default: number; min: number; max: number; doc: string };
type FloatSpec = { kind: "float"; env: string; default: number; min: number; max: number; doc: string };
type BoolSpec = { kind: "bool"; env: string; default: boolean; doc: string };
type Spec = IntSpec | FloatSpec | BoolSpec;

const int = (env: string, value: number, min: number, max: number, doc: string): IntSpec =>
  ({ kind: "int", env, default: value, min, max, doc });
const float = (env: string, value: number, min: number, max: number, doc: string): FloatSpec =>
  ({ kind: "float", env, default: value, min, max, doc });
const bool = (env: string, value: boolean, doc: string): BoolSpec =>
  ({ kind: "bool", env, default: value, doc });

/**
 * El catálogo. Añadir una variable aquí es lo único que hace falta para que
 * aparezca en el diagnóstico de arranque y tenga rango validado.
 */
export const SETTINGS = {
  // — Recuperación —
  indexRevalidateMs: int("INDEX_REVALIDATE_MS", 300_000, 0, 24 * 60 * 60 * 1000,
    "Cada cuánto se comprueba en segundo plano si el corpus cambió. 0 = comprobar en cada consulta."),
  indexRevalidateMaxHeapFraction: float("INDEX_REVALIDATE_MAX_HEAP_FRACTION", 0.55, 0.05, 1,
    "Fracción del heap por encima de la cual no se lanza una reconstrucción en segundo plano."),
  retrievalMaxPerDocument: int("RETRIEVAL_MAX_PER_DOCUMENT", 3, 1, 8,
    "Tope de fragmentos del mismo documento dentro del top-8 (A-6)."),
  retrievalNearDuplicateJaccard: float("RETRIEVAL_NEAR_DUPLICATE_JACCARD", 0.6, 0.05, 1,
    "Umbral de Jaccard por encima del cual dos fragmentos se consideran casi duplicados (A-6)."),
  retrievalContextWeight: float("RETRIEVAL_CONTEXT_WEIGHT", 0.3, 0, 1,
    "Peso de la pregunta anterior en BM25 al reescribir una consulta de seguimiento (M-2)."),
  rerankCandidates: int("RERANK_CANDIDATES", 16, 1, 64,
    "Cuántos candidatos ve el cross-encoder. Su costo escala con este número (A-1)."),
  rerankIntraOpThreads: int("RERANK_INTRA_OP_THREADS", 0, 0, 32,
    "Hilos de inferencia del reranker. 0 = min(4, núcleos disponibles)."),
  embeddingIntraOpThreads: int("EMBEDDING_INTRA_OP_THREADS", 2, 1, 64,
    "Hilos de inferencia del modelo de embeddings."),
  retrievalMaxQueue: int("RETRIEVAL_MAX_QUEUE", 24, 1, 10_000,
    "Consultas en cola antes de responder 503 con Retry-After (A-1)."),
  documentExtractionConcurrency: int("DOCUMENT_EXTRACTION_CONCURRENCY", 2, 1, 16,
    "Archivos extraídos en paralelo mientras se embebe el actual."),

  // — Proveedores —
  ollamaTimeoutMs: int("OLLAMA_TIMEOUT_MS", 120_000, 1_000, 600_000,
    "Espera máxima de Ollama. Más generosa que los 60 s remotos: genera en la CPU local (M-10)."),
  providerRetryAttempts: int("PROVIDER_RETRY_ATTEMPTS", 2, 1, 5,
    "Intentos TOTALES por proveedor, no reintentos. Solo se repite lo reintentable (M-10)."),
  providerRetryBaseMs: int("PROVIDER_RETRY_BASE_MS", 500, 0, 30_000,
    "Base del retroceso exponencial entre intentos."),
  providerRetryMaxMs: int("PROVIDER_RETRY_MAX_MS", 4_000, 0, 60_000,
    "Tope de espera entre intentos; acota también un Retry-After exagerado."),

  fallbackBudgetMs: int("FALLBACK_BUDGET_MS", 75_000, 5_000, 300_000,
    "Presupuesto TOTAL de la cadena de fallback entre proveedores. Antes solo había timeout por proveedor: cuatro sumaban 240 s (C-1)."),
  authSessionTtlSeconds: int("AUTH_SESSION_TTL_SECONDS", 3600, 60, 86_400,
    "Vida del token de sesión anónima, en segundos (C-1)."),

  // — Registro de interacciones —
  chatLogRetentionDays: int("CHAT_LOG_RETENTION_DAYS", 90, 1, 3650,
    "Días que se conservan las interacciones antes de purgarlas (A-11)."),

  // — OCR —
  ocrMinTextChars: int("OCR_MIN_TEXT_CHARS", 80, 0, 100_000,
    "Caracteres por debajo de los cuales un PDF se considera escaneado y se manda a OCR."),
  ocrRetryEnabled: bool("OCR_RETRY_ENABLED", false,
    "Segunda pasada de OCR. Desactivada: rescata 1 documento útil de cada 22 por +64 % de tiempo (A-3)."),
  ocrDeskew: bool("OCR_DESKEW", true,
    "Endereza escaneos torcidos antes de reconocer. Más preciso, ~30 % más lento."),
  ocrEnabled: bool("OCR_ENABLED", true, "OCR local para PDF sin capa de texto."),
} satisfies Record<string, Spec>;

export type SettingName = keyof typeof SETTINGS;

/**
 * Lee una variable declarada, validada y acotada según su especificación.
 *
 * El tipo de retorno sale de la declaración, así que pedir un booleano donde
 * se declaró un entero no compila.
 */
export function setting<K extends SettingName>(
  name: K,
): (typeof SETTINGS)[K] extends BoolSpec ? boolean : number {
  const spec: Spec = SETTINGS[name];
  const value = spec.kind === "bool"
    ? boolFromEnv(spec.env, spec.default)
    : spec.kind === "int"
      ? intFromEnv(spec.env, spec.default, spec.min, spec.max)
      : floatFromEnv(spec.env, spec.default, spec.min, spec.max);
  return value as (typeof SETTINGS)[K] extends BoolSpec ? boolean : number;
}

/**
 * Qué configuración está en vigor y cuál viene del defecto.
 *
 * Existe para el arranque y para depurar: sin esto, averiguar por qué el
 * sistema se comporta distinto en dos máquinas exigía leer ocho archivos.
 */
export function describeSettings(): Array<{ env: string; value: string; source: "entorno" | "defecto"; doc: string }> {
  return (Object.keys(SETTINGS) as SettingName[]).map(name => {
    const spec: Spec = SETTINGS[name];
    const raw = process.env[spec.env];
    return {
      env: spec.env,
      value: String(setting(name)),
      source: raw === undefined || raw.trim() === "" ? "defecto" : "entorno",
      doc: spec.doc,
    };
  });
}
