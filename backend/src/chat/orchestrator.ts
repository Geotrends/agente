/**
 * Orquestación de una consulta del chat (T025). Las dependencias se inyectan: la
 * recuperación, el snapshot de contactos y el modelo son interfaces, de modo que el
 * contrato se prueba sin red y los proveedores reales (Bedrock, Qdrant) se conectan en
 * US4/US5. Solo se usa evidencia del retriever, el prompt único y el compositor; no hay
 * clasificación remota de complejidad ni generación abierta sin fragmentos.
 */
import { fixCarnet } from "./textFixes.js";
import { buildTutorPrompt, PROMPT_VERSION } from "../prompts/tutorPrompt.js";
import { decidirAbstencion, fueraDeAlcanceLocal, respuestaAclaracion, respuestaAusencia, respuestaFueraDeAlcance, solicitaDecision } from "./answerPolicy.js";
import { afectacionEnCurso, bloqueCanalesInmediatos } from "./riskPolicy.js";
import { composeWithinLimit, OutputLimitError } from "./outputLimit.js";
import { countTokens } from "./outputTokenizer.js";
import type { ContactSnapshot, FuenteCitada, ModelCallResult, PreguntaValidada, TipoRespuesta } from "./contracts.js";
import { parseDeclaration, parseTipo, selectUsedSources } from "./sourceSelection.js";
import { formatContext, requireCitableSources, SourceDataError, type RetrievedHit } from "./sources.js";

export type ModelPort = (req: { system: string; historial: PreguntaValidada["historial"]; pregunta: string }) => Promise<ModelCallResult>;

export type OrchestratorDeps = {
  /** Búsqueda; `cola` es la cola de seguimiento solo para recuperar (RF-C3-DI-15). */
  retrieve: (pregunta: string, cola?: string) => Promise<{ hits: RetrievedHit[] }>;
  contacts: () => Promise<ContactSnapshot | null>;
  model: ModelPort;
  /** Enlaza códigos GT-F/GT-P a su URL; opcional. */
  linkCodes?: (text: string) => Promise<string>;
  /**
   * ¿Sigue vigente la evidencia recuperada? Se consulta tras generar y antes de entregar: si un
   * documento se retiró, venció o se reemplazó entretanto se hace UNA nueva búsqueda; si vuelve a
   * cambiar, error seguro (nunca contenido obsoleto ni «sin información»).
   */
  revalidate?: (hits: RetrievedHit[]) => Promise<boolean>;
};

/** Fallos que el llamador traduce a SERVICIO_NO_DISPONIBLE o ERROR_INTERNO; nunca a «sin información». */
export class ChatFailure extends Error {
  constructor(readonly kind: "contactos_no_disponibles" | "busqueda_fallida" | "datos_fuente" | "sin_fuente_valida" | "modelo_fallido" | "limite_salida", detail?: string) {
    super(detail ?? kind);
    this.name = "ChatFailure";
  }
}

/** Estado de la conversación que decide la política (solo existe con consentimiento). */
export type TurnContext = {
  /** Hay un conversationId emitido por el backend: se permite una aclaración y su estado. */
  autorizada: boolean;
  aclaracionPendiente: boolean;
  /** Aviso de datos personales ya redactado (RF-C3-DI-23); va primero. */
  avisoPii?: string;
};

export type ChatOutcome = {
  tipo: TipoRespuesta;
  respuesta: string;
  fuentes: FuenteCitada[];
  /** Estado a persistir en la conversación (solo autorizada). */
  aclaracionPendiente: boolean;
  /** Tokens visibles de la respuesta final, contados con el tokenizador oficial (0..2200). */
  visibleTokens: number;
  /** Valores oficiales de contacto: no son datos ciudadanos y el registro los conserva (RF-C3-IN-06). */
  valoresOficiales: string[];
  /** Solo uso interno (registro de consumo); jamás se serializa al ciudadano. */
  interno?: { model: ModelCallResult; promptVersion: string };
};

const SIN_CONTEXTO: TurnContext = { autorizada: false, aclaracionPendiente: false };

