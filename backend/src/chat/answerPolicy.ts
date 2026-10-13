/**
 * Políticas de respuesta que no dependen del modelo (RF-C3-DI-04).
 *
 * La abstención documental es texto fijo más el canal oficial vigente, sin citas ni datos
 * adicionales. Solo se usa ante una recuperación EXITOSA sin evidencia suficiente: una
 * búsqueda fallida nunca se presenta como «sin información».
 */
import type { ContactSnapshot } from "./contracts.js";
import { AUSENCIA_INICIO, TEXTO_ACLARACION_ANONIMA, TEXTO_FUERA_DE_ALCANCE } from "../prompts/institutionalTexts.js";
import { contactoGeneral } from "./composeAnswer.js";

export function respuestaAusencia(c: ContactSnapshot): { tipo: "sin información"; respuesta: string; fuentes: [] } {
  const r = c.recepcion;
  return {
    tipo: "sin información",
    respuesta: `${AUSENCIA_INICIO} Puede consultar el canal oficial: [PQRSD](${r.pqrsd}), WhatsApp ${r.whatsapp} o el correo ${r.email}.`,
    fuentes: [],
  };
}

export type Evidencia = { exito: true; fragmentos: number } | { exito: false };

/** `null` = hay evidencia, seguir con el modelo. Búsqueda fallida no es ausencia: el llamador responde 503. */
export function decidirAbstencion(ev: Evidencia, c: ContactSnapshot): ReturnType<typeof respuestaAusencia> | null {
  if (!ev.exito) throw new Error("busqueda_fallida");
  return ev.fragmentos === 0 ? respuestaAusencia(c) : null;
}

/** Pregunta que pide una decisión o concepto de la dirección (RF-C3-DI-09). */
const DECISION = /\b(me\s+(aprueban?|autorizan?|conceden|otorgan|dan|van\s+a\s+(aprobar|autorizar|dar|sancionar|multar))|me\s+sancionan|me\s+multan|apruebe?n?|autoricen?|aprobarán|autorizarán|concepto\s+(t[eé]cnico|jur[ií]dico)|es\s+legal|estoy\s+obligad[oa]|cumplo\s+con|me\s+corresponde|procede\s+mi|ser[aá]\s+(aprobad|autorizad|aceptad))/i;

export function solicitaDecision(pregunta: string): boolean {
  return DECISION.test(pregunta);
}

// ── Alcance (RF-C3-DI-01, RF-C3-DI-20) ──────────────────────────────────────

/** Análisis que Geobot no hace: estadística, cálculo, regresión, predicción. */
const ANALISIS = /\b(regresi[oó]n|estad[ií]stic\w*|correlaci[oó]n|desviaci[oó]n\s+est[aá]ndar|varianza|promedio\s+de|calcula\w*|c[aá]lcul\w*|predic\w*|pron[oó]stic\w*|proyecci[oó]n\s+(de|para)|modelo\s+(matem[aá]tico|predictivo|estad[ií]stico)|ecuaci[oó]n|integral\s+de|derivada|series?\s+de\s+tiempo|machine\s+learning|red\s+neuronal)\b/i;

/** Materias ajenas a las tres direcciones, reconocibles sin modelo. */
const AJENA = /\b(receta\s+de|f[uú]tbol|partido\s+de|resultado\s+del\s+partido|horóscopo|signo\s+zodiacal|criptomoneda|bitcoin|programa\s+en\s+(python|java)|escr[ií]beme\s+un\s+(poema|c[oó]digo|ensayo)|tarea\s+de\s+(matem|f[ií]sica|qu[ií]mica)|diagn[oó]stico\s+m[eé]dico|elecciones\s+presidenciales|a\s+qui[eé]n\s+votar)\b/i;

export function fueraDeAlcanceLocal(pregunta: string): boolean {
  return ANALISIS.test(pregunta) || AJENA.test(pregunta);
}

/** Respuesta fija: tres direcciones + contacto general, sin contestar la materia. */
export function respuestaFueraDeAlcance(c: ContactSnapshot): { tipo: "fuera de alcance"; respuesta: string; fuentes: [] } {
  return { tipo: "fuera de alcance", respuesta: `${TEXTO_FUERA_DE_ALCANCE}\n\n${contactoGeneral(c)}`, fuentes: [] };
}

/** Aclaración: una sola pregunta, sin fuentes. Anónimo: pide la pregunta completa. */
export function respuestaAclaracion(pregunta: string, autorizada: boolean): { tipo: "aclaración"; respuesta: string; fuentes: [] } {
  const limpia = pregunta.replace(/\[D\d+\]/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return { tipo: "aclaración", respuesta: autorizada ? limpia : `${limpia}\n\n${TEXTO_ACLARACION_ANONIMA}`, fuentes: [] };
}
