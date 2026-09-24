/**
 * Contrato de la fábrica de proveedores compatibles con OpenAI (hallazgo M-9)
 * y del parser CSV único.
 *
 * Antes esto estaba implícito en tres copias del mismo código; ahora es un solo
 * comportamiento y se puede fijar una sola vez.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAiCompatibleProvider } from '../src/shared/openAiCompatible.js';
import { parseCsvRecords, parseCsvRow, parseCsvRows } from '../src/shared/csv.js';

process.env.GROQ_MODEL = 'llama-3.1-8b-instant';
process.env.GROQ_MODELS = 'llama-3.1-8b-instant';

const realFetch = globalThis.fetch;

/** Proveedor de prueba con la misma forma que Groq/DeepSeek/OpenAI. */
const ask = createOpenAiCompatibleProvider({
  label: 'Proveedor',
  provider: 'groq',
  apiKeyEnv: 'TEST_PROVIDER_KEY',
  missingKeyMessage: 'Falta configurar TEST_PROVIDER_KEY en el backend.',
  url: () => 'https://ejemplo.invalido/v1/chat/completions',
  body: base => ({ ...base, temperature: 0.25 }),
  statusMessage: status => (status === 413 ? 'Proveedor rechazo la solicitud por tamaño (HTTP 413).' : undefined),
});

const input = { message: '¿cuál es el horario?', courseContext: 'Fuente: horarios\nDe 8 a 5.' };

function mockFetch(handler: (init?: RequestInit) => Response) {
  let calls = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls++;
    return handler(init);
  }) as typeof fetch;
  return () => calls;
}

test.afterEach(() => { globalThis.fetch = realFetch; });

test('sin clave configurada no se llama a la red', async () => {
  delete process.env.TEST_PROVIDER_KEY;
  const calls = mockFetch(() => new Response('{}', { status: 200 }));
  const result = await ask(input);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /Falta configurar TEST_PROVIDER_KEY/);
  assert.equal(result.ok ? null : result.retryable, false, 'una clave ausente no mejora reintentando');
  assert.equal(calls(), 0, 'no debe gastar una llamada sabiendo que falta la clave');
});

test('respuesta correcta: devuelve el contenido recortado', async () => {
  process.env.TEST_PROVIDER_KEY = 'clave-de-prueba';
  mockFetch(() => new Response(JSON.stringify({
    choices: [{ message: { content: '  De 8 a 5, de lunes a viernes.  ' } }],
  }), { status: 200 }));
  const result = await ask(input);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.answer, 'De 8 a 5, de lunes a viernes.');
});

test('respuesta vacía o sin choices cae al mensaje de "no encuentro"', async () => {
  process.env.TEST_PROVIDER_KEY = 'clave-de-prueba';
  for (const payload of ['{}', JSON.stringify({ choices: [] }), JSON.stringify({ choices: [{ message: {} }] })]) {
    mockFetch(() => new Response(payload, { status: 200 }));
    const result = await ask(input);
    assert.equal(result.ok, true, 'un 200 con cuerpo vacio es respuesta, no fallo');
    assert.match(result.ok ? result.answer : '', /No encuentro esa informacion/);
  }
});

test('cortado por length sin contenido es fallo reintentable, no un "no encuentro" falso', async () => {
  process.env.TEST_PROVIDER_KEY = 'clave-de-prueba';
  // Caso real: gpt-oss gastó los 2.200 tokens razonando y no escribió nada.
  mockFetch(() => new Response(JSON.stringify({
    choices: [{ message: { content: '', reasoning: '...' }, finish_reason: 'length' }],
  }), { status: 200 }));
  const result = await ask(input);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.retryable, true, 'el enrutador debe poder probar el reemplazo');
});

test('cortado por length CON contenido sigue siendo respuesta', async () => {
  process.env.TEST_PROVIDER_KEY = 'clave-de-prueba';
  mockFetch(() => new Response(JSON.stringify({
    choices: [{ message: { content: 'Paso 1: acérquese a…' }, finish_reason: 'length' }],
  }), { status: 200 }));
  const result = await ask(input);
  assert.equal(result.ok && result.answer, 'Paso 1: acérquese a…');
});

