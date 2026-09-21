import { getResponseTokenLimit } from "../services/contextBudget.js";
import { createOpenAiCompatibleProvider } from "../shared/openAiCompatible.js";

export const askOpenAI = createOpenAiCompatibleProvider({
  label: "OpenAI",
  provider: "openai",
  apiKeyEnv: "OPENAI_API_KEY",
  missingKeyMessage: "Falta configurar OPENAI_API_KEY en el backend (.env). Obten una clave en https://platform.openai.com/api-keys",
  url: () => "https://api.openai.com/v1/chat/completions",
  // Los modelos de razonamiento (familia gpt-5) fijan la temperatura y rechazan
  // un valor distinto al default, así que no se manda ninguna.
  // "max_completion_tokens" es el nombre vigente en la Chat Completions API.
  body: base => ({ ...base, max_completion_tokens: getResponseTokenLimit(), stream: false }),
});
