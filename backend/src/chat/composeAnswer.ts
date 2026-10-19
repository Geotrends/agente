/**
 * Composición final de la respuesta al ciudadano (RF-C3-DI-07/09/24, RF-C3-IN-03).
 *
 * Retira las referencias internas `[Dn]` del texto (las fuentes viajan aparte, en `fuentes`, y la
 * interfaz las muestra en «Fuentes consultadas»), añade la leyenda
 * cuando se pidió una decisión y cierra con los tres canales de recepción tomados del
 * snapshot vigente. Nunca deja marcadores técnicos visibles ni inventa contactos.
 */
import type { ContactSnapshot, FuenteCitada } from "./contracts.js";
import { AVISO_ABREVIADA, LEYENDA_ASESORIA } from "../prompts/institutionalTexts.js";
import type { SourceEntry } from "./sources.js";

const INLINE_REF = /\s?\[(D\d{1,3})\]/g;
const TECH_MARKER = /<!--[\s\S]*?-->/g;

/** Cierre con los tres canales de recepción, no excluyentes (RF-C3-DI-24). */
export function cierreCanales(c: ContactSnapshot): string {
  const r = c.recepcion;
  return `Para radicar o hacer seguimiento puede usar cualquiera de estos canales: [PQRSD](${r.pqrsd}), WhatsApp ${r.whatsapp} o el correo ${r.email}.`;
}

export function contactoGeneral(c: ContactSnapshot): string {
  const g = c.general;
  return `Contacto general: ${g.phone}, ${g.email} o [${g.url}](${g.url}).`;
}

export type ComposeInput = {
  /** Cuerpo del modelo sin el marcador de fuentes. */
  body: string;
  used: SourceEntry[];
  contactos: ContactSnapshot;
  /** La pregunta pidió una decisión o concepto. */
  requiereLeyenda: boolean;
  /** Añade el cierre de canales (respuestas de trámite). */
  cerrarConCanales: boolean;
  /** Aviso de datos personales: va primero (RF-C3-DI-23). */
  avisoPii?: string;
  /** Canales de atención inmediata: van antes de la orientación (RF-C3-DI-19). */
  canalesInmediatos?: string;
  /** La respuesta se abrevió por extensión (RF-C3-DI-18): añade el aviso exacto tras el cuerpo. */
  abreviada?: boolean;
};

export type ComposeOutput = { respuesta: string; fuentes: FuenteCitada[] };

export function composeAnswer(input: ComposeInput): ComposeOutput {
  let text = input.body.replace(TECH_MARKER, "").replace(INLINE_REF, () => {
    // Toda referencia `[Dn]` se retira del texto: la fuente, si es válida, sale en `fuentes`.
    return "";
  }).trim();

  if (input.abreviada) text += `\n\n${AVISO_ABREVIADA}.`;
  if (input.requiereLeyenda && !text.toLowerCase().includes(LEYENDA_ASESORIA)) {
    text += `\n\n*Esta orientación ${LEYENDA_ASESORIA}.*`;
  }
  if (input.cerrarConCanales) text += `\n\n${cierreCanales(input.contactos)}`;
  text = [input.avisoPii, input.canalesInmediatos, text].filter(Boolean).join("\n\n");
  return { respuesta: text, fuentes: input.used.map(e => e.fuente) };
}