export async function orchestrate(input: PreguntaValidada, deps: OrchestratorDeps, ctx: TurnContext = SIN_CONTEXTO): Promise<ChatOutcome> {
  const contactos = await deps.contacts();
  if (!contactos) throw new ChatFailure("contactos_no_disponibles");
  const valoresOficiales = [
    contactos.recepcion.pqrsd, contactos.recepcion.whatsapp, contactos.recepcion.email,
    contactos.general.phone, contactos.general.email, contactos.general.url,
    ...contactos.inmediatos.map(c => c.value),
  ];

  // Orden de lo que ve la persona: aviso PII → canales de riesgo → orientación.
  const prefijos = {
    avisoPii: ctx.avisoPii,
    canalesInmediatos: afectacionEnCurso(input.pregunta) ? bloqueCanalesInmediatos(contactos) : undefined,
  };
  const envolver = (r: { tipo: TipoRespuesta; respuesta: string; fuentes: FuenteCitada[] }, aclaracionPendiente = false): ChatOutcome => {
    const respuesta = [prefijos.avisoPii, prefijos.canalesInmediatos, r.respuesta].filter(Boolean).join("\n\n");
    return { ...r, respuesta, aclaracionPendiente, visibleTokens: countTokens(respuesta), valoresOficiales };
  };

  // Análisis y materias ajenas se rechazan sin recuperar ni llamar al modelo.
  if (fueraDeAlcanceLocal(input.pregunta)) return envolver(respuestaFueraDeAlcance(contactos));

  let hits: RetrievedHit[] = [];
  let catalog: ReturnType<typeof requireCitableSources> = [];
  let model!: ModelCallResult;
  for (let intento = 0; ; intento++) {
    try {
      hits = (await deps.retrieve(input.pregunta)).hits;
    } catch (error) {
      throw new ChatFailure("busqueda_fallida", error instanceof Error ? error.message : undefined);
    }

    const ausencia = decidirAbstencion({ exito: true, fragmentos: hits.length }, contactos);
    if (ausencia) return envolver(ausencia);

    try { catalog = requireCitableSources(hits); } catch (error) {
      if (error instanceof SourceDataError) throw new ChatFailure("datos_fuente", error.message);
      throw error;
    }

    const system = buildTutorPrompt({ contactos, documentContext: formatContext(catalog) });
    try {
      model = await deps.model({ system, historial: input.historial, pregunta: input.pregunta });
    } catch (error) {
      throw new ChatFailure("modelo_fallido", error instanceof Error ? error.message : undefined);
    }
    if (!deps.revalidate) break;
    let vigente: boolean;
    try { vigente = await deps.revalidate(hits); } catch (error) {
      throw new ChatFailure("busqueda_fallida", error instanceof Error ? error.message : undefined);
    }
    if (vigente) break;
    // La evidencia cambió mientras se generaba: una sola repetición dentro del mismo plazo.
    if (intento >= 1) throw new ChatFailure("busqueda_fallida", "evidencia cambió durante la consulta");
  }

  const tipo = parseTipo(model.text);
  const interno = { model, promptVersion: PROMPT_VERSION };
  if (tipo === "fuera_de_alcance") return { ...envolver(respuestaFueraDeAlcance(contactos)), interno };
  if (tipo === "aclaracion") {
    // Una sola aclaración por conversación autorizada: la segunda insuficiencia termina como ausencia.
    if (ctx.autorizada && ctx.aclaracionPendiente) return { ...envolver(respuestaAusencia(contactos)), interno };
    return { ...envolver(respuestaAclaracion(parseDeclaration(model.text).body, ctx.autorizada), ctx.autorizada), interno };
  }

  const declaration = parseDeclaration(model.text);
  const selection = selectUsedSources(declaration, catalog, { requireSource: true });
  if (!selection.ok) throw new ChatFailure("sin_fuente_valida");

  let body = fixCarnet(declaration.body);
  if (deps.linkCodes) body = await deps.linkCodes(body);
  let out;
  try {
    out = composeWithinLimit({
      body, used: selection.used, contactos, stopReason: model.stopReason,
      requiereLeyenda: solicitaDecision(input.pregunta), cerrarConCanales: true,
      avisoPii: prefijos.avisoPii, canalesInmediatos: prefijos.canalesInmediatos,
    });
  } catch (error) {
    if (error instanceof OutputLimitError) throw new ChatFailure("limite_salida");
    throw error;
  }
  return { tipo: "respondida", respuesta: out.respuesta, fuentes: out.fuentes, aclaracionPendiente: false, visibleTokens: out.visibleTokens, valoresOficiales, interno };
}
