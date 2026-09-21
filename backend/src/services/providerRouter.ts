import {
  scoreQuestionComplexity,
  type QuestionComplexity,
} from "./contextBudget.js";
import { getProviderModel } from "../shared/providerModel.js";

export type RoutedProvider = "gemini" | "groq" | "deepseek" | "ollama" | "openai";

export type RouteDecision = {
  provider: RoutedProvider;
  model: string;
  reason: string;
  complexity: QuestionComplexity;
  fallback: AutoRouteTarget;
};

type RouteInput = {
  message: string;
  historyLength: number;
};

export type AutoRouteTarget = {
  provider: RoutedProvider;
  model: string;
};

type AutoRoutingPolicy = {
  byComplexity: Record<QuestionComplexity, AutoRouteTarget>;
  fallbackByComplexity: Record<QuestionComplexity, AutoRouteTarget>;
};

const ROUTED_PROVIDERS: RoutedProvider[] = [
  "gemini",
  "groq",
  "deepseek",
  "ollama",
  "openai",
];

const DEFAULT_ROUTE_PROVIDERS: Record<QuestionComplexity, RoutedProvider> = {
  simple: "groq",
  medium: "groq",
  complex: "deepseek",
};

function readProvider(variable: string, fallback: RoutedProvider): RoutedProvider {
  const value = process.env[variable]?.trim().toLowerCase();
  if (!value) return fallback;
  if (ROUTED_PROVIDERS.includes(value as RoutedProvider)) return value as RoutedProvider;
  throw new Error(`${variable} contiene un proveedor no valido: ${value}`);
}

function readTarget(
  prefix: string,
  defaultProvider: RoutedProvider
): AutoRouteTarget {
  const provider = readProvider(`${prefix}_PROVIDER`, defaultProvider);
  const requestedModel = process.env[`${prefix}_MODEL`]?.trim() || undefined;
  return { provider, model: getProviderModel(provider, requestedModel) };
}

/** Lee y valida toda la politica desde .env en una sola ubicacion. */
export function getAutoRoutingPolicy(): AutoRoutingPolicy {
  return {
    byComplexity: {
      simple: readTarget("AUTO_ROUTE_SIMPLE", DEFAULT_ROUTE_PROVIDERS.simple),
      medium: readTarget("AUTO_ROUTE_MEDIUM", DEFAULT_ROUTE_PROVIDERS.medium),
      complex: readTarget("AUTO_ROUTE_COMPLEX", DEFAULT_ROUTE_PROVIDERS.complex),
    },
    fallbackByComplexity: {
      simple: readTarget("AUTO_ROUTE_SIMPLE_FALLBACK", "gemini"),
      medium: readTarget("AUTO_ROUTE_MEDIUM_FALLBACK", "gemini"),
      complex: readTarget("AUTO_ROUTE_COMPLEX_FALLBACK", "gemini"),
    },
  };
}

function isDeepSeekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

/**
 * Ollama corre local y no usa API key — se considera "configurado" si hay
 * un modelo definido (ej. OLLAMA_MODEL=llama3.2). Esto NO verifica que el
 * servidor este arriba y respondiendo; un chequeo real de salud seria
 * async (fetch a OLLAMA_BASE_URL + "/api/tags") y obligaria a que
 * pickProvider devuelva una Promise en vez de ser sincrono.
 */
function isOllamaConfigured(): boolean {
  return Boolean(process.env.OLLAMA_MODEL?.trim() || process.env.OLLAMA_MODELS?.trim());
}

const CONFIG_CHECKS: Record<RoutedProvider, () => boolean> = {
  groq: () => Boolean(process.env.GROQ_API_KEY?.trim()),
  deepseek: isDeepSeekConfigured,
  gemini: () => Boolean(process.env.GEMINI_API_KEY?.trim()),
  ollama: isOllamaConfigured,
  openai: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
};

export function isProviderConfigured(provider: RoutedProvider): boolean {
  return CONFIG_CHECKS[provider]();
}

/** Devuelve los proveedores usados por auto-route, sin duplicados y en orden. */
export function getAutoRouteProviders(): RoutedProvider[] {
  const { byComplexity, fallbackByComplexity } = getAutoRoutingPolicy();
  return [...new Set([
    byComplexity.simple.provider,
    byComplexity.medium.provider,
    byComplexity.complex.provider,
    fallbackByComplexity.simple.provider,
    fallbackByComplexity.medium.provider,
    fallbackByComplexity.complex.provider,
  ])];
}

/** Selecciona el par proveedor/modelo declarado para la complejidad. */
function preferredProvider(input: RouteInput): RouteDecision {
  const { message, historyLength } = input;
  const { level } = scoreQuestionComplexity(message, historyLength);
  const policy = getAutoRoutingPolicy();
  const target = policy.byComplexity[level];
  const complexityLabel = level === "simple" ? "simple" : level === "medium" ? "media" : "compleja";
  return {
    ...target,
    reason: `Pregunta ${complexityLabel} → ${providerLabel(target.provider)} · ${target.model}.`,
    complexity: level,
    fallback: policy.fallbackByComplexity[level],
  };
}

export function providerLabel(provider: RoutedProvider): string {
  switch (provider) {
    case "groq":
      return "Groq";
    case "deepseek":
      return "DeepSeek";
    case "ollama":
      return "Ollama";
    case "openai":
      return "OpenAI";
    default:
      return "Gemini";
  }
}

export function pickProvider(input: RouteInput): RouteDecision {
  const preferred = preferredProvider(input);
  if (isProviderConfigured(preferred.provider)) return preferred;

  const fallback = preferred.fallback;
  if (isProviderConfigured(fallback.provider)) {
    return {
      ...fallback,
      reason: `${providerLabel(preferred.provider)} no esta configurado → ${providerLabel(fallback.provider)} · ${fallback.model}.`,
      complexity: preferred.complexity,
      fallback,
    };
  }

  return {
    ...preferred,
    reason: "Ni el proveedor principal ni el reemplazo de auto-route estan configurados.",
  };
}
