/**
 * Búsqueda híbrida del chat sobre Qdrant (research R3/R17,
 * contracts/qdrant-coleccion.md).
 *
 * Antes este módulo construía y guardaba un índice en memoria (BM25 + vectores
 * en el heap, con snapshot binario) a partir del corpus en disco. Eso pasó al
 * kb-worker: ahora el índice vive en Qdrant, servido por el alias `kb_chunks`,
 * y solo contiene la versión PUBLICADA de los elementos publicados de la matriz
 * documental (principio III). Este módulo solo consulta:
 *
 *   1. dos búsquedas top-40 sobre el alias, densa (e5-small) y BM25 dispersa,
 *      ambas filtradas por `estado = publicado` como defensa en profundidad;
 *   2. la fusión RRF del lado del cliente, con la misma función de antes;
 *   3. el reranker, el umbral de relevancia y la diversificación, sin cambios
 *      (son reglas del bloque 2, que esta migración no toca).
 *
 * Si Qdrant no responde o el alias no existe, el estado pasa a `error` y el
 * chat contesta "servicio no disponible": nunca "no encontré información"
 * (principio VI).
 */
import { setting } from "./settings.js";
import { embed } from './embeddings.js';
import { reciprocalRankFusion, type Ranked, type WeightedQuery } from './retrievalMath.js';
import { rerank as realRerank } from './reranker.js';
import { aliasKb, coleccionDelAlias, qdrant } from './qdrant.js';
import { coleccionActiva, superposiciones } from './manifest.js';
import { vectorConsulta } from '../kb/sparse.js';
import { calibrationFor } from './calibration.js';
import { MAX_CANDIDATES, MAX_SELECTED, selectFragments, selectWithoutReranker } from './selection.js';
import { safeErrorCode } from "./safeLog.js";

/** Dimensión de Xenova/multilingual-e5-small. */
export const EMBEDDING_DIMENSIONS = 384;

/** Candidatos que aporta cada motor a la fusión, igual que el índice anterior. */
const CANDIDATOS_POR_MOTOR = 40;

/**
 * Estados de la recuperación (los consume la ruta del chat y `/ready`):
 *   idle   → todavía no se comprobó Qdrant
 *   ready  → el alias existe y tiene contenido publicado
 *   error  → Qdrant no responde, no hay alias o la base aún no tiene nada publicado
 *
 * `completed`/`total` se conservan por compatibilidad con la ruta del chat;
 * ahora reflejan los fragmentos servidos.
 */
export const retrievalStatus = {
  state: 'idle', completed: 0, total: 0, error: '',
  /** Última comprobación del alias (epoch ms; 0 = nunca). */
  lastCheckedAt: 0,
  /** Ya no aplica: los descartes de extracción viven en kb_procesamiento. */
  skipped: 0,
  /** Colección física servida por el alias. */
  coleccion: '',
  /** Elementos distintos con fragmentos publicados. */
  documentos: 0,
  /** Calibración de la colección servida: vigente | ausente | incompatible | no_comprobada. */
  calibracion: 'no_comprobada' as string,
};

const MENSAJE_SIN_SERVICIO = 'La base de conocimiento no está disponible en este momento.';

function marcarError(detalle: string): void {
  retrievalStatus.state = 'error';
  retrievalStatus.error = MENSAJE_SIN_SERVICIO;
  retrievalStatus.lastCheckedAt = Date.now();
  console.warn(`[retrieval] ${detalle}`);
}

/**
 * Comprueba que el alias exista y tenga contenido publicado. Reemplaza al
 * antiguo `prepareIndex`, que construía el índice: el nombre se conserva
 * porque lo usan los scripts de evaluación y calibración.
 */
