import 'dotenv/config';
import assert from 'node:assert/strict';
import { embed, disposeEmbeddings } from '../src/services/embeddings.js';
import { cosine } from './oracles.js';
import { askTutor } from '../src/services/llm.js';
const [query] = await embed(['¿Cómo proteger a los trabajadores del sonido excesivo?'], 'query');
const vectors = await embed(['La exposición al ruido laboral requiere protección auditiva y medición acústica.', 'La preparación de una ensalada utiliza tomates y aceite.'], 'passage');
assert.ok(cosine(query, vectors[0]) > cosine(query, vectors[1]));
console.log('Semantic paraphrase test passed', vectors[0].length);
let failures = 0;
for (const provider of ['gemini', 'groq', 'deepseek', 'openai'] as const) {
  if (!process.env[`${provider.toUpperCase()}_API_KEY`]?.trim()) { console.log(provider, 'SKIP: no API key'); continue; }
  const result = await askTutor({ provider, message: '¿Cuál es el código del proyecto?', courseContext: '--- Fuente: prueba.txt · fragmento 1 ---\nEl código del proyecto es GEO-482.' });
  // El fallo ya viene distinguido en el tipo (A-4), no hay que adivinarlo por
  // el texto: aquí eso significa que un proveedor caído se reporta como tal.
  if (!result.ok) {
    console.log(provider, `FALLO (${result.kind}, reintentable=${result.retryable}):`, result.message);
    failures++;
    continue;
  }
  console.log(provider, result.answer);
  if (!/GEO-482/.test(result.answer)) failures++;
}

if (failures) process.exitCode = 1;
await disposeEmbeddings();
