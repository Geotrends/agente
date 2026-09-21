/**
 * Contrato de los reintentos ante fallos transitorios (hallazgo M-10).
 *
 * Lo que hay que demostrar no es solo que reintenta, sino sobre todo que NO
 * reintenta lo que no mejora: un reintento sobre un 401 es latencia y cuota
 * quemadas para obtener el mismo error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfter, retryDelayMs, withRetry, type RetryConfig } from '../src/shared/retry.js';
import { providerFailure, type ProviderResult } from '../src/shared/llmTypes.js';
import { createOpenAiCompatibleProvider } from '../src/shared/openAiCompatible.js';

const fast: RetryConfig = { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 };

test('withRetry: un fallo transitorio seguido de éxito devuelve la respuesta', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return calls === 1
      ? { result: providerFailure('network', 'se cayó la red') }
      : { result: { ok: true, answer: 'a la segunda' } as ProviderResult };
  }, fast);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.answer, 'a la segunda');
  assert.equal(calls, 2);
});

test('withRetry: agotar los intentos devuelve el último fallo', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return { result: providerFailure('network', `intento ${calls}`) };
  }, fast);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.detail, 'intento 2', 'se devuelve el último, no el primero');
  assert.equal(calls, 2, 'no se intenta más veces de las configuradas');
});

test('withRetry: un fallo NO reintentable se devuelve al primer intento', async () => {
  for (const kind of ['auth', 'model', 'size'] as const) {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return { result: providerFailure(kind, 'no mejora repitiendo') };
    }, { attempts: 5, baseDelayMs: 0, maxDelayMs: 0 });
    assert.equal(result.ok, false);
    assert.equal(calls, 1, `${kind} no debe reintentarse ni una vez`);
  }
});

test('withRetry: un éxito al primer intento no reintenta', async () => {
  let calls = 0;
  await withRetry(async () => {
    calls++;
    return { result: { ok: true, answer: 'listo' } as ProviderResult };
  }, fast);
  assert.equal(calls, 1);
});

test('retryDelayMs: retroceso exponencial acotado por el máximo', () => {
  const config: RetryConfig = { attempts: 5, baseDelayMs: 500, maxDelayMs: 4000 };
  assert.equal(retryDelayMs(config, 0), 500);
  assert.equal(retryDelayMs(config, 1), 1000);
  assert.equal(retryDelayMs(config, 2), 2000);
  assert.equal(retryDelayMs(config, 4), 4000, 'el tope manda');
});

test('retryDelayMs: Retry-After del proveedor gana, pero acotado', () => {
  const config: RetryConfig = { attempts: 2, baseDelayMs: 500, maxDelayMs: 4000 };
  assert.equal(retryDelayMs(config, 0, 2), 2000, 'se respeta lo que pide el proveedor');
  // Un "espera una hora" no puede dejar colgada la petición del ciudadano.
  assert.equal(retryDelayMs(config, 0, 3600), 4000);
});

test('parseRetryAfter: segundos, fecha HTTP y basura', () => {
  assert.equal(parseRetryAfter('30'), 30);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('no es un número'), undefined);
  const enUnMinuto = new Date(Date.now() + 60_000).toUTCString();
  const parsed = parseRetryAfter(enUnMinuto)!;
  assert.ok(parsed > 55 && parsed <= 60, `fecha HTTP mal interpretada: ${parsed}`);
});

// ── de punta a punta, contra la fábrica real ────────────────────────────────

test('la fábrica reintenta un 503 y devuelve la respuesta del segundo intento', async () => {
  process.env.TEST_RETRY_KEY = 'clave';
  process.env.PROVIDER_RETRY_BASE_MS = '0';
  process.env.GROQ_MODEL = 'llama-3.1-8b-instant';
  process.env.GROQ_MODELS = 'llama-3.1-8b-instant';
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return calls === 1
      ? new Response('no disponible', { status: 503 })
      : new Response(JSON.stringify({ choices: [{ message: { content: 'respuesta buena' } }] }), { status: 200 });
  }) as typeof fetch;

  const ask = createOpenAiCompatibleProvider({
    label: 'Reintentos', provider: 'groq', apiKeyEnv: 'TEST_RETRY_KEY',
    missingKeyMessage: 'falta clave', url: () => 'https://ejemplo.invalido/v1',
    body: base => ({ ...base }),
  });
  try {
    const result = await ask({ message: 'hola', courseContext: 'contexto' });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.answer, 'respuesta buena');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.PROVIDER_RETRY_BASE_MS;
  }
});

test('la fábrica NO reintenta un 401', async () => {
  process.env.TEST_RETRY_KEY = 'clave';
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('denegado', { status: 401 }); }) as typeof fetch;

  const ask = createOpenAiCompatibleProvider({
    label: 'Reintentos', provider: 'groq', apiKeyEnv: 'TEST_RETRY_KEY',
    missingKeyMessage: 'falta clave', url: () => 'https://ejemplo.invalido/v1',
    body: base => ({ ...base }),
  });
  try {
    const result = await ask({ message: 'hola', courseContext: 'contexto' });
    assert.equal(result.ok, false);
    assert.equal(calls, 1, 'una clave mala no mejora reintentando');
  } finally {
    globalThis.fetch = realFetch;
  }
});
