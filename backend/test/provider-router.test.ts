import assert from "node:assert/strict";
import test from "node:test";
import {
  getAutoRoutingPolicy,
  getAutoRouteProviders,
  pickProvider,
} from "../src/services/providerRouter.js";

const PROVIDER_ENV = [
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OLLAMA_MODEL",
  "OLLAMA_MODELS",
  "AUTO_ROUTE_SIMPLE_PROVIDER",
  "AUTO_ROUTE_SIMPLE_MODEL",
  "AUTO_ROUTE_MEDIUM_PROVIDER",
  "AUTO_ROUTE_MEDIUM_MODEL",
  "AUTO_ROUTE_COMPLEX_PROVIDER",
  "AUTO_ROUTE_COMPLEX_MODEL",
  "AUTO_ROUTE_SIMPLE_FALLBACK_PROVIDER",
  "AUTO_ROUTE_SIMPLE_FALLBACK_MODEL",
  "AUTO_ROUTE_MEDIUM_FALLBACK_PROVIDER",
  "AUTO_ROUTE_MEDIUM_FALLBACK_MODEL",
  "AUTO_ROUTE_COMPLEX_FALLBACK_PROVIDER",
  "AUTO_ROUTE_COMPLEX_FALLBACK_MODEL",
] as const;

function withConfiguredProviders(run: () => void): void {
  const saved = new Map(PROVIDER_ENV.map(name => [name, process.env[name]]));
  try {
    for (const name of PROVIDER_ENV) delete process.env[name];
    process.env.GROQ_API_KEY = "test";
    process.env.DEEPSEEK_API_KEY = "test";
    process.env.GEMINI_API_KEY = "test";
    process.env.AUTO_ROUTE_SIMPLE_PROVIDER = "groq";
    process.env.AUTO_ROUTE_SIMPLE_MODEL = "llama-3.1-8b-instant";
    process.env.AUTO_ROUTE_MEDIUM_PROVIDER = "groq";
    process.env.AUTO_ROUTE_MEDIUM_MODEL = "llama-3.1-8b-instant";
    process.env.AUTO_ROUTE_COMPLEX_PROVIDER = "deepseek";
    process.env.AUTO_ROUTE_COMPLEX_MODEL = "deepseek-v4-flash";
    process.env.AUTO_ROUTE_SIMPLE_FALLBACK_PROVIDER = "gemini";
    process.env.AUTO_ROUTE_SIMPLE_FALLBACK_MODEL = "gemini-flash-latest";
    process.env.AUTO_ROUTE_MEDIUM_FALLBACK_PROVIDER = "gemini";
    process.env.AUTO_ROUTE_MEDIUM_FALLBACK_MODEL = "gemini-flash-latest";
    process.env.AUTO_ROUTE_COMPLEX_FALLBACK_PROVIDER = "gemini";
    process.env.AUTO_ROUTE_COMPLEX_FALLBACK_MODEL = "gemini-flash-latest";
    run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("auto-route lee proveedor y modelo de cada complejidad", () => {
  withConfiguredProviders(() => {
    const policy = getAutoRoutingPolicy();
    assert.deepEqual(policy.byComplexity.simple, {
      provider: "groq",
      model: "llama-3.1-8b-instant",
    });
    assert.deepEqual(policy.byComplexity.complex, {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    assert.deepEqual(policy.fallbackByComplexity.simple, {
      provider: "gemini",
      model: "gemini-flash-latest",
    });
    assert.deepEqual(getAutoRouteProviders(), ["groq", "deepseek", "gemini"]);
  });
});

test("auto-route usa Groq para preguntas simples y medias", () => {
  withConfiguredProviders(() => {
    const decision = pickProvider({
      message: "Hola",
      historyLength: 0,
    });
    assert.equal(decision.provider, "groq");
    assert.equal(decision.model, "llama-3.1-8b-instant");
    assert.equal(decision.complexity, "simple");
    assert.equal(decision.fallback.provider, "gemini");

    assert.equal(pickProvider({
      message: "¿Qué sanciones existen?",
      historyLength: 0,
    }).provider, "groq");
  });
});

test("auto-route usa DeepSeek para preguntas complejas", () => {
  withConfiguredProviders(() => {
    assert.equal(pickProvider({
      message: "Compara las sanciones y explica sus diferencias.",
      historyLength: 0,
    }).provider, "deepseek");
  });
});

test("auto-route usa el reemplazo con su propio modelo si falta el principal", () => {
  withConfiguredProviders(() => {
    delete process.env.DEEPSEEK_API_KEY;
    const decision = pickProvider({
      message: "Compara las sanciones y explica sus diferencias.",
      historyLength: 0,
    });
    assert.equal(decision.provider, "gemini");
    assert.equal(decision.model, "gemini-flash-latest");
  });
});

test("cada complejidad conserva su propio reemplazo", () => {
  withConfiguredProviders(() => {
    process.env.AUTO_ROUTE_SIMPLE_FALLBACK_PROVIDER = "openai";
    process.env.AUTO_ROUTE_SIMPLE_FALLBACK_MODEL = "gpt-5-nano";
    const policy = getAutoRoutingPolicy();
    assert.equal(policy.fallbackByComplexity.simple.provider, "openai");
    assert.equal(policy.fallbackByComplexity.complex.provider, "gemini");
  });
});
