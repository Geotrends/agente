import type { RoutedProvider } from "../services/providerRouter.js";

export function getProviderModel(provider: RoutedProvider): string {
  switch (provider) {
    case "gemini":
      return (process.env.GEMINI_MODEL || "gemini-flash-latest").replace(/^models\//, "");
    case "groq":
      return process.env.GROQ_MODEL || "llama-3.1-8b-instant";
    case "deepseek":
      return process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
    case "ollama":
      return process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  }
}
