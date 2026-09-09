import 'dotenv/config';
import assert from 'node:assert/strict';
import { embed, disposeEmbeddings } from '../src/services/embeddings.js';
import { cosine } from '../src/services/retrievalMath.js';
import { askTutor } from '../src/services/llm.js';
const [query] = await embed(['¿Cómo proteger a los trabajadores del sonido excesivo?'], 'query');
const vectors = await embed(['La exposición al ruido laboral requiere protección auditiva y medición acústica.', 'La preparación de una ensalada utiliza tomates y aceite.'], 'passage');
assert.ok(cosine(query, vectors[0]) > cosine(query, vectors[1]));
console.log('Semantic paraphrase test passed', vectors[0].length);
let failures = 0;
for (const provider of ['gemini', 'groq', 'deepseek'] as const) {
  if (!process.env[`${provider.toUpperCase()}_API_KEY`]?.trim()) { console.log(provider, 'SKIP: no API key'); continue; }
  const answer = await askTutor({ provider, message: '¿Cuál es el código del proyecto?', courseContext: '--- Fuente: prueba.txt · fragmento 1 ---\nEl código del proyecto es GEO-482.' });
  console.log(provider, answer);
  if (!/GEO-482/.test(answer)) failures++;
}

if (failures) process.exitCode = 1;
await disposeEmbeddings();
