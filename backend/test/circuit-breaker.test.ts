/**
 * Circuit breaker por proveedor (auditoría pre-producción, rendimiento).
 *
 * Lo que se fija: que se abre solo con fallos que dicen algo de la salud del
 * proveedor, que mientras está abierto no se llama, y que tras la espera una
 * sola consulta de prueba decide si vuelve.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { admit, countsAgainstProvider, record, resetCircuits } from "../src/services/circuitBreaker.js";
import { providerFailure, type ProviderResult } from "../src/shared/llmTypes.js";

const ok: ProviderResult = { ok: true, answer: "respuesta" };
const network = providerFailure("network", "se cayó la red");
const auth = providerFailure("auth", "clave inválida");

test.beforeEach(() => {
  resetCircuits();
  process.env.PROVIDER_BREAKER_FAILURES = "3";
  process.env.PROVIDER_BREAKER_COOLDOWN_MS = "30000";
});

test("se abre al tercer fallo seguido y avisa solo al abrirse", () => {
  const t = 1_000_000;
  assert.equal(record("groq:m", network, t), false);
  assert.equal(record("groq:m", network, t), false);
  assert.equal(admit("groq:m", t), "closed", "dos fallos no bastan");
  assert.equal(record("groq:m", network, t), true, "el tercero lo abre");
  assert.equal(admit("groq:m", t + 1), "open");
  assert.equal(admit("gemini:m", t + 1), "closed", "cada proveedor y modelo tiene su circuito");
});

test("un éxito en medio reinicia la cuenta", () => {
  record("groq:m", network);
  record("groq:m", network);
  record("groq:m", ok);
  record("groq:m", network);
  assert.equal(admit("groq:m"), "closed");
});

test("los errores de configuración no abren el circuito", () => {
  for (let i = 0; i < 10; i++) assert.equal(record("groq:m", auth), false);
  assert.equal(admit("groq:m"), "closed", "una clave mala no se arregla esperando");
  assert.equal(countsAgainstProvider(providerFailure("model", "no existe")), false);
  assert.equal(countsAgainstProvider(providerFailure("size", "413")), false);
  assert.equal(countsAgainstProvider(providerFailure("unknown", "HTTP 400", "400", false)), false);
  assert.equal(countsAgainstProvider(providerFailure("unknown", "HTTP 503", "503", true)), true);
  assert.equal(countsAgainstProvider(providerFailure("timeout", "plazo", "plazo", false)), true);
  assert.equal(countsAgainstProvider(providerFailure("quota", "429")), true);
});

test("tras la espera, una sola consulta de prueba; si responde, se cierra", () => {
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) record("groq:m", network, t);
  assert.equal(admit("groq:m", t + 29_999), "open", "todavía dentro de la espera");
  assert.equal(admit("groq:m", t + 30_000), "probe", "vencida la espera, se prueba");
  assert.equal(admit("groq:m", t + 30_001), "open", "las demás no entran mientras la prueba sigue");
  assert.equal(record("groq:m", ok, t + 30_500), false);
  assert.equal(admit("groq:m", t + 30_600), "closed");
});

test("si la prueba falla, se vuelve a abrir sin repetir el aviso", () => {
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) record("groq:m", network, t);
  assert.equal(admit("groq:m", t + 30_000), "probe");
  assert.equal(record("groq:m", network, t + 30_100), false, "reabrir no vuelve a avisar");
  assert.equal(admit("groq:m", t + 30_200), "open");
  assert.equal(admit("groq:m", t + 60_100), "probe", "la nueva espera cuenta desde el fallo de la prueba");
});

test("una prueba que no aclara nada (p. ej. un 401) deja probar a la siguiente", () => {
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) record("groq:m", network, t);
  assert.equal(admit("groq:m", t + 30_000), "probe");
  record("groq:m", auth, t + 30_100);
  assert.equal(admit("groq:m", t + 30_200), "probe");
});
