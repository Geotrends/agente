import fs from 'node:fs/promises';
import { setting } from "./settings.js";
import path from 'node:path';
import v8 from 'node:v8';
import { createHash } from 'node:crypto';
import { getDocumentsRootPath, listCourseDocuments, readDocumentContent, safeResolveUnderRoot } from './context.js';
import { DOCUMENT_PREPROCESSOR_VERSION } from './documentPreprocessor.js';
import { chunkDocument, type DocumentChunk } from './chunking.js';
import { embed, embeddingModel, embeddingRuntime, retrievalCacheDir } from './embeddings.js';
import { BM25, jaccard, reciprocalRankFusion, shingles, topKByDot, type WeightedQuery } from './retrievalMath.js';
import { rerank } from './reranker.js';
import { loadSourceMetadata, type SourceMetadata } from './sourceMetadata.js';
import { loadSnapshot, pruneSnapshots, rootScope, saveSnapshot } from './indexSnapshot.js';

/**
 * Versión de la fragmentación, en la firma del índice Y en la clave de caché
 * por archivo.
 *
 * Tiene que estar en las DOS. Estaban separadas —la firma decía
 * `chunks-1000-150-v1` y la clave por archivo un `'v2'` suelto— y cambiar solo
 * la primera al implementar M-3/M-4/M-5 habría reconstruido el índice sirviendo
 * los fragmentos VIEJOS desde la caché por archivo: la fragmentación
 * estructural no habría llegado nunca al índice, sin que nada fallara.
 */
const CHUNKING_VERSION = 'chunks-structural-1000-150-v2';

/** Dimensión de Xenova/multilingual-e5-small. */
export const EMBEDDING_DIMENSIONS = 384;

/** Forma en disco de `.cache/retrieval/<clave>.json`. No cambia con F1. */
type CachedChunk = { path: string; chunk: number; snippet: string; vector: number[]; page?: number };

/**
 * Contenido real del archivo de caché por documento. `failure` solo aparece
 * cuando `entries` está vacío: es lo que permite que un documento sin texto
 * siga reportando SU motivo (OCR fallido, extensión no soportada, etc.) en
 * reconstrucciones futuras que aciertan la caché, en vez de perderlo la
 * primera vez que no se vuelve a extraer desde cero (hallazgo A-3).
 */
type CacheEntry = { entries: CachedChunk[]; failure?: { reason: string; detail: string } };

/**
 * Índice en memoria, como arreglos paralelos en vez de un objeto por fragmento.
 *
 * Antes eran 181.339 objetos `{ path, chunk, snippet, vector: number[] }`, y los
 * vectores solos ocupaban ~545 MB del heap de V8 —8 bytes por componente, más la
 * cabecera de cada arreglo—, todo ello grafo que el recolector tiene que
 * recorrer en cada GC mayor.
 *
 * Ahora los 384 componentes de cada fragmento viven consecutivos dentro de un
 * único `Float32Array`. Son 4 bytes por componente (266 MB) y, sobre todo, un
 * `ArrayBuffer` NO cuenta contra el límite de old-space ni lo visita el
 * recolector: el cambio de ubicación vale tanto como el de tamaño.
 *
 * Las rutas se repiten ~32 veces de media (181.339 fragmentos sobre 5.684
 * documentos con texto), así que se internan en `docPaths` y cada fragmento
 * guarda un índice de 4 bytes en lugar de una referencia a string.
 */
type Index = {
  signature: string;
  /** Número de fragmentos. Antes era `chunks.length`. */
  count: number;
  /** Rutas únicas, en el orden en que se indexaron los documentos. */
  docPaths: string[];
  /** fragmento → posición en `docPaths`. */
  chunkDoc: Int32Array;
  /** Número de fragmento dentro de su documento (base 1). */
  chunkNo: Int32Array;
  /** Página donde empieza el fragmento; 0 si el formato no tiene páginas (M-4). */
  chunkPage: Int32Array;
  snippets: string[];
  /** `count * EMBEDDING_DIMENSIONS` componentes contiguos, normalizados. */
  vectors: Float32Array;
  bm25: BM25;
  documents: number;
  sourceMetadata: Map<string, SourceMetadata>;
};

/**
 * Copia un vector normalizándolo a norma 1.
 *
 * El pipeline de embeddings ya devuelve vectores unitarios (`normalize: true`,
 * comprobado: norma 1,000000), pero normalizar al cargar cuesta una sola pasada
 * y garantiza la premisa de la que depende `topKByDot` para usar producto punto
 * en lugar de coseno, aunque el modelo cambie en el futuro.
 */
