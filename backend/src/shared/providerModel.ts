import type { RoutedProvider } from "../services/providerRouter.js";

const DEFAULT_MODELS: Record<RoutedProvider, string> = {
  gemini: "gemini-flash-latest",
  groq: "llama-3.1-8b-instant",
  deepseek: "deepseek-v4-flash",
  ollama: "llama3.2",
  openai: "gpt-5-nano",
};

function normalizeModel(provider: RoutedProvider, model: string): string {
  const normalized = model.trim();
  return provider === "gemini" ? normalized.replace(/^models\//, "") : normalized;
}

/** Modelos seleccionables. *_MODEL conserva compatibilidad y define el default;
 * *_MODELS agrega una lista separada por comas para el selector del frontend. */
export function getProviderModels(provider: RoutedProvider): string[] {
  const prefix = provider.toUpperCase();
  const configuredDefault = normalizeModel(provider, process.env[`${prefix}_MODEL`] || "");
  const configuredModels = (process.env[`${prefix}_MODELS`] || "")
    .split(",")
    .map(model => normalizeModel(provider, model));
  const defaultModel = configuredDefault || configuredModels.find(Boolean) || DEFAULT_MODELS[provider];
  return [...new Set([defaultModel, ...configuredModels].filter(Boolean))];
}

export function getProviderModel(provider: RoutedProvider, requestedModel?: string): string {
  const models = getProviderModels(provider);
  if (!requestedModel?.trim()) return models[0];
  const normalized = normalizeModel(provider, requestedModel);
  if (!models.includes(normalized)) {
    throw new Error(`Modelo no permitido para ${provider}: ${normalized}`);
  }
  return normalized;
}

export function getProviderModelCatalog(provider: RoutedProvider): {
  models: string[];
  defaultModel: string;
} {
  const models = getProviderModels(provider);
  return { models, defaultModel: models[0] };
}
