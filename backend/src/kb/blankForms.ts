/**
 * Control de formatos en blanco (RF-C3-IV-10, research R12).
 *
 * Un formato (GT-F, MG-F) solo entra a la base si sus campos de
 * diligenciamiento están vacíos: un formato diligenciado expondría los datos
 * personales de quien lo llenó. Es una red de seguridad automática; la
 * revisión manual del 100 % de los formatos (SC-005) se hace igual.
 *
 * Se rechaza si aparece:
 *   1. un dato personal reconocible (los mismos patrones de `pii.ts`: correo,
 *      móvil, documento con su palabra ancla), salvo los correos
 *      institucionales del Municipio que el propio formato imprime;
 *   2. una etiqueta de diligenciamiento (NOMBRE, CÉDULA, DIRECCIÓN, …) seguida
 *      de un valor que no sea un marcador de espacio (guiones bajos, puntos,
 *      guiones o nada).
 *
 * Límite conocido: una firma escaneada es una imagen dentro del documento; si
 * el formato tiene texto nativo no pasa por OCR y la firma solo la detecta la
 * revisión manual.
 */
import { maskPersonalData } from "../services/pii.js";

const ETIQUETAS = [
  "nombres?(?: y apellidos)?", "apellidos?", "c[ée]dula(?: de ciudadan[íi]a)?", "documento de identidad",
  "direcci[óo]n", "tel[ée]fono", "celular", "correo(?: electr[óo]nico)?", "e-?mail",
  "firma(?: del solicitante)?", "barrio",
];
const ETIQUETA = new RegExp(`(?:^|[\\s,;|])(${ETIQUETAS.join("|")})\\s*:`, "giu");
/** Otra etiqueta "Palabra:" en la misma línea: ahí termina el valor de la anterior. */
const SIGUIENTE_ETIQUETA = /\s\p{L}[\p{L} ]{1,40}:/u;
const MARCADOR = /^[\s_.\-–—]*$/u;
/** Correos del Municipio que los formatos imprimen como canal de atención. */
const CORREO_INSTITUCIONAL = /[A-Za-z0-9._%+-]+@(?:[a-z0-9-]+\.)*envigado\.gov\.co\b/gi;

export type ResultadoFormato = { enBlanco: boolean; motivos: string[] };

export function formatoEnBlanco(texto: string): ResultadoFormato {
  const motivos: string[] = [];
  const sinInstitucional = texto.replace(CORREO_INSTITUCIONAL, "");
  if (maskPersonalData(sinInstitucional) !== sinInstitucional) {
    motivos.push("contiene datos personales reconocibles (correo, teléfono o documento)");
  }
  for (const linea of texto.split(/\r?\n/)) {
    ETIQUETA.lastIndex = 0;
    for (const m of linea.matchAll(ETIQUETA)) {
      // La etiqueta debe abrir la línea o la celda: "Autorizo dar respuesta al
      // Correo Electrónico:" es una instrucción, no un campo de la persona.
      // Si antes hay otro campo ("TELÉFONO: ___ CELULAR:") también es un campo.
      const antes = linea.slice(0, m.index).trim();
      if (antes && !antes.includes(":") && !/[|,;]$/.test(antes)) continue;
      const resto = linea.slice((m.index ?? 0) + m[0].length);
      const fin = resto.search(SIGUIENTE_ETIQUETA);
      const valor = (fin >= 0 ? resto.slice(0, fin) : resto).trim();
      if (!MARCADOR.test(valor)) motivos.push(`campo "${m[1]}" diligenciado`);
    }
  }
  return { enBlanco: motivos.length === 0, motivos };
}
