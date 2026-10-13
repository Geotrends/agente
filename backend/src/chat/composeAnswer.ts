/**
 * Composición final de la respuesta al ciudadano (RF-C3-DI-07/09/24, RF-C3-IN-03).
 *
 * Convierte las referencias internas `[Dn]` en citas visibles con nombre enlazado y
 * fecha, mantiene la lista de fuentes sincronizada con lo citado, añade la leyenda
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

function citation(e: SourceEntry): string {
  const etiqueta = e.fechaTipo === "actualizado" ? "actualizado el" : "consultado el";
  return ` (según [${e.fuente.nombre}](${e.fuente.enlace}), ${etiqueta} ${e.fuente.fecha})`;
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
  const usedByAlias = new Map(input.used.map(e => [e.alias, e]));
  const cited = new Set<string>();
  let text = input.body.replace(TECH_MARKER, "").replace(INLINE_REF, (_all, alias: string) => {
    const e = usedByAlias.get(alias);
    // Referencia a una fuente ajena, sobrante o inexistente: se retira sin dejar rastro.
    if (!e) return "";
    cited.add(alias);
    return citation(e);
  }).trim();

  // Fuentes usadas pero sin referencia en el cuerpo: se citan al final del texto.
  const sinReferencia = input.used.filter(e => !cited.has(e.alias));
  if (sinReferencia.length) {
    text += `\n\nFuentes: ${sinReferencia.map(e => `[${e.fuente.nombre}](${e.fuente.enlace}), ${e.fechaTipo === "actualizado" ? "actualizado el" : "consultado el"} ${e.fuente.fecha}`).join("; ")}.`;
  }
  if (input.abreviada) text += `\n\n${AVISO_ABREVIADA}.`;
  if (input.requiereLeyenda && !text.toLowerCase().includes(LEYENDA_ASESORIA)) {
    text += `\n\n*Esta orientación ${LEYENDA_ASESORIA}.*`;
  }
  if (input.cerrarConCanales) text += `\n\n${cierreCanales(input.contactos)}`;
  text = [input.avisoPii, input.canalesInmediatos, text].filter(Boolean).join("\n\n");
  return { respuesta: text, fuentes: input.used.map(e => e.fuente) };
}