function writeUnitVector(target: Float32Array, at: number, source: ArrayLike<number>): void {
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) norm += source[i] * source[i];
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) target[at + i] = source[i] * scale;
}

function toUnitVector(source: ArrayLike<number>): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS);
  writeUnitVector(vector, 0, source);
  return vector;
}
let current: Index | undefined;
let building: Promise<Index> | undefined;
let lastRevalidation = 0;

/**
 * Estados del índice:
 *   idle       → todavía no se ha intentado construir
 *   indexing   → construyendo y NO hay nada servible: las consultas reciben 503
 *   refreshing → reconstruyendo pero el índice anterior sigue servible
 *   ready      → servible, sin trabajo en curso
 *   error      → el primer build falló y no hay nada que servir
 */
export const retrievalStatus = {
  state: 'idle', completed: 0, total: 0, error: '',
  /** Fin de la última comprobación de cambios (epoch ms; 0 = nunca). */
  lastCheckedAt: 0,
  /** Documentos indexables de los que no se pudo extraer texto (hallazgo A-3). */
  skipped: 0,
};

/**
 * Cada cuánto se comprueba si el corpus cambió.
 *
 * Esa comprobación (recorrido del árbol + 6.295 `fs.stat` + firma) cuesta unos
 * 50 ms y antes se pagaba en CADA consulta, porque `prepareIndex` limpiaba
 * `building` al terminar y `hybridSearch` volvía a lanzar `buildIndex` entero.
 * Ahora ocurre en segundo plano con este TTL.
 *
 * `INDEX_REVALIDATE_MS=0` restaura el comportamiento anterior —comprobar en
 * cada consulta, esperando el resultado— que es lo que necesitan las pruebas
 * que modifican documentos y consultan de inmediato.
 */
function revalidateMs(): number {
  return setting('indexRevalidateMs');
}

/**
 * Fracción del heap por encima de la cual NO se lanza una reconstrucción en
 * segundo plano.
 *
 * Una reconstrucción mantiene vivo el índice anterior mientras arma el nuevo
 * (`buildIndex` solo reemplaza `current` al final), así que cuesta más memoria
 * que el índice en reposo. Medido con `npm run probe:rebuild`:
 *
 *   antes de F1   más de 4.144 MB → el proceso moría
 *   tras F1       2.061 → 2.708 MB de pico
 *   tras F2         532 → 1.339 MB de pico
 *
 * El sobrecoste es más aditivo que proporcional: ronda los 800 MB de material
 * transitorio (caché parseada, búferes de postings) con independencia de lo que
 * ocupe el índice en reposo. Con el índice actual la guarda no llega a
 * dispararse; queda como red por si el corpus crece mucho. Si se supera el
 * umbral, prefiere servir datos algo viejos antes que arriesgar un OOM
 * desatendido: lo registra y lo reintenta en el siguiente TTL.
 */
function backgroundRebuildBudget(): number {
  return setting('indexRevalidateMaxHeapFraction');
}

function heapIsTooFullToRebuild(): boolean {
  const { heap_size_limit: limit, used_heap_size: used } = v8.getHeapStatistics();
  return used / limit > backgroundRebuildBudget();
}

/**
 * Logit mínimo del reranker (cross-encoder ms-marco) para que un candidato
 * sobreviva al recorte a 8 (hallazgo A-5). Por debajo de este umbral se
 * descarta en vez de enviarse al LLM como si fuera evidencia real.
 *
 * Sin `MIN_RERANK_SCORE` en el entorno, NO se filtra nada (equivalente a
 * `-Infinity`): comportamiento idéntico al anterior a A-5. Medido contra el
 * reranker real antes de fijar cualquier valor por defecto: una pregunta
 * parafraseada SIN traslape de vocabulario con el documento correcto puntúa
 * tan negativo (-10.4) como una pregunta genuinamente fuera de alcance
 * (-11.2..-11.24). Un "default conservador" de 0 —lo que proponía el plan
 * antes de medir— fabricaría abstenciones falsas en preguntas legítimas con
 * poco traslape léxico. El valor real se elige con `npm run eval:retrieval
 * -- --sweep=...` contra el conjunto dorado de A-12 sobre el corpus
 * completo, no adivinando sobre un par de ejemplos.
 */
function minRerankScore(): number {
  const raw = Number(process.env.MIN_RERANK_SCORE);
  return Number.isFinite(raw) ? raw : -Infinity;
}

