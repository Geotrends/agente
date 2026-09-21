import { getResponseTokenLimit } from "../services/contextBudget.js";
import { createOpenAiCompatibleProvider } from "../shared/openAiCompatible.js";

/** OpenAI-compatible: https://api-docs.deepseek.com/ */
const DEFAULT_DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";

export const askDeepSeek = createOpenAiCompatibleProvider({
  label: "DeepSeek",
  provider: "deepseek",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  missingKeyMessage: "Falta configurar DEEPSEEK_API_KEY en el backend (.env). Obten una clave en https://platform.deepseek.com/api_keys",
  url: () => (process.env.DEEPSEEK_API_URL || DEFAULT_DEEPSEEK_CHAT_URL).trim(),
  body: base => ({ ...base, temperature: 0.4, max_tokens: getResponseTokenLimit(), stream: false }),
});
