/**
 * Textos institucionales fijos del chat. Son contenido de la Alcaldía, no del modelo:
 * se muestran tal cual y no los genera ningún LLM.
 */
export const APERTURA_GEOBOT = `¡Hola! Soy Geobot, el asistente virtual automatizado del Observatorio Ambiental y Agropecuario del Municipio de Envigado.

Estoy aquí para orientarte sobre trámites, requisitos, procedimientos y canales de atención relacionados con las direcciones de Ecosistemas, Bienestar Animal y Gestión Ambiental.

Mi orientación es preliminar: no radico trámites ni tomo decisiones administrativas. La decisión corresponde siempre a la dirección responsable.`;

export const OPCIONES_AUTORIZACION = [
  { valor: "autorizo", etiqueta: "Autorizo" },
  { valor: "no_autorizo", etiqueta: "No autorizo" },
] as const;

/** Leyenda fija de RF-C3-DI-09: va literal en toda respuesta ante decisión o concepto. */
export const LEYENDA_ASESORIA = "no reemplaza asesoría técnica ni jurídica formal";

/** Texto fijo de ausencia de RF-C3-DI-04; el canal oficial se añade con el snapshot vigente. */
export const AUSENCIA_INICIO = "No encontré información validada…";

export const AVISO_ABREVIADA = "Respuesta abreviada por su extensión; consulte el documento para el detalle completo";

export const DIRECCIONES = ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental"] as const;

export const TEXTO_FUERA_DE_ALCANCE =
  "No puedo ayudar con ese tema porque está fuera del alcance de Geobot. Oriento sobre trámites, requisitos, procedimientos y canales de las direcciones de Ecosistemas, Bienestar Animal y Gestión Ambiental del Municipio de Envigado.";

export const TEXTO_RIESGO_INTRO = "Si hay una situación en curso, comuníquese ahora mismo con estos canales de atención inmediata:";

export const TEXTO_ACLARACION_ANONIMA =
  "Para ayudarle necesito más detalle. Como esta conversación no se conserva, escriba su pregunta completa en un solo mensaje.";

export const TEXTO_AVISO_PII =
  "Por su seguridad, le recomiendo no compartir datos personales como cédula, teléfono, correo o direcciones en este chat; no los necesito para orientarle y no los repito. Si debe entregarlos, hágalo por los canales oficiales.";