/**
 * Ordena por logit del reranker y descarta lo que no llega al umbral, antes
 * de recortar a 8. Separada de `hybridSearch` para poder probarla con
 * puntajes fijos (test/relevance-threshold.test.ts) sin cargar el modelo real.
 */
export function rankAndFilterByRelevance<T extends { id: number; rerank?: number }>(
  candidates: T[], minScore: number, limit = 8,
): T[] {
  return candidates
    .slice()
    .sort((a, b) => (b.rerank ?? -Infinity) - (a.rerank ?? -Infinity) || a.id - b.id)
    .filter(r => (r.rerank ?? -Infinity) >= minScore)
    .slice(0, limit);
}

/**
 * Cuántos fragmentos del mismo documento pueden ocupar el top-k (hallazgo A-6).
 *
 * Nada impedía que los 8 fragmentos finales salieran del mismo archivo, y con
 * `chunkText(texto, 1000, 150)` dos fragmentos consecutivos comparten 150
 * caracteres por construcción: el presupuesto de contexto se gastaba repitiendo
 * el mismo pasaje mientras la evidencia de otro documento quedaba fuera. Eso
 * además hace imposible la regla 6 del prompt —«si dos fuentes se contradicen,
 * señala la contradicción»—, que necesita más de una fuente para aplicarse.
 */
function maxPerDocument(): number {
  return setting('retrievalMaxPerDocument');
}

/**
 * A partir de qué similitud de Jaccard dos fragmentos se consideran el mismo
 * contenido. Calibrado contra el corpus real, no a ojo: ver el comentario de
 * `RETRIEVAL_NEAR_DUPLICATE_JACCARD` en .env.example.
 */
function nearDuplicateJaccard(): number {
  return setting('retrievalNearDuplicateJaccard');
}

/**
 * Cuántos candidatos de la fusión RRF llegan al reranker (hallazgo A-1).
 *
 * Es la única palanca de rendimiento que queda sin tocar la estructura del
 * índice: el cross-encoder es el 82 % del tiempo de una consulta y su costo
 * escala con el tamaño del lote, así que mandarle menos pares es una ganancia
 * directa —siempre que el recall aguante, que es justo lo que decide el
 * barrido de `npm run eval:retrieval`—. Mandar menos candidatos también deja
 * menos de donde elegir a la diversificación de A-6, así que los dos números
 * se calibran juntos, no por separado.
 */
function rerankCandidates(): number {
  return setting('rerankCandidates');
}

/**
 * Reparte el top-k entre documentos distintos y descarta casi-duplicados
 * (hallazgo A-6), sin devolver nunca menos resultados de los que habría sin
 * diversificar.
 *
 * Ese "sin devolver menos" es la parte que importa: si TODOS los candidatos
 * vienen del mismo documento —que suele significar que la respuesta está de
 * verdad ahí—, recortar por el tope dejaría al modelo con dos fragmentos en
 * vez de ocho, que es peor que el problema que se quería arreglar. Por eso hay
 * dos pasadas: la primera prefiere variedad, la segunda rellena el cupo con lo
 * descartado, en su orden de relevancia original. La diversificación solo
 * cambia algo cuando existen alternativas; cuando no, el resultado es idéntico
 * al de antes.
 */
export function diversify<T extends { id: number }>(
  ranked: T[],
  documentOf: (item: T) => string,
  snippetOf: (item: T) => string,
  options: { limit: number; maxPerDocument: number; nearDuplicateJaccard: number },
): T[] {
  const kept: T[] = [];
  const keptShingles: Array<Set<string>> = [];
  const skipped: T[] = [];
  const perDocument = new Map<string, number>();

  for (const item of ranked) {
    if (kept.length >= options.limit) { skipped.push(item); continue; }
    const document = documentOf(item);
    const used = perDocument.get(document) ?? 0;
    if (used >= options.maxPerDocument) { skipped.push(item); continue; }
    const fingerprint = shingles(snippetOf(item));
    if (keptShingles.some(other => jaccard(fingerprint, other) >= options.nearDuplicateJaccard)) {
      skipped.push(item); continue;
    }
    kept.push(item);
    keptShingles.push(fingerprint);
    perDocument.set(document, used + 1);
  }

  for (const item of skipped) {
    if (kept.length >= options.limit) break;
    kept.push(item);
  }
  return kept;
}

