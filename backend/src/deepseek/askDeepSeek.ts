import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { buildOpenAiMessages } from "../shared/chatHistory.js";
import { AskProviderInput, getErrorMessage } from "../shared/llmTypes.js";

/** OpenAI-compatible: https://api-docs.deepseek.com/ */
const DEFAULT_DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";

export async function askDeepSeek({
  message,
  courseContext,
  documentsInventory,
  activeDocumentPath,
  additionalSnippets,
  history = []
}: AskProviderInput): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return "Falta configurar DEEPSEEK_API_KEY en el backend (.env). Obten una clave en https://platform.deepseek.com/api_keys";
  }

  const url = (process.env.DEEPSEEK_API_URL || DEFAULT_DEEPSEEK_CHAT_URL).trim();
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";

  const systemContent = buildSystemPrompt({
    documentContext: courseContext,
    documentsInventory,
    activeDocumentPath,
    additionalSnippets
  });

  const body = {
    model,
    messages: buildOpenAiMessages(systemContent, history, message),
    temperature: 0.4,
    stream: false
  };

  try {
    const response = await fetch(url, {
      method: "POST",
        signal: AbortSignal.timeout(60000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401 || response.status === 403) {
        return "DeepSeek rechazo la autenticacion. Revisa DEEPSEEK_API_KEY en backend/.env.";
      }
      if (response.status === 429) {
        return "DeepSeek indico limite de uso por ahora (quota/rate limit). Intenta mas tarde.";
      }
      return `DeepSeek devolvio error HTTP ${response.status}: ${errorText}`;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = data.choices?.[0]?.message?.content?.trim() || "";
    return answer || "No encuentro esa informacion en el documento.";
  } catch (error) {
    return `DeepSeek devolvio un error: ${getErrorMessage(error)}`;
  }
}
