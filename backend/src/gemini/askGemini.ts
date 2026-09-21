import { retryConfig, withRetry } from "../shared/retry.js";
import { getProviderModel } from "../shared/providerModel.js";
import { getResponseTokenLimit } from "../services/contextBudget.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { embedHistoryInMessage } from "../shared/chatHistory.js";
import {
  getErrorMessage, providerFailure,
  type AskProviderInput, type ProviderResult,
} from "../shared/llmTypes.js";

/**
 * El cliente se crea por llamada, no al importar el módulo (hallazgo M-8).
 *
 * Antes la clave se leía una sola vez, al cargar: los otros cuatro proveedores
 * la leen en cada petición, así que una clave añadida o rotada con el servicio
 * ya arrancado funcionaba para cuatro y no para Gemini, que seguía diciendo
 * "Falta configurar GEMINI_API_KEY" hasta reiniciar el proceso. Se cachea por
 * valor de clave para no construir un cliente nuevo en cada consulta.
 */
let cachedClient: { key: string; client: GoogleGenerativeAI } | undefined;

function geminiClientFor(apiKey: string): GoogleGenerativeAI {
  if (cachedClient?.key !== apiKey) {
    cachedClient = { key: apiKey, client: new GoogleGenerativeAI(apiKey) };
  }
  return cachedClient.client;
}

export async function askGemini({
  model: requestedModel,
  message,
  courseContext,
  history = []
}: AskProviderInput): Promise<ProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return providerFailure("auth", "Falta configurar GEMINI_API_KEY en el backend.");
  }
  const geminiClient = geminiClientFor(apiKey);

  const modelName = getProviderModel("gemini", requestedModel);
  const systemInstruction = buildSystemPrompt({ documentContext: courseContext });

  const model = geminiClient.getGenerativeModel({
    model: modelName,
    systemInstruction,
    generationConfig: { maxOutputTokens: getResponseTokenLimit() }
  }, { timeout: 60000 });

  // M-10: un intento completo, repetible por `withRetry`. Gemini no expone
  // `Retry-After`, así que el retroceso exponencial es la única guía.
  const attempt = async (): Promise<{ result: ProviderResult }> => {
  try {
    // El historial del cliente va incrustado como texto dentro de un unico
    // turno, nunca como turnos "model" reales via startChat({history}) --
    // ver el comentario en shared/chatHistory.ts (hallazgo A-9).
    const promptWithHistory = embedHistoryInMessage(history, message);
    const result = await model.generateContent(promptWithHistory);
    const answer = result.response.text().trim();
    return { result: { ok: true, answer: answer || "No encuentro esa informacion en el documento." } };
  } catch (error) {
    const rawMessage = getErrorMessage(error);
    console.error("[Gemini] Error al generar contenido:", rawMessage);
    // El SDK de Gemini no expone el estado HTTP, solo una excepción con texto,
    // así que aquí la expresión regular es inevitable. La diferencia con lo que
    // había antes (hallazgo A-4) es DÓNDE vive: clasifica una vez, en el borde
    // con la librería, y produce un tipo; ya no es el control de flujo del
    // orquestador leyendo el mensaje que este mismo módulo redactó.
    if (/api key|credential|unauth|permission|forbidden|403/i.test(rawMessage)) {
      return { result: providerFailure("auth",
        "Gemini rechazo la autenticacion. Revisa GEMINI_API_KEY y permisos del proyecto.", rawMessage) };
    }
    if (/quota|rate|429|resource has been exhausted/i.test(rawMessage)) {
      return { result: providerFailure("quota",
        "Gemini indico limite de uso por ahora (quota/rate limit). Intenta mas tarde.", rawMessage) };
    }
    if (/model|not found|404/i.test(rawMessage)) {
      return { result: providerFailure("model",
        `El modelo '${modelName}' no esta disponible para esta cuenta.`, rawMessage) };
    }
    return { result: providerFailure("network", `Gemini devolvio un error: ${rawMessage}`, rawMessage) };
  }
  };

  return withRetry(attempt, retryConfig(), (failed, delay) => {
    console.warn(`[gemini] intento fallido (${failed.ok ? "" : failed.kind}); se reintenta en ${delay} ms.`);
  });
}