async function buildIndex(): Promise<Index> {
  const root = getDocumentsRootPath();
  const metadataCatalog = await loadSourceMetadata(root);
  const inventory = await listCourseDocuments('');
  const files = await Promise.all(inventory.map(async item => {
    const full = safeResolveUnderRoot(root, item.id)!;
    const stat = await fs.stat(full);
    return { ...item, full, stamp: `${stat.mtimeMs}:${stat.size}` };
  }));
  const signature = createHash('sha256').update(JSON.stringify([
    root, files.map(f => [f.id, f.stamp]), metadataCatalog.signature,
    embeddingModel, embeddingRuntime, DOCUMENT_PREPROCESSOR_VERSION, CHUNKING_VERSION
  ])).digest('hex');
  if (current?.signature === signature) return current;

  // El volcado binario de una construcción anterior evita repetirla entera.
  const restored = await loadSnapshot(retrievalCacheDir, root, signature);
  if (restored) {
    current = {
      ...restored,
      sourceMetadata: metadataCatalog.byPath,
    };
    retrievalStatus.state = 'ready';
    retrievalStatus.completed = retrievalStatus.total = files.length;
    console.log(`[retrieval] Índice restaurado del snapshot: ${restored.documents} documentos, ${restored.count} fragmentos.`);
    return current;
  }

  // Si ya hay un índice servible, la reconstrucción no debe dejar al servicio
  // devolviendo 503: se sigue atendiendo con el anterior hasta el intercambio.
  retrievalStatus.state = current ? 'refreshing' : 'indexing';
  retrievalStatus.completed = 0; retrievalStatus.total = files.length;
  retrievalStatus.error = '';
  await fs.mkdir(retrievalCacheDir, { recursive: true });

  // Acumuladores en arreglos paralelos. Los vectores se juntan por documento y
  // se concatenan al final en un único búfer: así no hace falta conocer el total
  // de fragmentos por adelantado ni sobredimensionar el búfer.
  const docPaths: string[] = [];
  const chunkDocList: number[] = [];
  const chunkNoList: number[] = [];
  const chunkPageList: number[] = [];
  const snippets: string[] = [];
  const vectorParts: Float32Array[] = [];
  const withoutText: Array<{ path: string; reason: string; detail: string }> = [];
  let count = 0;

  // El nombre lleva delante el identificador de la raíz del corpus, igual que
  // el snapshot. No es cosmético: sin ese prefijo, la purga de M-11 no puede
  // saber qué entradas pertenecen a ESTE corpus y borra las de los demás.
  // Ocurrió de verdad —una prueba de integración con un corpus de 2 documentos
  // se llevó por delante 5 GB de caché del corpus real— y es exactamente la
  // clase de daño silencioso que una caché nunca debe poder causar.
  const cachePrefix = `${rootScope(root)}-`;
  const cacheFileFor = (file: typeof files[number]) => {
    // 'v2': el archivo pasó de ser un arreglo suelto a { entries, failure? }.
    const key = createHash('sha256').update(JSON.stringify([root, file.id, file.stamp, embeddingModel, embeddingRuntime, DOCUMENT_PREPROCESSOR_VERSION, CHUNKING_VERSION])).digest('hex');
    return path.join(retrievalCacheDir, `${cachePrefix}${key}.json`);
  };
  const loadCached = async (file: typeof files[number]): Promise<CacheEntry | undefined> => {
    try {
      const saved = JSON.parse(await fs.readFile(cacheFileFor(file), 'utf8')) as CacheEntry;
      if (!saved || !Array.isArray(saved.entries)) return undefined;
      if (saved.entries.every(c => c.path === file.id && typeof c.snippet === 'string' && c.vector?.length === EMBEDDING_DIMENSIONS && c.vector.every(Number.isFinite))) return saved;
    } catch { /* New or changed document. */ }
    return undefined;
  };

  // Extraer texto (potencialmente con OCR via subproceso, lento) es
  // I/O/subproceso-bound; embeber es CPU-bound en este mismo proceso. Se
  // adelanta la extraccion de los proximos archivos mientras se embebe el
  // actual, en vez de pagar ambos costos en serie por archivo.
  type Prefetched = { cached: CacheEntry } | { pieces: DocumentChunk[]; failure?: { reason: string; detail: string } };
  // Cada posición se libera en cuanto se consume: si no, las 6.295 promesas
  // resueltas mantienen vivo TODO el corpus parseado —incluidos los vectores
  // `number[]` de la caché, ~545 MB— durante toda la construcción, además del
  // índice que se está armando. Es el grueso del pico que provoca el OOM de C-2.
  const pending: Array<Promise<Prefetched> | undefined> = new Array(files.length);
  const concurrency = setting('documentExtractionConcurrency');
  let nextToSchedule = 0;
  const scheduleExtraction = (index: number) => {
    if (index >= files.length) return;
    const file = files[index];
    pending[index] = (async (): Promise<Prefetched> => {
      const cached = await loadCached(file);
      if (cached) return { cached };
      const extraction = await readDocumentContent(file.full);
      if (!extraction.ok) return { pieces: [], failure: { reason: extraction.reason, detail: extraction.detail } };
      return { pieces: chunkDocument(extraction.text) };
    })();
  };
  for (; nextToSchedule < Math.min(concurrency, files.length); nextToSchedule++) scheduleExtraction(nextToSchedule);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const result = await pending[i]!;
    pending[i] = undefined;          // suelta el JSON parseado de este documento
    scheduleExtraction(nextToSchedule++);
    let entries: CachedChunk[];
    if ('cached' in result) {
      entries = result.cached.entries;
      if (!entries.length) {
        withoutText.push({
          path: file.id,
          reason: result.cached.failure?.reason ?? 'empty',
          detail: result.cached.failure?.detail ?? 'sin fragmentos tras dividir el texto extraído',
        });
      }
    } else {
      entries = [];
      const pieces = result.pieces;
      for (let j = 0; j < pieces.length; j += 8) {
        const batch = pieces.slice(j, j + 8);
        // M-5: se embebe SOLO el texto del fragmento. Antes iba
        // `${file.id}\n${texto}`, y los tokens de la ruta —slugs, carpetas,
        // la extensión— participaban en el mean-pooling y desplazaban el
        // vector hacia el "tema" de la ruta. En fragmentos cortos la ruta
        // podía ser una fracción apreciable del texto. La ruta ya está donde
        // corresponde: en BM25, junto al título y la categoría, y en los
        // filtros de metadatos.
        const vectors = await embed(batch.map(piece => piece.text), 'passage');
        entries.push(...batch.map((piece, k) => ({
          path: file.id, chunk: j + k + 1, snippet: piece.text, vector: vectors[k],
          ...(piece.page === undefined ? {} : { page: piece.page }),
        })));
      }
      const failure = 'failure' in result ? result.failure : undefined;
      // Tambien se cachea el resultado VACIO, junto con su motivo. Antes no
      // se cacheaba en absoluto, y por eso los ~611 documentos de los que no
      // se puede extraer texto se reintentaban en cada construccion —incluido
      // el OCR, que es justo lo caro— sin que nadie supiera cuales eran ni
      // por que (hallazgo A-3).
      await writeChunkCache(cacheFileFor(file), { entries, failure });
      if (!entries.length) {
        withoutText.push({
          path: file.id,
          reason: failure?.reason ?? 'empty',
          detail: failure?.detail ?? 'sin fragmentos tras dividir el texto extraído',
        });
      }
    }

    if (entries.length) {
      const documentId = docPaths.length;
      docPaths.push(file.id);
      const part = new Float32Array(entries.length * EMBEDDING_DIMENSIONS);
      for (const [position, entry] of entries.entries()) {
        writeUnitVector(part, position * EMBEDDING_DIMENSIONS, entry.vector);
        chunkDocList.push(documentId);
        chunkNoList.push(entry.chunk);
        chunkPageList.push(entry.page ?? 0);
        snippets.push(entry.snippet);
      }
      vectorParts.push(part);
      count += entries.length;
    }

    retrievalStatus.completed++;
    console.log(`[retrieval] ${retrievalStatus.completed}/${files.length} documents, ${count} chunks`);
  }

  // Concatenar los tramos por documento en un único búfer contiguo. Cada tramo
  // se suelta en cuanto se copia, para que el recolector lo reclame durante el
  // recorrido en vez de mantener el doble de vectores vivos hasta el final.
  const vectors = new Float32Array(count * EMBEDDING_DIMENSIONS);
  let offset = 0;
  for (let i = 0; i < vectorParts.length; i++) {
    vectors.set(vectorParts[i], offset);
    offset += vectorParts[i].length;
    vectorParts[i] = EMPTY_VECTOR_PART;
  }
  vectorParts.length = 0;

  const chunkDoc = Int32Array.from(chunkDocList);
  const chunkNo = Int32Array.from(chunkNoList);
  const chunkPage = Int32Array.from(chunkPageList);
  chunkDocList.length = 0;
  chunkNoList.length = 0;
  chunkPageList.length = 0;

  current = {
    signature,
    count,
    docPaths,
    chunkDoc,
    chunkNo,
    chunkPage,
    snippets,
    vectors,
    documents: files.length,
    // Se pasa un generador en lugar de un arreglo: materializar las 181.339
    // cadenas a la vez costaba ~200 MB transitorios en el pico de construcción.
    bm25: new BM25((function* documentsForIndexing() {
      for (let id = 0; id < count; id++) {
        const documentPath = docPaths[chunkDoc[id]];
        const metadata = metadataCatalog.byPath.get(documentPath);
        yield `${documentPath}\n${metadata?.title || ''}\n${metadata?.category || ''}\n${snippets[id]}`;
      }
    })()),
    sourceMetadata: metadataCatalog.byPath
  };

  retrievalStatus.skipped = withoutText.length;
  await writeDocumentsWithoutText(root, withoutText);
  try {
    await saveSnapshot(retrievalCacheDir, root, {
      signature, count, documents: files.length,
      dimensions: EMBEDDING_DIMENSIONS,
      docPaths, chunkDoc, chunkNo, chunkPage, snippets, vectors,
      bm25: current.bm25.toSnapshot(),
    });
    const pruned = await pruneSnapshots(retrievalCacheDir, root, signature);
    console.log(`[retrieval] Snapshot guardado${pruned ? ` (${pruned} anterior(es) eliminado(s))` : ''}.`);
    await pruneChunkCache(cachePrefix, new Set(files.map(file => path.basename(cacheFileFor(file)))));
  } catch (error) {
    // El snapshot es una optimizacion: si no se puede escribir, el indice ya
    // esta listo y lo unico que se pierde es la rapidez del proximo arranque.
    console.warn('[retrieval] No se pudo guardar el snapshot:', error);
  }

  retrievalStatus.state = 'ready';
  return current;
}

