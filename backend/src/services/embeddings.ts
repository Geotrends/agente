import path from 'node:path';
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export const embeddingModel = 'Xenova/multilingual-e5-small';
export const retrievalCacheDir = path.resolve(process.env.RETRIEVAL_CACHE_DIR || '.cache/retrieval');
env.cacheDir = path.join(retrievalCacheDir, 'models');
let extractor: Promise<FeatureExtractionPipeline> | undefined;

export async function embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]> {
  extractor ??= pipeline('feature-extraction', embeddingModel, { dtype: 'q8', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } })
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