export async function prepareIndex(): Promise<{ documents: number; count: number }> {
  try {
    const client = qdrant();
    const coleccion = (await coleccionActiva()) ?? await coleccionDelAlias(client, aliasKb());
    if (!coleccion) {
      marcarError(`El alias "${aliasKb()}" no existe en Qdrant: el kb-worker todavía no creó la colección.`);
      return { documents: 0, count: 0 };
    }
    const { count } = await client.count(coleccion, { exact: true });
    if (!count) {
      marcarError(`La colección "${coleccion}" está vacía: todavía no se ha publicado contenido de la base.`);
      return { documents: 0, count: 0 };
    }
    // Pocos cientos de elementos: contar los distintos con un scroll es barato
    // y solo ocurre al arrancar y en la vigilancia periódica.
    if (coleccion !== retrievalStatus.coleccion || count !== retrievalStatus.total) {
      retrievalStatus.documentos = await contarElementos(coleccion);
    }
    Object.assign(retrievalStatus, {
      state: 'ready', error: '', completed: count, total: count, coleccion, lastCheckedAt: Date.now(),
      calibracion: (await calibrationFor(coleccion)).estado,
    });
    return { documents: retrievalStatus.documentos, count };
  } catch (error) {
    marcarError(`Qdrant no responde: ${error instanceof Error ? error.message : error}`);
    return { documents: 0, count: 0 };
  }
}

async function contarElementos(coleccion: string): Promise<number> {
  const ids = new Set<string>();
  let offset: string | number | null | undefined;
  do {
    const pagina = await qdrant().scroll(coleccion, {
      limit: 1024, with_payload: ['elemento_id'], with_vector: false, ...(offset ? { offset } : {}),
    });
    for (const p of pagina.points) ids.add(String((p.payload as Record<string, unknown>)?.elemento_id));
    offset = pagina.next_page_offset as string | number | null | undefined;
  } while (offset);
  return ids.size;
}

let vigilancia: NodeJS.Timeout | undefined;

/**
 * Vuelve a comprobar el alias periódicamente. Sin esto, un chat que arrancó
 * antes de la primera publicación —o durante una caída de Qdrant— quedaría en
 * `error` para siempre, porque la ruta deja de consultar mientras lo esté.
 */
