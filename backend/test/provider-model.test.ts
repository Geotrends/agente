import test from "node:test";
import assert from "node:assert/strict";
import {
  getProviderModel,
  getProviderModelCatalog,
  getProviderModels,
} from "../src/shared/providerModel.js";

function restoreEnvironment(saved: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("provider catalog combines default and comma-separated models", () => {
  const names = ["GEMINI_MODEL", "GEMINI_MODELS"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.GEMINI_MODEL = "models/gemini-default";
    process.env.GEMINI_MODELS = "gemini-fast, models/gemini-default, gemini-pro";
    assert.deepEqual(getProviderModels("gemini"), [
      "gemini-default", "gemini-fast", "gemini-pro",
    ]);
    assert.deepEqual(getProviderModelCatalog("gemini"), {
      defaultModel: "gemini-default",
      models: ["gemini-default", "gemini-fast", "gemini-pro"],
    });
  } finally {
    restoreEnvironment(saved);
  }
});

test("requested model must belong to its provider catalog", () => {
  const names = ["GROQ_MODEL", "GROQ_MODELS"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.GROQ_MODEL = "model-a";
    process.env.GROQ_MODELS = "model-a,model-b";
    assert.equal(getProviderModel("groq", "model-b"), "model-b");
    assert.throws(
      () => getProviderModel("groq", "model-outside-catalog"),
      /Modelo no permitido/,
    );
  } finally {
    restoreEnvironment(saved);
  }
});
