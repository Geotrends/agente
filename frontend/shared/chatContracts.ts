/**
 * Contrato público del chat (contracts/chat-api.md) tal como lo ve el navegador.
 * Los campos están en español y no hay ningún dato de modelo, proveedor, uso ni costo.
 */

export type TipoRespuesta = "respondida" | "sin información" | "fuera de alcance" | "aclaración";
export type Categoria = "Ecosistemas" | "Bienestar Animal" | "Gestión Ambiental";

/** Opciones de categoría de RF-C4-DC-03; «No estoy seguro» no envía criterio de priorización. */
export const OPCIONES_CATEGORIA: ReadonlyArray<{ etiqueta: string; categoria: Categoria | null }> = [
  { etiqueta: "Ecosistemas", categoria: "Ecosistemas" },
  { etiqueta: "Bienestar Animal", categoria: "Bienestar Animal" },
  { etiqueta: "Gestión Ambiental", categoria: "Gestión Ambiental" },
  { etiqueta: "No estoy seguro", categoria: null },
];

export type FuenteCitada = {
  id: string;
  nombre: string;
  /** Siempre https; cualquier otra cosa se muestra como texto. */
  enlace: string;
  fecha: string;
};

export type RespuestaChat = {
  modo: "conversación" | "anónima";
  conversationId?: string;
  responseId?: string;
  tipo: TipoRespuesta;
  respuesta: string;
  fuentes: FuenteCitada[];
};

export type CanalInmediato = {
  id: string;
  name: string;
  description: string;
  type: "teléfono" | "correo" | "url";
  value: string;
  position: number;
};

export type ContactosPublicos = {
  revision: number;
  recepcion: { pqrsd: string; whatsapp: string; email: string };
  general: { phone: string; email: string; url: string };
  inmediatos: CanalInmediato[];
};

export type ConfigChat = {
  apertura: string;
  politica: { version: string; url: string };
  opciones: Array<{ valor: "autorizo" | "no_autorizo"; etiqueta: string }>;
  contactos: ContactosPublicos;
};

export type ErrorChat = {
  error: { codigo: string; mensaje: string; campo?: string };
  canales: CanalInmediato[];
};

export type ParHistorial = { pregunta: string; respuesta: string };

export type SolicitudChat = {
  pregunta: string;
  conversationId?: string;
  categoria?: Categoria;
  historial?: ParHistorial[];
};

/** Solo se permite abrir enlaces https. */
export function esEnlaceSeguro(url: string): boolean {
  return /^https:\/\//i.test(url);
}

const TIPOS: readonly TipoRespuesta[] = ["respondida", "sin información", "fuera de alcance", "aclaración"];
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esTexto = (v: unknown): v is string => typeof v === "string";

/**
 * Valida la forma de una respuesta 200 antes de usarla (RF-C4-IN-04): un 200 incompleto o con
 * tipos erróneos NO es éxito. Devuelve `undefined` si algo falta. Se descartan fuentes sin https.
 */
export function parseRespuestaChat(data: unknown): RespuestaChat | undefined {
  if (!esObjeto(data)) return undefined;
  const { modo, tipo, respuesta, fuentes, conversationId, responseId } = data;
  if (modo !== "conversación" && modo !== "anónima") return undefined;
  if (!esTexto(tipo) || !TIPOS.includes(tipo as TipoRespuesta)) return undefined;
  if (!esTexto(respuesta) || respuesta.trim() === "") return undefined;
  if (!Array.isArray(fuentes)) return undefined;
  const fuentesValidas: FuenteCitada[] = [];
  for (const f of fuentes) {
    if (!esObjeto(f) || !esTexto(f.id) || !esTexto(f.nombre) || !esTexto(f.fecha) || !esTexto(f.enlace)) return undefined;
    if (esEnlaceSeguro(f.enlace)) fuentesValidas.push({ id: f.id, nombre: f.nombre, enlace: f.enlace, fecha: f.fecha });
  }
  if (conversationId !== undefined && !esTexto(conversationId)) return undefined;
  if (responseId !== undefined && !esTexto(responseId)) return undefined;
  // El anonimato nunca lleva identificadores.
  if (modo === "anónima" && (conversationId !== undefined || responseId !== undefined)) return undefined;
  // Una conversación autorizada siempre devuelve su identificador.
  if (modo === "conversación" && !conversationId) return undefined;
  // Solo la respuesta documental cita fuentes; ausencia, fuera de alcance y aclaración van sin ellas.
  if (tipo !== "respondida" && fuentes.length > 0) return undefined;
  return {
    modo, tipo: tipo as TipoRespuesta, respuesta, fuentes: fuentesValidas,
    ...(conversationId ? { conversationId } : {}), ...(responseId ? { responseId } : {}),
  };
}

