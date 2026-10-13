/** Public ONNX artifacts only; build-time cache for isolated native regression tests. */
import { env, pipeline, AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';
env.cacheDir = '/app/.cache/retrieval/models';
const embedding = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
await embedding.dispose();
await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2');
const reranker = await AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
await reranker.dispose();
