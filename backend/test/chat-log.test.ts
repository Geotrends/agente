/**
 * Contrato del registro de interacciones tras M-7.
 *
 * El handler HTTP ya no espera a `logChatInteraction` antes de responder, así
 * que lo que hay que demostrar es que soltar el `await` NO rompe nada: las
 * escrituras se siguen serializando entre sí, cada fila conserva su id y
 * ninguna se pierde ni se pisa con otra.
 *
 * `CHAT_LOG_FILE` se fija antes de importar el módulo para no escribir en el
 * CSV real. El runner de node ejecuta cada archivo de prueba en su propio
 * proceso, así que esta variable no se filtra a las demás pruebas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'geobot-chatlog-'));
process.env.CHAT_LOG_FILE = path.join(directory, 'chat-interactions.csv');

const { logChatInteraction } = await import('../src/services/chatLog.js');

function rowsOf(csv: string): string[] {
  // Las filas pueden llevar saltos de línea dentro de campos entrecomillados,
  // así que no basta con split("\n"): se cuenta respetando las comillas.
  const rows: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    if (csv[i] === '"') quoted = !quoted;
    if (csv[i] === '\n' && !quoted) {
      rows.push(csv.slice(start, i).replace(/\r$/, ''));
      start = i + 1;
    }
  }
  if (start < csv.length) rows.push(csv.slice(start));
  return rows.filter(Boolean);
}

test('logChatInteraction: diez escrituras concurrentes conservan las diez filas y diez ids distintos', async () => {
  const total = 10;
  // Se lanzan todas a la vez y NO se espera cada una en orden: es exactamente
  // lo que hace ahora la ruta HTTP con `void logChatInteraction(...)`.
  const writes = Array.from({ length: total }, (_, i) => logChatInteraction({
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    question: `pregunta ${i}`,
    answer: `respuesta ${i}`,
    sources: [{ path: `doc-${i}.pdf`, title: `Documento ${i}` }],
    responseTimeMs: 100 + i,
  }));
  await Promise.all(writes);

  const csv = await fs.readFile(process.env.CHAT_LOG_FILE!, 'utf8');
  const rows = rowsOf(csv);
  // Una fila de cabecera más una por interacción.
  assert.equal(rows.length, total + 1, `se esperaban ${total} filas más la cabecera`);

  const ids = rows.slice(1).map(row => Number(row.split(';', 1)[0]));
  assert.equal(new Set(ids).size, total, 'ningún id se repite');
  assert.deepEqual([...ids].sort((a, b) => a - b), Array.from({ length: total }, (_, i) => i + 1),
    'los ids son consecutivos desde 1, sin huecos');

  // Y ninguna pregunta se perdió por el camino.
  for (let i = 0; i < total; i++) {
    assert.ok(csv.includes(`pregunta ${i}`), `falta la interacción ${i}`);
  }
});

test('logChatInteraction: un fallo de escritura no rompe la cadena para las siguientes', async () => {
  // Apuntar a una ruta imposible (un archivo dentro de un archivo) hace fallar
  // esa escritura; la siguiente, con una ruta válida, debe seguir funcionando.
  const valid = process.env.CHAT_LOG_FILE!;
  process.env.CHAT_LOG_FILE = path.join(valid, 'imposible', 'log.csv');
  await assert.rejects(logChatInteraction({
    provider: 'groq', model: 'm', question: 'falla', answer: 'x', sources: [], responseTimeMs: 1,
  }));

  process.env.CHAT_LOG_FILE = valid;
  await logChatInteraction({
    provider: 'groq', model: 'm', question: 'despues del fallo', answer: 'ok', sources: [], responseTimeMs: 1,
  });
  const csv = await fs.readFile(valid, 'utf8');
  assert.ok(csv.includes('despues del fallo'), 'la cadena sigue viva tras un fallo');
});

/* ─────────────── A-11: privacidad del registro ─────────────── */