let cacheWriteCounter = 0;

/**
 * Escribe una entrada de caché de forma atómica y tolerante a fallos.
 *
 * El nombre temporal incluye pid y contador porque un `<hash>.json.tmp` fijo
 * colisiona en cuanto dos procesos comparten el directorio de caché — que es
 * justo lo que propone el README al recomendar correr `npm run index` aparte
 * del servidor. El que renombra primero deja al otro con un `rename` sobre un
 * archivo que ya no existe.
 *
 * Y nunca es fatal: la caché es una optimización, así que no poder escribirla
 * solo significa que el próximo arranque tardará más, no que el índice falle.
 */
/**
 * Borra las entradas de caché de fragmentos que ya no corresponden a ningún
 * documento vigente (hallazgo M-11).
 *
 * La clave incluye `mtimeMs` y `size`, así que CADA modificación de un archivo
 * deja huérfana la entrada anterior — y lo mismo hace cualquier cambio de
 * firma global, como el salto de `transformers` de A-10, que invalidó las
 * 12.433 de golpe. Sobre un corpus que se vuelve a rastrear periódicamente eso
 * crece sin techo: 1,7 GB medidos cuando se levantó el hallazgo.
 *
 * Nunca es fatal: es espacio, no correctitud. Un fallo al borrar se avisa y se
 * sigue, igual que el snapshot.
 */
