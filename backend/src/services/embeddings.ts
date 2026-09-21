import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { setting } from './settings.js';

export const embeddingModel = 'Xenova/multilingual-e5-small';

/**
 * Versión del runtime que produce los vectores, para la firma del índice (A-10).
 *
 * La firma incluía el NOMBRE del modelo pero no la versión de la librería que
 * lo ejecuta, y eso deja pasar en silencio el peor caso posible: subir
 * `@huggingface/transformers` cambia los vectores sin invalidar nada, así que
 * las consultas se embeben con el modelo nuevo y se comparan contra pasajes
 * embebidos con el viejo. Medido al pasar de 3.8.1 a 4.3.0 sobre el corpus
 * real: el coseno entre el vector viejo y el nuevo del MISMO texto es 0,9967
 * de mediana (mínimo 0,9955). No es ruido —es una deriva sistemática que
 * reordena los empates del top-8— y no habría disparado ninguna alarma.
 *
 * Se lee del package.json en vez de fijarse a mano justamente porque una
 * constante que hay que acordarse de subir es la que nadie sube.
 */
export const embeddingRuntime = `transformers@${resolveTransformersVersion()}`;

function resolveTransformersVersion(): string {
  try {
    const entry = fileURLToPath(import.meta.resolve('@huggingface/transformers'));
    // Desde el archivo de entrada, subir hasta el package.json del paquete.
    for (let dir = path.dirname(entry), i = 0; i < 6; i++, dir = path.dirname(dir)) {
      const manifest = path.join(dir, 'package.json');
      if (!fsSync.existsSync(manifest)) continue;
      const { name, version } = JSON.parse(fsSync.readFileSync(manifest, 'utf8'));
      if (name === '@huggingface/transformers' && version) return String(version);
    }
  } catch { /* se cae al valor desconocido, abajo */ }
  // Nunca debería ocurrir; si ocurre, es preferible una firma estable y un
  // aviso a inventar una versión que haga reconstruir el índice en cada
  // arranque.
  console.warn('[embeddings] No se pudo determinar la versión de @huggingface/transformers; la firma del índice no la distinguirá.');
  return 'desconocida';
}

export const retrievalCacheDir = path.resolve(process.env.RETRIEVAL_CACHE_DIR || '.cache/retrieval');
env.cacheDir = path.join(retrievalCacheDir, 'models');
let extractor: Promise<FeatureExtractionPipeline> | undefined;

// El servidor en vivo deja esto en 2 para no acaparar CPU mientras atiende
// chats; el script de indexado offline (indexDocuments.ts) lo sube antes de
// llamar a embed() por primera vez, ya que en ese momento no compite con
// ninguna otra peticion.
const intraOpNumThreads = setting('embeddingIntraOpThreads');

export async function embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]> {
  extractor ??= pipeline('feature-extraction', embeddingModel, { dtype: 'q8', session_options: { intraOpNumThreads, interOpNumThreads: 1 } })
    .catch(error => { extractor = undefined; throw error; });
  const model = await extractor;
  const output = await model(texts.map(t => `${kind}: ${t}`), { pooling: 'mean', normalize: true });
  return output.tolist() as number[][];
}

export async function disposeEmbeddings(): Promise<void> {
  const pending = extractor;
  extractor = undefined;
  if (pending) await (await pending).dispose();
}
