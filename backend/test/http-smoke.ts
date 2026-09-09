// Integration test: real extraction, embeddings, BM25 and RRF; mocked generation transport.
import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geobot-http-'));
process.env.GEOTRENDS_DOCUMENTS_ROOT = root;
process.env.GROQ_API_KEY = 'integration-test';
process.env.GEMINI_API_KEY = 'integration-test';
delete process.env.DEEPSEEK_API_KEY;
await fs.mkdir(path.join(root, 'Seguridad'));
await fs.mkdir(path.join(root, 'Cocina'));
await fs.writeFile(path.join(root, 'Seguridad', 'trabajo.txt'), 'El proyecto GEO-482 requiere protección auditiva para reducir la exposición al ruido laboral.');
await fs.writeFile(path.join(root, 'Cocina', 'receta.txt'), 'La ensalada lleva tomate, lechuga y aceite.');
const { default: router } = await import('../src/routes/chat.js');
const app = express(); app.use(express.json()); app.use('/api', router);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address() as { port: number };
const realFetch = globalThis.fetch;
let calls = 0;
let failGroq = false;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.groq.com/')) {
    if (failGroq) return new Response('quota', { status: 429 });
    const payload = JSON.parse(String(init?.body));
    assert.match(payload.messages[0].content, /Fuente: Seguridad\/trabajo.txt/);
    assert.match(payload.messages[0].content, /GEO-482/);
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Proyecto GEO-482 (fuente: Seguridad/trabajo.txt, fragmento 1).' } }] }), { status: 200 });
  }
  if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
    assert.match(String(init?.body), /GEO-482/);
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'GEO-482 (fuente: Seguridad/trabajo.txt, fragmento 1).' }] } }] }), { status: 200 });
  }
  return realFetch(url, init);
};
const chat = (body: unknown) => realFetch(`http://127.0.0.1:${address.port}/api/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
try {
  assert.equal((await chat({})).status, 400);
  assert.equal((await chat({ message: 'hola', provider: 'invalid' })).status, 400);
  const response = await chat({ message: '¿Cómo proteger a los trabajadores del sonido excesivo?', provider: 'groq' });
  assert.equal(response.status, 200);
  const data = await response.json() as any;
  assert.match(data.answer, /GEO-482/);
  assert.equal(data.meta.sources[0].path, 'Seguridad/trabajo.txt');
  assert.equal(data.meta.retrieval.method, 'bm25+cosine+rrf');
  assert.equal(calls, 1);
  const filtered = await chat({ message: 'protección auditiva', provider: 'groq', folder: 'Seguridad' });
  const filteredData = await filtered.json() as any;
  assert.ok(filteredData.meta.sources.every((s: any) => s.path.startsWith('Seguridad/')));
  // Changed and removed documents must be reflected in the next query.
  await fs.writeFile(path.join(root, 'Seguridad', 'trabajo.txt'), 'GEO-482: la protección auditiva actualizada exige inspección diaria.');
  await fs.unlink(path.join(root, 'Cocina', 'receta.txt'));
  const updated = await (await chat({ message: 'inspección diaria', provider: 'groq' })).json() as any;
  assert.equal(updated.meta.retrieval.documents, 1);
  assert.equal(updated.meta.sources.length, 1);
  failGroq = true;
  const fallback = await (await chat({ message: 'protección auditiva', provider: 'auto' })).json() as any;
  assert.equal(fallback.meta.provider, 'gemini');
  assert.match(fallback.answer, /GEO-482/);
  console.log('HTTP integration passed: unscoped chat, real hybrid retrieval, sources, filtering, invalid input and index refresh.');
} finally {
  const { disposeEmbeddings } = await import("../src/services/embeddings.js");
  await disposeEmbeddings();
  globalThis.fetch = realFetch;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await fs.rm(root, { recursive: true });
}
