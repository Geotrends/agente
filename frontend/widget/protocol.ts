/**
 * Protocolo postMessage launcher ↔ iframe (contracts/widget-host.md), versión 1.
 * Sin datos de conversación: ningún mensaje lleva texto, token, categoría, decisión ni identificadores.
 * Módulo puro (sin React ni DOM) para que el launcher de ≤10 KB lo incluya sin dependencias de la app.
 */
export const NAMESPACE = "geobot-widget" as const;
export const VERSION = 1 as const;

export type ViewportPayload = { width: number; height: number; offsetTop: number; offsetLeft: number };

export type ToIframe =
  | { type: "VISIBILITY"; payload: { visible: boolean } }
  | { type: "FOCUS_START"; payload: Record<string, never> }
  | { type: "VIEWPORT"; payload: ViewportPayload };

export type ToHost =
  | { type: "READY"; payload: Record<string, never> }
  | { type: "CLOSE"; payload: Record<string, never> }
  | { type: "FOCUS_BOUNDARY"; payload: { direction: "forward" | "backward" } };

export type WidgetMessage = ToIframe | ToHost;
export type MessageType = WidgetMessage["type"];

const TO_IFRAME: ReadonlySet<string> = new Set(["VISIBILITY", "FOCUS_START", "VIEWPORT"]);
const TO_HOST: ReadonlySet<string> = new Set(["READY", "CLOSE", "FOCUS_BOUNDARY"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isEmpty = (v: unknown): boolean => isObject(v) && Object.keys(v).length === 0;
const nonNegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

function parse(data: unknown, allowed: ReadonlySet<string>): WidgetMessage | undefined {
  if (!isObject(data)) return undefined;
  const keys = Object.keys(data);
  if (keys.length !== 4 || !("namespace" in data && "version" in data && "type" in data && "payload" in data)) return undefined;
  if (data.namespace !== NAMESPACE || data.version !== VERSION) return undefined;
  const { type, payload } = data;
  if (typeof type !== "string" || !allowed.has(type)) return undefined;
  switch (type) {
    case "READY":
    case "CLOSE":
    case "FOCUS_START":
      return isEmpty(payload) ? ({ type, payload: {} } as WidgetMessage) : undefined;
    case "VISIBILITY":
      return isObject(payload) && Object.keys(payload).length === 1 && typeof payload.visible === "boolean"
        ? { type, payload: { visible: payload.visible } } : undefined;
    case "VIEWPORT": {
      if (!isObject(payload) || Object.keys(payload).length !== 4) return undefined;
      const { width, height, offsetTop, offsetLeft } = payload;
      if (!positive(width) || !positive(height) || !nonNegative(offsetTop) || !nonNegative(offsetLeft)) return undefined;
      return { type, payload: { width, height, offsetTop, offsetLeft } };
    }
    case "FOCUS_BOUNDARY":
      return isObject(payload) && Object.keys(payload).length === 1 && (payload.direction === "forward" || payload.direction === "backward")
        ? { type, payload: { direction: payload.direction } } : undefined;
    default:
      return undefined;
  }
}

/** Mensajes que el HOST acepta del iframe; cualquier otra cosa se ignora. */
export const parseFromIframe = (data: unknown): ToHost | undefined => parse(data, TO_HOST) as ToHost | undefined;
/** Mensajes que el IFRAME acepta del host. */
export const parseFromHost = (data: unknown): ToIframe | undefined => parse(data, TO_IFRAME) as ToIframe | undefined;

export function envelope<T extends WidgetMessage>(m: T) {
  return { namespace: NAMESPACE, version: VERSION, type: m.type, payload: m.payload } as const;
}