test('la escalera de estados: 401, 403, 429 y genérico', async () => {
  process.env.TEST_PROVIDER_KEY = 'clave-de-prueba';
  for (const status of [401, 403]) {
    mockFetch(() => new Response('denegado', { status }));
    const result = await ask(input);
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.kind, 'auth');
    assert.equal(result.ok ? null : result.retryable, false);
  }
  mockFetch(() => new Response('slow down', { status: 429 }));
  const quota = await ask(input);
  assert.equal(quota.ok ? null : quota.kind, 'quota');
  assert.equal(quota.ok ? null : quota.retryable, true, 'la saturacion se pasa sola');

  mockFetch(() => new Response('boom', { status: 500 }));
  const server = await ask(input);
  assert.equal(server.ok ? null : server.kind, 'unknown');
  assert.equal(server.ok ? null : server.retryable, true, 'un 5xx es del otro lado');

  mockFetch(() => new Response('mal pedido', { status: 400 }));
  const bad = await ask(input);
  assert.equal(bad.ok ? null : bad.retryable, false, 'un 4xx nuestro no mejora repitiendo');
});

test('un estado con mensaje propio del proveedor gana al genérico', async () => {
  process.env.TEST_PROVIDER_KEY = 'clave-de-prueba';
  mockFetch(() => new Response('demasiado grande', { status: 413 }));
  const result = await ask(input);
  assert.match(result.ok ? '' : result.message, /rechazo la solicitud por tamaño \(HTTP 413\)/);
  assert.equal(result.ok ? null : result.kind, 'size');
});

test('una excepción de red se traduce a mensaje, no se propaga', async () => {
  process.env.TEST_PROVIDER_KEY = 'clave-de-prueba';
  globalThis.fetch = (async () => { throw new Error('conexión rechazada'); }) as typeof fetch;
  const result = await ask(input);
  assert.equal(result.ok ? null : result.kind, 'network');
  assert.equal(result.ok ? null : result.retryable, true);
  assert.match(result.ok ? '' : result.message, /Proveedor devolvio un error: conexión rechazada/);
});

test('el cuerpo lleva el prompt del sistema y el mensaje del usuario', async () => {
  process.env.TEST_PROVIDER_KEY = 'clave-de-prueba';
  let sent: any;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  }) as typeof fetch;
  await ask(input);
  assert.equal(sent.messages.length, 2, 'system + user, como fija A-9');
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[0].content, /Fuente: horarios/);
  assert.equal(sent.messages[1].content, '¿cuál es el horario?');
  assert.equal(sent.temperature, 0.25, 'los campos propios del proveedor se respetan');
});

// ── parser CSV único (M-9) ──────────────────────────────────────────────────

test('csv: comillas escapadas y delimitador dentro de un campo', () => {
  const rows = parseCsvRows('a,"dice ""hola"", y se va",c');
  assert.deepEqual(rows, [['a', 'dice "hola", y se va', 'c']]);
});

test('csv: salto de línea dentro de un campo entrecomillado no parte la fila', () => {
  // Es el caso real del registro de interacciones: las respuestas del
  // asistente llevan saltos de línea.
  const rows = parseCsvRows('1;"linea uno\nlinea dos";fin', ';');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ['1', 'linea uno\nlinea dos', 'fin']);
});

test('csv: CRLF, líneas vacías al final y BOM de Excel', () => {
  const rows = parseCsvRows('a,b\r\n1,2\r\n\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);

  const records = parseCsvRecords('﻿id,titulo\r\n7,Acuerdo\r\n');
  assert.deepEqual(records, [{ id: '7', titulo: 'Acuerdo' }]);
  assert.ok(Object.keys(records[0])[0] === 'id', 'el BOM no se queda pegado a la primera clave');
});

test('csv: registros con columnas faltantes quedan como cadena vacía', () => {
  assert.deepEqual(parseCsvRecords('a,b,c\r\n1,2\r\n'), [{ a: '1', b: '2', c: '' }]);
});

test('csv: entradas vacías no revientan', () => {
  assert.deepEqual(parseCsvRecords(''), []);
  assert.deepEqual(parseCsvRecords('   '), []);
  assert.deepEqual(parseCsvRows(''), []);
  assert.deepEqual(parseCsvRow(''), []);
});

test('csv: parseCsvRow devuelve solo la primera fila', () => {
  assert.deepEqual(parseCsvRow('1;2;3', ';'), ['1', '2', '3']);
});