test('A-11: los datos personales no llegan al disco', async () => {
  const file = path.join(directory, 'privacidad.csv');
  process.env.CHAT_LOG_FILE = file;
  await logChatInteraction({
    provider: 'groq', model: 'm',
    question: 'mi cédula es 43.256.789, ¿cómo pido el certificado?',
    answer: 'Escriba a tramites@envigado.gov.co',
    sources: [], responseTimeMs: 1,
  });
  const csv = await fs.readFile(file, 'utf8');
  assert.ok(!csv.includes('43.256.789'), 'la cédula quedó escrita en el CSV');
  assert.ok(!csv.includes('tramites@envigado.gov.co'), 'el correo quedó escrito en el CSV');
  assert.ok(csv.includes('[documento]') && csv.includes('[correo]'), 'debería quedar la etiqueta');
  // La pregunta sigue siendo útil para evaluación: se conserva todo lo demás.
  assert.ok(csv.includes('cómo pido el certificado'));
});

test('A-11: cada fila lleva fecha y hash de la pregunta', async () => {
  const file = path.join(directory, 'campos.csv');
  process.env.CHAT_LOG_FILE = file;
  await logChatInteraction({
    provider: 'groq', model: 'm', question: '¿Qué es el POT?', answer: 'x', sources: [], responseTimeMs: 1,
  });
  const csv = await fs.readFile(file, 'utf8');
  const [cabecera, fila] = rowsOf(csv);
  assert.match(cabecera, /^ID_chat;Fecha;.*;Pregunta_hash;/);
  const campos = fila.split(';');
  assert.ok(!Number.isNaN(Date.parse(campos[1].replace(/"/g, ''))), 'la fecha debe ser parseable');
  assert.match(campos[5], /^"[0-9a-f]{16}"$/, 'el hash debe ser hexadecimal de 16 caracteres');
});

test('A-11: migrar un CSV antiguo enmascara también lo ya guardado', async () => {
  const file = path.join(directory, 'heredado.csv');
  // Formato anterior a A-11, con una cédula ya escrita en el histórico.
  await fs.writeFile(file,
    'ID_chat;LLM;Modelo;Prompt_version;Pregunta;Respuesta;Fuentes;Tiempo_respuesta_ms\r\n' +
    '1;"groq";"m";"1";"mi cedula 1032456789";"su correo es ana@x.gov.co";"";"10"\r\n', 'utf8');
  process.env.CHAT_LOG_FILE = file;
  await logChatInteraction({
    provider: 'groq', model: 'm', question: 'nueva', answer: 'ok', sources: [], responseTimeMs: 1,
  });
  const csv = await fs.readFile(file, 'utf8');
  assert.ok(!csv.includes('1032456789'), 'la cédula del histórico sigue en el archivo');
  assert.ok(!csv.includes('ana@x.gov.co'), 'el correo del histórico sigue en el archivo');
  assert.ok(csv.includes('[documento]'), 'el histórico debería quedar enmascarado');
  // Y la interacción histórica no se pierde: sigue estando su id.
  assert.match(csv, /^1;/m);
});

test('A-11: la retención descarta lo viejo y conserva lo reciente', async () => {
  const { purgeExpiredRows } = await import('../src/services/chatLog.js');
  const cabecera = 'ID_chat;Fecha;LLM;Modelo;Prompt_version;Pregunta_hash;Pregunta;Respuesta;Fuentes;Tiempo_respuesta_ms\r\n';
  const viejo = new Date('2020-01-01T00:00:00Z').toISOString();
  const nuevo = new Date('2026-09-19T00:00:00Z').toISOString();
  const csv = cabecera +
    `1;"${viejo}";"groq";"m";"1";"aaaa";"vieja";"x";"";"1"\r\n` +
    `2;"${nuevo}";"groq";"m";"1";"bbbb";"reciente";"x";"";"1"\r\n`;
  const purged = purgeExpiredRows(csv, Date.parse('2026-09-19T12:00:00Z'), 90);
  assert.ok(!purged.includes('vieja'), 'la fila vencida debería desaparecer');
  assert.ok(purged.includes('reciente'), 'la fila reciente debe conservarse');
});

test('A-11: una fila sin fecha legible no se borra por no poder fecharla', async () => {
  const { purgeExpiredRows } = await import('../src/services/chatLog.js');
  const cabecera = 'ID_chat;Fecha;LLM;Modelo;Prompt_version;Pregunta_hash;Pregunta;Respuesta;Fuentes;Tiempo_respuesta_ms\r\n';
  const csv = cabecera + `1;"";"groq";"m";"1";"aaaa";"sin fecha";"x";"";"1"\r\n`;
  assert.equal(purgeExpiredRows(csv, Date.now(), 1), csv);
});

test.after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
