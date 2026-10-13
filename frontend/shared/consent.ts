/**
 * Estado de consentimiento y conversación del chat (RF-C4-DC-02, RF-C4-IN-01, RF-C3-IN-01/02).
 *
 * Todo vive en MEMORIA de la página: ni el identificador de conversación ni las preguntas se
 * guardan en el navegador, así que recargar o cerrar descarta la conversación. Mientras no
 * haya una decisión, no se puede consultar. «No autorizo» no envía historial ni conserva
 * preguntas para seguimiento: cada consulta es autónoma.
 */
import type { ParHistorial, RespuestaChat, FuenteCitada } from "./chatContracts";

export const MAX_HISTORIAL = 10;

export type Mensaje =
  | { rol: "usuario"; texto: string }
  | { rol: "geobot"; texto: string; fuentes: FuenteCitada[] };

export type EstadoChat =
  | { fase: "decision" }
  | { fase: "abierta"; modo: "conversación"; conversationId: string; mensajes: Mensaje[]; pares: ParHistorial[]; pendiente: string | null }
  | { fase: "abierta"; modo: "anónima"; mensajes: Mensaje[]; pares: []; pendiente: string | null };

export type Accion =
  | { tipo: "autorizar"; conversationId: string }
  | { tipo: "no_autorizar" }
  | { tipo: "enviar"; pregunta: string }
  | { tipo: "respondida"; respuesta: RespuestaChat }
  | { tipo: "fallo"; mensaje: string }
  | { tipo: "reiniciar" };

export const estadoInicial: EstadoChat = { fase: "decision" };

/** Sin decisión no hay consulta posible, ni por la interfaz ni por una ruta directa. */
export function puedeConsultar(e: EstadoChat): boolean {
  return e.fase === "abierta" && e.pendiente === null;
}

/** Los últimos 10 pares, y solo en una conversación autorizada. */
export function historialParaEnviar(e: EstadoChat): ParHistorial[] {
  if (e.fase !== "abierta" || e.modo !== "conversación") return [];
  return e.pares.slice(-MAX_HISTORIAL);
}

/** Cuerpo de POST /api/chat. Nunca incluye modelo, proveedor ni conversationId inventado. */
export function cuerpoConsulta(e: EstadoChat, pregunta: string, categoria?: string): Record<string, unknown> {
  if (e.fase !== "abierta") throw new Error("Sin decisión de consentimiento no se puede consultar.");
  if (e.modo === "anónima") return { pregunta, ...(categoria ? { categoria } : {}) };
  const historial = historialParaEnviar(e);
  return { pregunta, conversationId: e.conversationId, ...(categoria ? { categoria } : {}), ...(historial.length ? { historial } : {}) };
}

export function reducir(e: EstadoChat, a: Accion): EstadoChat {
  switch (a.tipo) {
    case "autorizar":
      return { fase: "abierta", modo: "conversación", conversationId: a.conversationId, mensajes: [], pares: [], pendiente: null };
    case "no_autorizar":
      return { fase: "abierta", modo: "anónima", mensajes: [], pares: [], pendiente: null };
    case "enviar": {
      if (!puedeConsultar(e) || e.fase !== "abierta") return e;
      // Anónima: se muestra solo la consulta actual; no se acumula nada para seguimiento.
      const base = e.modo === "anónima" ? [] : e.mensajes;
      return { ...e, mensajes: [...base, { rol: "usuario", texto: a.pregunta }], pendiente: a.pregunta } as EstadoChat;
    }
    case "respondida": {
      if (e.fase !== "abierta" || e.pendiente === null) return e;
      const msg: Mensaje = { rol: "geobot", texto: a.respuesta.respuesta, fuentes: a.respuesta.fuentes };
      if (e.modo === "anónima") return { ...e, mensajes: [...e.mensajes, msg], pendiente: null };
      // Solo se acumulan pares con respuesta exitosa del backend.
      return { ...e, mensajes: [...e.mensajes, msg], pares: [...e.pares, { pregunta: e.pendiente, respuesta: a.respuesta.respuesta }], pendiente: null };
    }
    case "fallo": {
      if (e.fase !== "abierta") return e;
      return { ...e, mensajes: [...e.mensajes, { rol: "geobot", texto: a.mensaje, fuentes: [] }], pendiente: null } as EstadoChat;
    }
    case "reiniciar":
      return estadoInicial;
  }
}
