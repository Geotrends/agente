import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { buildOpenAiMessages } from "../shared/chatHistory.js";
import { AskProviderInput, getErrorMessage } from "../shared/llmTypes.js";

const geminiApiKey = process.env.GEMINI_API_KEY || "";
const geminiClient = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

function normalizeGeminiModel(value: string): string {
  return value.replace(/^models\//, "");
}

export async function askGemini({
  message,
  courseContext,
  documentsInventory,
  activeDocumentPath,
  additionalSnippets,
  history = []
}: AskProviderInput): Promise<string> {
  if (!geminiClient) {
    return "Falta configurar GEMINI_API_KEY en el backend.";
  }

  const configuredModel = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const modelName = normalizeGeminiModel(configuredModel);
  const systemInstruction = buildSystemPrompt({
    documentContext: courseContext,
    documentsInventory,
    activeDocumentPath,
    additionalSnippets
  });

  const model = geminiClient.getGenerativeModel({
    model: modelName,
    systemInstruction
  }, { timeout: 60000 });

  const geminiHistory = history.map((turn) => ({
    role: turn.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: turn.content }]
  }));

  try {
    if (geminiHistory.length > 0) {
      const chat = model.startChat({ history: geminiHistory });
      const result = await chat.sendMessage(message);
      const answer = result.response.text().trim();
      return answer || "No encuentro esa informacion en el documento.";
    }

    const result = await model.generateContent(message);
    const answer = result.response.text().trim();
    return answer || "No encuentro esa informacion en el documento.";
  } catch (error) {
    const rawMessage = getErrorMessage(error);
    console.error("[Gemini] Error al generar contenido:", rawMessage);

    if (/api key|credential|unauth|permission|forbidden|403/i.test(rawMessage)) {
      return "Gemini rechazo la autenticacion. Revisa GEMINI_API_KEY y permisos del proyecto.";
    }

    if (/quota|rate|429|resource has been exhausted/i.test(rawMessage)) {
      return "Gemini indico limite de uso por ahora (quota/rate limit). Intenta mas tarde.";
    }

    if (/model|not found|404/i.test(rawMessage)) {
      return `El modelo '${configuredModel}' no esta disponible para esta cuenta.`;
    }

    return `Gemini devolvio un error: ${rawMessage}`;
  }
}
