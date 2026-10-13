/**
 * Punto único para informar una indisponibilidad del servicio (RF-C3-IN-04): el código que decide
 * el error (handleChat, perímetro, ruta) solo dice QUÉ componente falló y en qué modo; el cableado
 * de producción lo traduce a evento técnico mínimo y aviso del panel. Nunca lleva texto ni
 * identificadores y nunca puede retrasar ni romper la respuesta de error.
 */
import type { ServiceComponent, ServiceMode } from "../admin/serviceEvents.js";

export type UnavailableSink = (component: ServiceComponent, mode?: ServiceMode) => void;

let sink: UnavailableSink = () => {};

export function setUnavailableSink(next: UnavailableSink | undefined): void { sink = next ?? (() => {}); }

export function reportUnavailable(component: ServiceComponent, mode?: ServiceMode): void {
  try { sink(component, mode); } catch { /* informar jamás impide contestar */ }
}
