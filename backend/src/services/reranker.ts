import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers';
import path from 'node:path';
import { retrievalCacheDir } from './embeddings.js';

export const rerankerModel = 'Xenova/ms-marco-MiniLM-L-6-v2';

env.cacheDir = path.join(retrievalCacheDir, 'models');

type Reranker = {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
};

type RerankInput = {
  id: number;
  snippet: string;
};

let reranker: Promise<Reranker> | undefined;

async function loadReranker(): Promise<Reranker> {
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(rerankerModel),
    AutoModelForSequenceClassification.from_pretrained(rerankerModel, {
      dtype: 'q8',
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 }
    })
  ]);
  return { tokenizer, model };
}

export async function rerank(query: string, candidates: RerankInput[]): Promise<Map<number, number>> {
  if (!candidates.length) return new Map();

  reranker ??= loadReranker().catch(error => {
    reranker = undefined;
    throw error;
  });

  const { tokenizer, model } = await reranker;
  const inputs = tokenizer(
    candidates.map(() => query),
    {
      text_pair: candidates.map(candidate => candidate.snippet),
      padding: true,
      truncation: true
    }
  );
  const outputs = await model(inputs);
  const logits = outputs.logits.tolist() as number[][];
  if (logits.length !== candidates.length || logits.some(logit => !Number.isFinite(logit[0]))) {
    throw new Error('El reranker devolvio una salida invalida');
  }

  return new Map(candidates.map((candidate, index) => [candidate.id, logits[index][0]]));
}

export async function disposeReranker(): Promise<void> {
  const pending = reranker;
  reranker = undefined;
  if (pending) (await pending).model.dispose();
}