export function vigilarIndice(intervaloMs = 30_000): void {
  if (vigilancia) return;
  vigilancia = setInterval(() => { void prepareIndex(); }, intervaloMs);
  vigilancia.unref();
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
  return Math.min(setting('rerankCandidates'), MAX_CANDIDATES);
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
type Payload = {
  elemento_id: string; version_id?: string; titulo: string; url: string; url_padre?: string | null; direccion: string;
  codigo?: string | null; fecha_actualizacion?: string | null; fecha_acceso?: string;
  fragmento: number; pagina?: number; texto: string;
};

let rerank: typeof realRerank = realRerank;
/** Solo pruebas: sustituye el reranker (p. ej. para simular su caída). */
export function setRerankerForTests(fn: typeof realRerank | undefined): void { rerank = fn ?? realRerank; }

export type Candidate = { id: number; score: number; rerank?: number };

export type CandidateSet = {
  /** Colección física consultada: umbral y corpus quedan atados a ella. */
  collection: string;
  payloads: Payload[];
  /** Hasta 16 candidatos de la fusión RRF, en su orden. */
  candidates: Candidate[];
  /** Puntajes del reranker; null si el reranker no estuvo disponible. */
  reranked: Map<number, number> | null;
  bm25ById: Map<number, number>;
  semanticById: Map<number, number>;
  method: string;
};

/**
 * Recupera y puntúa candidatos SIN seleccionar: dos búsquedas top-40 (denso y BM25) sobre la
 * colección, fusión RRF, 16 candidatos máximo y reranker. La selección final vive en
 * `selection.ts`. Consulta la colección RESUELTA —no el alias— para que el umbral que se
 * aplique sea el de esa misma colección.
 */
export async function retrieveCandidates(query: string, context?: string, collection?: string): Promise<CandidateSet> {
  const client = qdrant();
  const filtro = { must: [{ key: 'estado', match: { value: 'publicado' } }] };
  // Servicio normal: la colección sale de la generación activa en SQL (no del alias). Una colección
  // explícita (calibración de una candidata) no se valida contra el manifiesto vigente.
  const servida = collection === undefined;
  let target: string | undefined;
  try {
    target = collection ?? (await coleccionActiva()) ?? await coleccionDelAlias(client, aliasKb());
  } catch (error) {
    marcarError(`No se pudo resolver la generación activa: ${error instanceof Error ? error.message : error}`);
    throw new Error(MENSAJE_SIN_SERVICIO);
  }
  if (!target) {
    marcarError(`El alias "${aliasKb()}" no existe en Qdrant.`);
    throw new Error(MENSAJE_SIN_SERVICIO);
  }
  const [rawVector] = await embed([query], 'query');
  // M-2: el motor semántico NO ve la cola de seguimiento; BM25 sí, con peso reducido.
  const lexicalQuery: WeightedQuery = context
    ? [{ text: query, weight: 1 }, { text: context, weight: previousQuestionWeight() }]
    : query;
  const disperso = vectorConsulta(lexicalQuery);

  let densos: Array<{ id: string | number; score: number; payload?: Record<string, unknown> | null }>;
  let lexicos: typeof densos;
  const consultar = (destino: string) => Promise.all([
    client.query(destino, { query: rawVector, using: 'dense', limit: CANDIDATOS_POR_MOTOR, filter: filtro, with_payload: true })
      .then(r => r.points),
    disperso.indices.length
      ? client.query(destino, { query: disperso, using: 'bm25', limit: CANDIDATOS_POR_MOTOR, filter: filtro, with_payload: true })
        .then(r => r.points)
      : Promise.resolve([] as never[]),
  ]);
  try {
    try {
      [densos, lexicos] = await consultar(target);
    } catch (error) {
      // La colección pudo ser reemplazada y eliminada entre resolverla y consultarla: se relee la
      // generación activa UNA vez; si no cambió, es una falla real.
      const faltante = (error as { status?: number }).status === 404 || /not found|doesn't exist/i.test(String((error as Error)?.message));
      const otra = servida && faltante ? await coleccionActiva() : null;
      if (!otra || otra === target) throw error;
      target = otra;
      [densos, lexicos] = await consultar(target);
    }
  } catch (error) {
    marcarError(`Consulta a Qdrant fallida: ${error instanceof Error ? error.message : error}`);
    throw new Error(MENSAJE_SIN_SERVICIO);
  }

  // Validación SQL por solicitud: versión publicada, vigencia y metadata actual (SPEC007 R05).
  if (servida) {
    try {
      const ids = [...densos, ...lexicos].map(p => String((p.payload as Record<string, unknown> | null)?.elemento_id ?? '')).filter(Boolean);
      const mapa = await superposiciones(ids);
      if (mapa) {
        const valido = (p: (typeof densos)[number]) => {
          const pl = p.payload as unknown as Payload | null;
          const s = pl ? mapa.get(String(pl.elemento_id)) : undefined;
          if (!pl || !s || !s.vigente || (pl.version_id && pl.version_id !== s.versionId)) return false;
          Object.assign(pl, {
            titulo: s.titulo, url: s.url, url_padre: s.urlPadre, direccion: s.direccion, codigo: s.codigo,
            fecha_actualizacion: s.fechaActualizacion, fecha_acceso: s.fechaAcceso,
          });
          return true;
        };
        densos = densos.filter(valido);
        lexicos = lexicos.filter(valido);
      }
    } catch (error) {
      marcarError(`No se pudo validar la vigencia en SQL: ${safeErrorCode(error)}`);
      throw new Error(MENSAJE_SIN_SERVICIO);
    }
  }

  // RRF y selección trabajan con ids numéricos: se asigna uno local por punto.
  const payloads: Payload[] = [];
  const idLocal = new Map<string, number>();
  const aRanking = (puntos: typeof densos): Ranked[] => puntos.map(p => {
    const clave = String(p.id);
    let id = idLocal.get(clave);
    if (id === undefined) {
      id = payloads.length;
      idLocal.set(clave, id);
      payloads.push(p.payload as unknown as Payload);
    }
    return { id, score: p.score };
  });
  const semantic = aRanking(densos);
  const lexical = aRanking(lexicos);
  const candidates: Candidate[] = reciprocalRankFusion([lexical, semantic]).slice(0, rerankCandidates());
  let reranked: Map<number, number> | null = null;
  let method = 'qdrant:bm25+dense+rrf';
  try {
    const rerankQuery = context ? `${context}\n${query}` : query;
    reranked = await rerank(rerankQuery, candidates.map(r => ({ id: r.id, snippet: payloads[r.id].texto })));
    method = 'qdrant:bm25+dense+rrf+ms-marco';
  } catch (error) {
    console.warn(`[retrieval] Reranker no disponible; se usan los mejores de RRF: ${safeErrorCode(error)}`);
  }
  return {
    collection: target, payloads, candidates, reranked, method,
    bm25ById: new Map(lexical.map(x => [x.id, x.score])),
    semanticById: new Map(semantic.map(x => [x.id, x.score])),
  };
}

/**
 * Búsqueda híbrida del chat. Normal: umbral de la calibración vigente de la colección servida +
 * selección de `selection.ts`. Con el reranker caído: los 8 mejores de RRF tal cual, sin umbral
 * (`degraded: true`, `thresholdApplied: false`). Si la búsqueda en sí falla se lanza el error:
 * jamás se confunde con una abstención.
 */
export async function hybridSearch(query: string, context?: string, collection?: string) {
  const set = await retrieveCandidates(query, context, collection);
  const { payloads, candidates, reranked } = set;
  let chosen: Candidate[];
  let thresholdApplied = false;
  if (reranked === null) {
    chosen = selectWithoutReranker(candidates, MAX_SELECTED);
  } else {
    const calibration = await calibrationFor(set.collection);
    // Sin calibración vigente la readiness ya bloquea el servicio; para scripts y desarrollo
    // no se filtra por umbral (equivale a -Infinity) y se informa en `thresholdApplied`.
    const threshold = process.env.MIN_RERANK_SCORE !== undefined && Number.isFinite(Number(process.env.MIN_RERANK_SCORE))
      ? Number(process.env.MIN_RERANK_SCORE)
      : calibration.estado === 'vigente' ? calibration.umbral : -Infinity;
    thresholdApplied = Number.isFinite(threshold);
    chosen = selectFragments(
      candidates.map(c => ({ ...c, rerank: reranked.get(c.id) ?? -Infinity })),
      {
        threshold, scoreOf: c => c.rerank, idOf: c => c.id, limit: MAX_SELECTED,
        documentOf: c => payloads[c.id].elemento_id, textOf: c => payloads[c.id].texto,
        maxPerDocument: maxPerDocument(), nearDuplicateJaccard: nearDuplicateJaccard(),
      },
    );
  }
  const hits = chosen.map(r => {
    const p = payloads[r.id];
    const rerankScore = reranked?.get(r.id);
    return {
      path: p.url,
      chunk: p.fragmento,
      snippet: p.texto,
      ...(typeof p.pagina === 'number' && p.pagina > 0 ? { page: p.pagina } : {}),
      title: p.titulo,
      sourceUrl: p.url,
      ...(p.url_padre ? { sourcePageUrl: p.url_padre } : {}),
      category: p.direccion,
      ...(p.elemento_id ? { documentId: String(p.elemento_id) } : {}),
      ...(p.version_id ? { versionId: String(p.version_id) } : {}),
      ...(p.codigo ? { codigo: p.codigo } : {}),
      ...(p.fecha_actualizacion ? { fechaActualizacion: p.fecha_actualizacion } : {}),
      ...(p.fecha_acceso ? { fechaAcceso: p.fecha_acceso } : {}),
      score: r.score,
      bm25: set.bm25ById.get(r.id) ?? 0,
      semantic: set.semanticById.get(r.id) ?? 0,
      ...(typeof rerankScore === 'number' ? { rerank: rerankScore } : {}),
    };
  });
  return {
    hits, documents: retrievalStatus.documentos, chunks: retrievalStatus.total, method: set.method,
    degraded: reranked === null, thresholdApplied, collection: set.collection,
  };
}
