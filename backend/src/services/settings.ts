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
 * pruebas ajustan variables en caliente (`CHAT_LOG_FILE` para no escribir en el
 * CSV real) y
 * una clave de API rotada debe surtir efecto sin reiniciar —la asimetría de
 * Gemini que este mismo hallazgo denuncia—. Cada accesor lee el entorno en el
 * momento de la llamada; lo que se centraliza es la DECLARACIÓN, no el valor.
 *
 * No se adopta Zod: para dieciséis escalares, sumar una dependencia al árbol
 * que A-10 señala como problema no compensa.
 */
import { boolFromEnv, floatFromEnv, intFromEnv, intListFromEnv } from "./config.js";

type IntSpec = { kind: "int"; env: string; default: number; min: number; max: number; doc: string };
type FloatSpec = { kind: "float"; env: string; default: number; min: number; max: number; doc: string };
type BoolSpec = { kind: "bool"; env: string; default: boolean; doc: string };
type IntListSpec = { kind: "int-list"; env: string; default: number[]; min: number; max: number; doc: string };
type StringSpec = { kind: "string"; env: string; default: string; doc: string };
type Spec = IntSpec | FloatSpec | BoolSpec | IntListSpec | StringSpec;

const int = (env: string, value: number, min: number, max: number, doc: string): IntSpec =>
  ({ kind: "int", env, default: value, min, max, doc });
const float = (env: string, value: number, min: number, max: number, doc: string): FloatSpec =>
  ({ kind: "float", env, default: value, min, max, doc });
const bool = (env: string, value: boolean, doc: string): BoolSpec =>
  ({ kind: "bool", env, default: value, doc });
const intList = (env: string, value: number[], min: number, max: number, doc: string): IntListSpec =>
  ({ kind: "int-list", env, default: value, min, max, doc });
const text = (env: string, value: string, doc: string): StringSpec =>
  ({ kind: "string", env, default: value, doc });

/**
 * El catálogo. Añadir una variable aquí es lo único que hace falta para que
 * aparezca en el diagnóstico de arranque y tenga rango validado.
 */
