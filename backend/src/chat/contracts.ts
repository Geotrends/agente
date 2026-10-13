/**
 * Contratos del chat ciudadano del bloque 2 (contracts/chat-api.md, bedrock-runtime.md).
 *
 * Los campos públicos están en español y los resultados internos (uso, costo, modelo
 * efectivo) viven en tipos aparte: nada de lo interno se serializa hacia el ciudadano.
 */

export const CATEGORIAS = ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const TIPOS_RESPUESTA = ["respondida", "sin información", "fuera de alcance", "aclaración"] as const;
export type TipoRespuesta = (typeof TIPOS_RESPUESTA)[number];

export type ParHistorial = { pregunta: string; respuesta: string };

/** Cuerpo ya validado de POST /api/chat. */
export type PreguntaValidada = {
  pregunta: string;
  conversationId?: string;
  categoria?: Categoria;
  /** Hasta los 10 últimos pares; solo existe con conversationId. */
  historial: ParHistorial[];
};

export type FuenteCitada = {
  id: string;
  nombre: string;
  /** URL https oficial. */
  enlace: string;
  /** AAAA-MM-DD: última actualización (documentos) o acceso (páginas). */
  fecha: string;
};

/** Lo que el ciudadano recibe. */
export type RespuestaPublica =
  | { modo: "conversación"; conversationId: string; responseId?: string; tipo: TipoRespuesta; respuesta: string; fuentes: FuenteCitada[] }
  | { modo: "anónima"; tipo: TipoRespuesta; respuesta: string; fuentes: FuenteCitada[] };

export type CanalInmediato = {
  id: string;
  name: string;
  description: string;
  type: "teléfono" | "correo" | "url";
  value: string;
  position: number;
};

/** Snapshot transaccional de contactos oficiales (data-model.md). */
export type ContactSnapshot = {
  revision: number;
  recepcion: { pqrsd: string; whatsapp: string; email: string };
  general: { phone: string; email: string; url: string };
  inmediatos: CanalInmediato[];
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type StopReason = "end_turn" | "max_tokens" | "other";

/** Resultado interno de una llamada a un modelo; nunca llega al ciudadano. */
export type ModelCallResult = {
  text: string;
  usage: TokenUsage;
  stopReason: StopReason;
  /** ID de modelo que respondió realmente (puede ser el de respaldo). */
  effectiveModel: string;
};

export type ModelRequest = {
  system: string;
  /** Pares ya saneados. */
  historial: ParHistorial[];
  pregunta: string;
  /** Instante absoluto (ms epoch) en que la llamada debe estar cancelada. */
  deadline: number;
  signal?: AbortSignal;
};

/** Adaptador de modelo: una tentativa, sin reintentos ocultos. */
export interface ModelAdapter {
  call(modelId: string, request: ModelRequest): Promise<ModelCallResult>;
}

export type ErrorCodigo = "VALIDACION" | "SERVICIO_NO_DISPONIBLE" | "ERROR_INTERNO" | "LIMITE_SOLICITUDES" | "CUERPO_EXCESIVO" | "ORIGEN_NO_PERMITIDO" | "NO_AUTORIZADO";

export type ErrorPublico = {
  error: { codigo: ErrorCodigo; mensaje: string; campo?: string };
  canales: CanalInmediato[];
};

/** Un cuerpo 200 que no cumple el contrato público no debe llegar al ciudadano. */
export class PublicResponseError extends Error {
  constructor(readonly regla: string) { super("respuesta_publica_invalida"); this.name = "PublicResponseError"; }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Verifica la respuesta pública antes de serializarla (RF-C3-IN-03): cuatro tipos literales,
 * modo coherente con los identificadores, fuentes `{id, nombre, enlace https, fecha}` únicas por
 * documento y vacías en toda respuesta que no sea documental. Lanza `PublicResponseError`.
 */
export function assertPublicResponse(r: RespuestaPublica): void {
  const fail = (regla: string): never => { throw new PublicResponseError(regla); };
  if (!(TIPOS_RESPUESTA as readonly string[]).includes(r.tipo)) fail("tipo");
  if (typeof r.respuesta !== "string" || r.respuesta.trim() === "") fail("respuesta_vacia");
  if (r.modo === "anónima") {
    if ("conversationId" in r || "responseId" in r) fail("anonima_con_identificador");
  } else if (r.modo === "conversación") {
    if (!UUID_V4.test(r.conversationId)) fail("conversationId");
    if (r.responseId !== undefined && !UUID_V4.test(r.responseId)) fail("responseId");
  } else fail("modo");
  if (!Array.isArray(r.fuentes)) fail("fuentes");
  if (r.tipo !== "respondida" && r.fuentes.length > 0) fail("fuentes_en_no_respondida");
  if (r.tipo === "respondida" && r.fuentes.length === 0) fail("respondida_sin_fuente");
  const vistos = new Set<string>();
  for (const f of r.fuentes) {
    if (!f.id || !f.nombre || !ISO_DAY.test(f.fecha)) fail("fuente_incompleta");
    try { if (new URL(f.enlace).protocol !== "https:") fail("fuente_enlace"); } catch (e) { if (e instanceof PublicResponseError) throw e; fail("fuente_enlace"); }
    if (vistos.has(f.id)) fail("fuente_duplicada");
    vistos.add(f.id);
  }
}