async function pruneChunkCache(prefix: string, keep: Set<string>): Promise<void> {
  try {
    const entries = await fs.readdir(retrievalCacheDir);
    let removed = 0;
    let freed = 0;
    for (const name of entries) {
      // Solo los archivos de fragmentos DE ESTA RAÍZ: el snapshot binario
      // tiene su propia poda, los reportes empiezan por "_" y `models/` es un
      // directorio. Y sobre todo, un corpus jamás purga la caché de otro.
      if (!name.startsWith(prefix) || !name.endsWith('.json') || keep.has(name)) continue;
      const full = path.join(retrievalCacheDir, name);
      const stat = await fs.stat(full).catch(() => undefined);
      if (!stat?.isFile()) continue;
      await fs.rm(full, { force: true });
      removed++;
      freed += stat.size;
    }
    if (removed) {
      console.log(`[retrieval] Caché de fragmentos: ${removed} entrada(s) obsoleta(s) eliminada(s), ${(freed / 1e6).toFixed(0)} MB liberados.`);
    }
  } catch (error) {
    console.warn('[retrieval] No se pudo purgar la caché de fragmentos:', error);
  }
}

async function writeChunkCache(cacheFile: string, entry: CacheEntry): Promise<void> {
  const temporary = `${cacheFile}.${process.pid}.${cacheWriteCounter++}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(entry));
    await fs.rename(temporary, cacheFile);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    console.warn(`[retrieval] No se pudo cachear ${path.basename(cacheFile)}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Deja por escrito qué documentos no produjeron texto, y por qué, para poder
 * triarlos por categoría en vez de leer una lista plana de rutas (hallazgo
 * A-3). `motivo` es el `ExtractionFailureReason` de documentPreprocessor.ts.
 */
async function writeDocumentsWithoutText(
  root: string, entries: Array<{ path: string; reason: string; detail: string }>,
): Promise<void> {
  // Un archivo por raiz documental: si no, indexar otro corpus —lo que hace
  // `npm run test:integration` con un temporal— borra el informe del real.
  const file = path.join(retrievalCacheDir, `_documentos-sin-texto-${rootScope(root)}.csv`);
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  try {
    if (!entries.length) { await fs.rm(file, { force: true }); return; }
    const rows = entries.map(e => [quote(e.path), quote(e.reason), quote(e.detail)].join(',')).join('\r\n');
    await fs.writeFile(file, `ruta,motivo,detalle\r\n${rows}\r\n`, 'utf8');
    console.warn(`[retrieval] ${entries.length} documentos indexables sin texto extraible. Listado en ${file}`);
  } catch { /* diagnostico opcional */ }
}

const EMPTY_VECTOR_PART = new Float32Array(0);

export function prepareIndex(): Promise<Index> {
  if (!building) {
    // Un índice ya servible sobrevive al fallo de una revalidación: solo el
    // primer build, cuando no hay nada que servir, deja el servicio en error.
    const servable = current;
    building = buildIndex().catch(error => {
      if (servable) {
        console.error('[retrieval] La revalidación falló; se mantiene el índice anterior:', error);
        retrievalStatus.state = 'ready';
      } else {
        retrievalStatus.state = 'error';
        retrievalStatus.error = 'No se pudo preparar el índice de embeddings. Revisa la conexión y los registros del backend.';
      }
      throw error;
    }).finally(() => {
      building = undefined;
      lastRevalidation = Date.now();
      retrievalStatus.lastCheckedAt = lastRevalidation;
    });
  }
  return building;
}

/**
 * Devuelve el índice servible sin comprobar el corpus.
 *
 * La comprobación de cambios se lanza en segundo plano cuando vence el TTL, así
 * que la consulta no la paga. En arranque en frío —cuando todavía no hay nada
 * que servir— sí espera a que el índice exista.
 */
export async function getIndex(): Promise<Index> {
  if (!current) return prepareIndex();

  const ttl = revalidateMs();
  if (ttl === 0) return prepareIndex();   // comprobar en cada consulta y esperar

  if (!building && Date.now() - lastRevalidation >= ttl) {
    if (heapIsTooFullToRebuild()) {
      const { heap_size_limit: limit, used_heap_size: used } = v8.getHeapStatistics();
      console.warn(
        `[retrieval] Revalidación aplazada: el heap está al ${(100 * used / limit).toFixed(0)}% ` +
        `(${Math.round(used / 1048576)} de ${Math.round(limit / 1048576)} MB) y una reconstrucción ` +
        `necesita mantener dos índices a la vez. Reindexa sin tráfico con "npm run index".`,
      );
      // Se aplaza un TTL completo para no repetir el aviso en cada consulta.
      lastRevalidation = Date.now();
    } else {
      // Marcar antes de lanzar evita que varias peticiones concurrentes
      // disparen varias revalidaciones en la misma ventana.
      lastRevalidation = Date.now();
      void prepareIndex().catch(() => { /* ya registrado en prepareIndex */ });
    }
  }
  return current;
}

/**
 * Cuánto pesa la pregunta anterior frente a la actual en BM25 (hallazgo M-2).
 *
 * Antes se concatenaban y todos los términos de la pregunta anterior puntuaban
 * igual que los de la actual, así que una pregunta de seguimiento corta quedaba
 * dominada por el tema anterior. Con 0,3 el contexto previo sigue desempatando
 * —que es lo que hace útil una pregunta de seguimiento— sin mandar sobre lo que
 * el usuario acaba de escribir.
 */
function previousQuestionWeight(): number {
  return setting('retrievalContextWeight');
}

/**
 * `context` es la pregunta anterior, y cada motor la usa como le conviene
 * (hallazgo M-2):
 *
 *   · El motor semántico NO la ve. E5 hace mean-pooling, así que meter dos
 *     temas en un vector de 384 dimensiones lo desplaza a un punto que no
 *     representa ninguno de los dos.
 *   · BM25 sí la ve, con peso reducido: el motor léxico suma por término, así
 *     que puede aprovechar el contexto sin que domine.
 *   · El reranker también la ve, entera. Es un cross-encoder que lee el par
 *     consulta-pasaje como texto: no sufre la dilución del mean-pooling, y sin
 *     el contexto no podría juzgar una pregunta como «¿y el plazo de ese
 *     trámite?», que por sí sola no dice de qué trámite habla.
 */
export async function hybridSearch(query: string, context?: string) {
  const index = await getIndex();
  const pathOf = (id: number) => index.docPaths[index.chunkDoc[id]];
  if (!index.count) return { hits: [], documents: index.documents, chunks: 0, method: 'bm25+cosine+rrf' };
  const [rawVector] = await embed([query], 'query');
  const vector = toUnitVector(rawVector);
  // Toda consulta recorre el corpus entero. El filtrado por carpeta o documento
  // se retiró junto con los endpoints que lo alimentaban: la interfaz solo hace
  // preguntas, nunca selecciona documentos, así que traducir un alcance a un
  // rango [lo, hi) era trabajo que no acotaba nada.
  const lexicalQuery: WeightedQuery = context
    ? [{ text: query, weight: 1 }, { text: context, weight: previousQuestionWeight() }]
    : query;
  const lexical = index.bm25.search(lexicalQuery, 0, index.count, 40);
  const semantic = topKByDot(index.vectors, EMBEDDING_DIMENSIONS, 0, index.count, vector, 40);
  const fused = reciprocalRankFusion([lexical, semantic]);
  const candidates = fused.slice(0, rerankCandidates());
  let ranked: Array<typeof candidates[number] & { rerank?: number }> = candidates;
  let method = 'bm25+cosine+rrf';
  try {
    const rerankQuery = context ? `${context}\n${query}` : query;
    const rerankedScores = await rerank(rerankQuery, candidates.map(r => ({ id: r.id, snippet: index.snippets[r.id] })));
    // Umbral de relevancia (hallazgo A-5): sin evidencia real por debajo del
    // logit mínimo, mejor devolver menos de 8 —o ninguno— que rellenar con
    // fragmentos que el reranker ya calificó como irrelevantes.
    //
    // El recorte a 8 NO ocurre aquí: se deja pasar la lista completa para que
    // la diversificación de abajo tenga de dónde elegir. Cortar antes la
    // dejaría escogiendo entre los mismos ocho de siempre.
    ranked = rankAndFilterByRelevance(
      candidates.map(r => ({ ...r, rerank: rerankedScores.get(r.id) })),
      minRerankScore(),
      Infinity,
    );
    method = 'bm25+cosine+rrf+ms-marco';
  } catch (error) {
    console.warn('[retrieval] Reranker no disponible; se usa RRF:', error);
    // LÍMITE CONOCIDO (A-5): en este camino de reserva no hay logit que
    // filtrar, así que el umbral de relevancia NO se aplica aquí — se
    // documenta la limitación en vez de fingir cobertura completa.
    // La diversificación de A-6 sí se aplica: no depende del logit, solo del
    // orden en que vienen los candidatos, que aquí es el de RRF.
    ranked = candidates;
  }
  // Diversidad y deduplicación (hallazgo A-6), sobre la lista ya ordenada.
  ranked = diversify(
    ranked,
    r => pathOf(r.id),
    r => index.snippets[r.id],
    { limit: 8, maxPerDocument: maxPerDocument(), nearDuplicateJaccard: nearDuplicateJaccard() },
  );
  // Los puntajes por motor acompañan a cada hit como diagnóstico: son lo que
  // permite ver POR QUÉ salió un fragmento (¿lo trajo el léxico, el semántico,
  // o solo la fusión?) al calibrar la recuperación. Se indexan por id en vez de
  // buscarlos con `find`: eran dos recorridos lineales sobre 40 candidatos por
  // cada uno de los 8 hits, cuando construir los dos mapas cuesta una pasada.
  const bm25ById = new Map(lexical.map(x => [x.id, x.score]));
  const semanticById = new Map(semantic.map(x => [x.id, x.score]));
  const hits = ranked.map(r => {
    const documentPath = pathOf(r.id);
    const metadata = index.sourceMetadata.get(documentPath);
    // M-4: la página solo viaja si el documento la tiene (0 = no aplica).
    const page = index.chunkPage[r.id];
    return { path: documentPath, chunk: index.chunkNo[r.id], snippet: index.snippets[r.id],
      ...(page > 0 ? { page } : {}),
      ...metadata, score: r.score, bm25: bm25ById.get(r.id) ?? 0,
      semantic: semanticById.get(r.id) ?? 0,
      ...(typeof r.rerank === 'number' ? { rerank: r.rerank } : {}) };
  });
  return { hits, documents: index.documents, chunks: index.count, method };
}
