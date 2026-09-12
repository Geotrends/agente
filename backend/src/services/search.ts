import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDocumentsRootPath, listCourseDocuments, readDocumentContent, safeResolveUnderRoot } from './context.js';
import { DOCUMENT_PREPROCESSOR_VERSION } from './documentPreprocessor.js';
import { embed, embeddingModel, retrievalCacheDir } from './embeddings.js';
import { BM25, chunkText, cosine, reciprocalRankFusion } from './retrievalMath.js';
import { rerank } from './reranker.js';

type Chunk = { path: string; chunk: number; snippet: string; vector: number[] };
type Index = { signature: string; chunks: Chunk[]; bm25: BM25; documents: number };
let current: Index | undefined;
let building: Promise<Index> | undefined;
export const retrievalStatus = { state: 'idle', completed: 0, total: 0, error: '' };

async function buildIndex(): Promise<Index> {
  const root = getDocumentsRootPath();
  const inventory = await listCourseDocuments('');
  const files = await Promise.all(inventory.map(async item => {
    const full = safeResolveUnderRoot(root, item.id)!;
    const stat = await fs.stat(full);
    return { ...item, full, stamp: `${stat.mtimeMs}:${stat.size}` };
  }));
  const signature = createHash('sha256').update(JSON.stringify([root, files.map(f => [f.id, f.stamp]), embeddingModel, DOCUMENT_PREPROCESSOR_VERSION, 'chunks-1000-150-v1'])).digest('hex');
  if (current?.signature === signature) return current;
  retrievalStatus.state = 'indexing'; retrievalStatus.completed = 0; retrievalStatus.total = files.length;
  retrievalStatus.error = '';
  await fs.mkdir(retrievalCacheDir, { recursive: true });
  const chunks: Chunk[] = [];
  for (const file of files) {
    const key = createHash('sha256').update(JSON.stringify([root, file.id, file.stamp, embeddingModel, DOCUMENT_PREPROCESSOR_VERSION, 'v1'])).digest('hex');
    const cacheFile = path.join(retrievalCacheDir, `${key}.json`);
    let entries: Chunk[] | undefined;
    try {
      const saved = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Chunk[];
      if (Array.isArray(saved) && saved.every(c => c.path === file.id && typeof c.snippet === 'string' && c.vector?.length === 384 && c.vector.every(Number.isFinite))) entries = saved;
    } catch { /* New or changed document. */ }
    if (!entries) {
      const text = await readDocumentContent(file.full);
      entries = [];
      const pieces = chunkText(text);
      for (let i = 0; i < pieces.length; i += 8) {
        const batch = pieces.slice(i, i + 8);
        const vectors = await embed(batch.map(s => `${file.id}\n${s}`), 'passage');
        entries.push(...batch.map((snippet, j) => ({ path: file.id, chunk: i + j + 1, snippet, vector: vectors[j] })));
      }
      if (entries.length) {
        await fs.writeFile(`${cacheFile}.tmp`, JSON.stringify(entries));
        await fs.rename(`${cacheFile}.tmp`, cacheFile);
      }
    }
    chunks.push(...entries);
    retrievalStatus.completed++;
    console.log(`[retrieval] ${retrievalStatus.completed}/${files.length} documents, ${chunks.length} chunks`);
  }
  current = { signature, chunks, documents: files.length, bm25: new BM25(chunks.map(c => `${c.path}\n${c.snippet}`)) };
  retrievalStatus.state = 'ready';
  return current;
}

export function prepareIndex(): Promise<Index> {
  if (!building) building = buildIndex().catch(error => {
    retrievalStatus.state = 'error'; retrievalStatus.error = 'No se pudo preparar el índice de embeddings. Revisa la conexión y los registros del backend.';
    throw error;
  }).finally(() => { building = undefined; });
  return building;
}

export async function hybridSearch(query: string, folderPrefix?: string, documentId?: string) {
  const index = await prepareIndex();
  const eligible = (id: number) => {
    const p = index.chunks[id].path;
    return (!folderPrefix || p === folderPrefix || p.startsWith(`${folderPrefix}/`)) && (!documentId || p === documentId);
  };
  if (!index.chunks.length) return { hits: [], documents: index.documents, chunks: 0, method: 'bm25+cosine+rrf' };
  const [vector] = await embed([query], 'query');
  const lexical = index.bm25.search(query).filter(r => eligible(r.id)).slice(0, 40);
  const semantic = index.chunks.map((c, id) => ({ id, score: cosine(vector, c.vector) }))
    .filter(r => eligible(r.id)).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 40);
  const fused = reciprocalRankFusion([lexical, semantic]);
  const candidates = fused.slice(0, 16);
  let ranked: Array<typeof candidates[number] & { rerank?: number }> = candidates;
  let method = 'bm25+cosine+rrf';
  try {
    const rerankedScores = await rerank(query, candidates.map(r => ({ id: r.id, snippet: index.chunks[r.id].snippet })));
    ranked = candidates
      .map(r => ({ ...r, rerank: rerankedScores.get(r.id) }))
      .sort((a, b) => (b.rerank ?? -Infinity) - (a.rerank ?? -Infinity) || a.id - b.id)
      .slice(0, 8);
    method = 'bm25+cosine+rrf+ms-marco';
  } catch (error) {
    console.warn('[retrieval] Reranker no disponible; se usa RRF:', error);
    ranked = candidates.slice(0, 8);
  }
  const hits = ranked.map(r => {
    const { vector: _, ...chunk } = index.chunks[r.id];
    return { ...chunk, score: r.score, bm25: lexical.find(x => x.id === r.id)?.score ?? 0,
      semantic: semantic.find(x => x.id === r.id)?.score ?? 0,
      ...(typeof r.rerank === 'number' ? { rerank: r.rerank } : {}) };
  });
  return { hits, documents: index.documents, chunks: index.chunks.length, method };
}