export const SETTINGS = {
  // — Recuperación —
  retrievalMaxPerDocument: int("RETRIEVAL_MAX_PER_DOCUMENT", 3, 1, 8,
    "Tope de fragmentos del mismo documento dentro del top-8 (A-6)."),
  retrievalNearDuplicateJaccard: float("RETRIEVAL_NEAR_DUPLICATE_JACCARD", 0.6, 0.05, 1,
    "Umbral de Jaccard por encima del cual dos fragmentos se consideran casi duplicados (A-6)."),
  retrievalContextWeight: float("RETRIEVAL_CONTEXT_WEIGHT", 0.3, 0, 1,
    "Peso de la pregunta anterior en BM25 al reescribir una consulta de seguimiento (M-2)."),
  rerankCandidates: int("RERANK_CANDIDATES", 16, 1, 16,
    "Cuántos candidatos ve el cross-encoder. El techo es 16 (RF-C3-DI-12); su costo escala con este número (A-1)."),
  rerankIntraOpThreads: int("RERANK_INTRA_OP_THREADS", 0, 0, 32,
    "Hilos de inferencia del reranker. 0 = min(4, núcleos disponibles)."),
  embeddingIntraOpThreads: int("EMBEDDING_INTRA_OP_THREADS", 2, 1, 64,
    "Hilos de inferencia del modelo de embeddings."),
  retrievalMaxQueue: int("RETRIEVAL_MAX_QUEUE", 24, 1, 10_000,
    "Consultas en cola antes de responder 503 con Retry-After (A-1)."),
  documentExtractionConcurrency: int("DOCUMENT_EXTRACTION_CONCURRENCY", 2, 1, 16,
    "Archivos extraídos en paralelo mientras se embebe el actual."),

  // — Proveedores —
  providerRetryAttempts: int("PROVIDER_RETRY_ATTEMPTS", 2, 1, 5,
    "Intentos TOTALES por proveedor, no reintentos. Solo se repite lo reintentable (M-10)."),
  providerRetryBaseMs: int("PROVIDER_RETRY_BASE_MS", 500, 0, 30_000,
    "Base del retroceso exponencial entre intentos."),
  providerRetryMaxMs: int("PROVIDER_RETRY_MAX_MS", 4_000, 0, 60_000,
    "Tope de espera entre intentos; acota también un Retry-After exagerado."),
  providerBreakerFailures: int("PROVIDER_BREAKER_FAILURES", 3, 1, 50,
    "Fallos seguidos de un proveedor (red, timeout, saturación, 5xx) que abren su circuito."),
  providerBreakerCooldownMs: int("PROVIDER_BREAKER_COOLDOWN_MS", 30_000, 1_000, 600_000,
    "Cuánto tiempo se salta un proveedor con el circuito abierto antes de probarlo de nuevo."),

  authSessionTtlSeconds: int("AUTH_SESSION_TTL_SECONDS", 3600, 60, 86_400,
    "Vida del token de sesión anónima, en segundos (C-1)."),
  authSessionHourlyPerIpLimit: int("AUTH_SESSION_HOURLY_PER_IP_LIMIT", 150, 1, 100_000,
    "Sesiones nuevas por IP y hora. Holgado a propósito: tras un CGNAT móvil o una red institucional, muchas personas comparten IP."),

  // — Protección del chat —
  chatMaxMessageChars: int("CHAT_MAX_MESSAGE_CHARS", 2_500, 100, 50_000,
    "Máximo de caracteres admitidos en una pregunta."),
  chatDailyPerIpLimit: int("CHAT_DAILY_PER_IP_LIMIT", 300, 1, 1_000_000,
    "Consultas procesadas por IP y día UTC. Del orden del volumen diario esperado: una IP compartida no se queda sin servicio."),
  chatDailyGlobalLimit: int("CHAT_DAILY_GLOBAL_LIMIT", 1_000, 1, 10_000_000,
    "Consultas procesadas globalmente por día UTC."),
  chatDailyAlertPercentages: intList("CHAT_DAILY_ALERT_PERCENTAGES", [10, 25, 50, 75, 90, 100], 1, 100,
    "Porcentajes del cupo global que generan una alerta una vez por día."),
  chatLongMessageChars: int("CHAT_LONG_MESSAGE_CHARS", 1_500, 1, 50_000,
    "Longitud a partir de la cual una pregunta cuenta como larga (comparación estricta >)."),
  chatLongMessageHourlyLimit: int("CHAT_LONG_MESSAGE_HOURLY_LIMIT", 10, 1, 10_000,
    "Preguntas largas permitidas por IP dentro de una hora."),
  chatLongMessageBlockHours: int("CHAT_LONG_MESSAGE_BLOCK_HOURS", 24, 1, 24 * 365,
    "Duración del bloqueo por abuso de preguntas largas."),
  chatMaxConcurrent: int("CHAT_MAX_CONCURRENT", 8, 1, 1_000,
    "Solicitudes de chat que pueden ejecutar simultáneamente. Margen para cuando un proveedor se vuelve lento: las llamadas al LLM esperan red, no CPU."),
  chatMaxQueue: int("CHAT_MAX_QUEUE", 24, 0, 10_000,
    "Solicitudes de chat que pueden esperar una plaza de ejecución."),
  chatQueueInitialAverageMs: int("CHAT_QUEUE_INITIAL_AVERAGE_MS", 5_000, 500, 40_000,
    "Duración media supuesta de una consulta hasta que el proceso aprende la real. Con un valor demasiado alto, 25 simultáneas en frío rechazan la última por «cola ocupada» (RNF-C3-IN-03)."),
  chatQueueTimeoutMs: int("CHAT_QUEUE_TIMEOUT_MS", 30_000, 100, 600_000,
    "Espera máxima dentro de la cola del chat."),
  chatRequestTimeoutMs: int("CHAT_REQUEST_TIMEOUT_MS", 120_000, 10_000, 290_000,
    "Plazo TOTAL de una consulta (cola + recuperación + proveedor). Debe quedar por debajo del timeout del proxy."),
  chatLimitStateFile: text("CHAT_LIMIT_STATE_FILE", "var/chat-traffic-state.json",
    "Archivo persistente de cuotas y bloqueos del chat."),

  // — Registro de interacciones —
  chatLogRetentionDays: int("CHAT_LOG_RETENTION_DAYS", 90, 1, 3650,
    "Días que se conservan las interacciones antes de purgarlas (A-11)."),

  // — OCR —
  ocrMinTextChars: int("OCR_MIN_TEXT_CHARS", 80, 0, 100_000,
    "Caracteres por debajo de los cuales un PDF se considera escaneado y se manda a OCR."),
  ocrEnabled: bool("OCR_ENABLED", true, "OCR local para PDF sin capa de texto."),
  // El mínimo es el propio requisito: nunca se carga un OCR con confianza <= 80 (RF-C3-IV-07).
  ocrMinConfidence: int("OCR_MIN_CONFIDENCE", 80, 80, 100,
    "Confianza media del OCR que un documento escaneado debe SUPERAR para cargarse (RF-C3-IV-07)."),

  // — Base de conocimiento (kb-worker, bloque 1) —
  // El mínimo de 12 es RNF-C3-IV-03; el defecto deja un mes de margen a la purga diaria.
  kbRetencionMeses: int("KB_RETENCION_MESES", 13, 12, 120,
    "Meses que se conservan verificaciones, descartes por OCR y notificaciones revisadas (RNF-C3-IV-03)."),
  kbSondeoMs: int("KB_SONDEO_MS", 300_000, 1_000, 24 * 60 * 60 * 1000,
    "Respaldo de la vigilancia del directorio de informes de corrida."),
  kbUmbralEstructura: float("KB_UMBRAL_ESTRUCTURA", 0.3, 0, 1,
    "Fracción del contenido previo bajo la cual una página se toma como estructura modificada (RF-C3-IV-04)."),

  // — Bloque 2: Bedrock y perímetro del chat (RNF-C3-DI-02, RNF-C3-IN-04/05/06/07/08/10) —
  // Sin valores por defecto inventados: lo oficial (rol, contactos, tarifas) lo aporta la
  // operación y `diConfig.ts` bloquea la readiness mientras falte.
  bedrockRegion: text("BEDROCK_REGION", "us-east-1",
    "Región única de inferencia. Sin respaldo regional (RNF-C3-DI-02)."),
  bedrockModelSmall: text("BEDROCK_MODEL_20B", "openai.gpt-oss-20b-1:0",
    "ID exacto del modelo para consultas simples y medias."),
  bedrockModelLarge: text("BEDROCK_MODEL_120B", "openai.gpt-oss-120b-1:0",
    "ID exacto del modelo para consultas complejas."),
  bedrockMaxOutputTokens: int("BEDROCK_MAX_OUTPUT_TOKENS", 2_200, 1, 2_200,
    "Tope de tokens de salida visibles. El techo es el requisito RNF-C3-DI-03: no se puede subir."),
  chatDeadlineMs: int("CHAT_DEADLINE_MS", 40_000, 5_000, 40_000,
    "Plazo único de una consulta, cola y escritura incluidas. El techo es RF-C3-IN-04."),
  chatRateLimitPerMinute: int("CHAT_RATE_LIMIT_PER_MINUTE", 60, 1, 6_000,
    "Solicitudes de chat por IP en ventana deslizante de un minuto (RNF-C3-IN-05)."),
  chatPrepRateLimitPerMinute: int("CHAT_PREP_RATE_LIMIT_PER_MINUTE", 300, 1, 6_000,
    "Preparación, configuración y valoración por IP en ventana de un minuto; independiente de la cuota de consultas (RNF-C3-IN-05)."),
  chatMaxBodyBytes: int("CHAT_MAX_BODY_BYTES", 131_072, 1_024, 131_072,
    "Tamaño máximo del cuerpo del chat: 128 KiB, sin límite adicional de caracteres (RNF-C3-IN-06)."),
  chatAllowedOrigins: text("CHAT_ALLOWED_ORIGINS", "",
    "Orígenes del navegador admitidos, separados por comas. Vacío = ninguno (RNF-C3-IN-04)."),
  consentPolicyVersion: text("CONSENT_POLICY_VERSION", "",
    "Versión de la política de datos mostrada al ciudadano. Vacía bloquea la readiness."),
  consentPolicyUrl: text("CONSENT_POLICY_URL", "",
    "URL https de la política de datos municipal. Vacía bloquea la readiness."),
  tokenizerDir: text("TOKENIZER_DIR", "",
    "Directorio con los artefactos fijados del tokenizador o200k_harmony. Vacío bloquea la readiness."),
  chatPoolMax: int("CHAT_DB_POOL_MAX", 10, 1, 100,
    "Conexiones máximas del pool de chat."),
  adminPoolMax: int("ADMIN_DB_POOL_MAX", 3, 1, 20,
    "Conexiones máximas del pool del panel."),
} satisfies Record<string, Spec>;

export type SettingName = keyof typeof SETTINGS;

type SettingValue<S extends Spec> =
  S extends BoolSpec ? boolean :
  S extends IntListSpec ? number[] :
  S extends StringSpec ? string : number;

/**
 * Lee una variable declarada, validada y acotada según su especificación.
 *
 * El tipo de retorno sale de la declaración, así que pedir un booleano donde
 * se declaró un entero no compila.
 */
export function setting<K extends SettingName>(
  name: K,
): SettingValue<(typeof SETTINGS)[K]> {
  const spec: Spec = SETTINGS[name];
  let value: boolean | number | number[] | string;
  if (spec.kind === "bool") value = boolFromEnv(spec.env, spec.default);
  else if (spec.kind === "int") value = intFromEnv(spec.env, spec.default, spec.min, spec.max);
  else if (spec.kind === "float") value = floatFromEnv(spec.env, spec.default, spec.min, spec.max);
  else if (spec.kind === "int-list") value = intListFromEnv(spec.env, spec.default, spec.min, spec.max);
  else value = process.env[spec.env]?.trim() || spec.default;
  return value as SettingValue<(typeof SETTINGS)[K]>;
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