/**
 * ¿La respuesta es coherente con la solicitud que la originó? Una consulta con `conversationId`
 * debe recibir modo conversación y ese mismo identificador; una sin él, modo anónima. Cualquier
 * otra combinación es un 200 malformado y no se presenta como respuesta.
 */
export function esCoherenteConSolicitud(sent: Record<string, unknown>, r: RespuestaChat): boolean {
  const id = sent.conversationId;
  if (typeof id === "string") return r.modo === "conversación" && r.conversationId === id;
  return r.modo === "anónima";
}

function parseContactos(c: unknown): ContactosPublicos | undefined {
  if (!esObjeto(c) || typeof c.revision !== "number") return undefined;
  const { recepcion, general, inmediatos } = c;
  if (!esObjeto(recepcion) || !esTexto(recepcion.pqrsd) || !esTexto(recepcion.whatsapp) || !esTexto(recepcion.email)) return undefined;
  if (!esObjeto(general) || !esTexto(general.phone) || !esTexto(general.email) || !esTexto(general.url)) return undefined;
  if (!Array.isArray(inmediatos)) return undefined;
  const canales: CanalInmediato[] = [];
  for (const i of inmediatos) {
    if (!esObjeto(i) || !esTexto(i.id) || !esTexto(i.name) || !esTexto(i.description) || !esTexto(i.value) || typeof i.position !== "number") return undefined;
    if (i.type !== "teléfono" && i.type !== "correo" && i.type !== "url") return undefined;
    canales.push({ id: i.id, name: i.name, description: i.description, type: i.type, value: i.value, position: i.position });
  }
  return {
    revision: c.revision,
    recepcion: { pqrsd: recepcion.pqrsd, whatsapp: recepcion.whatsapp, email: recepcion.email },
    general: { phone: general.phone, email: general.email, url: general.url },
    inmediatos: canales,
  };
}

/** Valida íntegra la configuración (apertura, política, opciones, contactos); si falta algo, undefined. */
export function parseConfigChat(data: unknown): ConfigChat | undefined {
  if (!esObjeto(data) || !esTexto(data.apertura) || data.apertura.trim() === "") return undefined;
  const { politica, opciones } = data;
  if (!esObjeto(politica) || !esTexto(politica.version) || !esTexto(politica.url) || !esEnlaceSeguro(politica.url)) return undefined;
  if (!Array.isArray(opciones) || opciones.length !== 2) return undefined;
  const ops: ConfigChat["opciones"] = [];
  for (const o of opciones) {
    if (!esObjeto(o) || (o.valor !== "autorizo" && o.valor !== "no_autorizo") || !esTexto(o.etiqueta)) return undefined;
    ops.push({ valor: o.valor, etiqueta: o.etiqueta });
  }
  const contactos = parseContactos(data.contactos);
  if (!contactos) return undefined;
  return { apertura: data.apertura, politica: { version: politica.version, url: politica.url }, opciones: ops, contactos };
}

/** Código de error de la API en español, si el cuerpo es un ErrorChat válido. */
export function parseErrorChat(data: unknown): { codigo: string } | undefined {
  if (!esObjeto(data) || !esObjeto(data.error) || !esTexto(data.error.codigo)) return undefined;
  return { codigo: data.error.codigo };
}
