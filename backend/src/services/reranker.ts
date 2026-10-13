/**
 * Reordenamiento de los candidatos con un cross-encoder.
 *
 * Esta etapa es el cuello de botella del sistema y conviene saber por qué antes
 * de tocarla. Medido sobre el corpus real, con 16 candidatos de ~1.000 caracteres:
 * 512 ms de los 585 que dura una consulta, el 84 %. Es CPU pura y —comprobado
 * con una sonda del bucle de eventos— NO cede el hilo de JavaScript mientras
 * corre: ocho inferencias lanzadas a la vez tardan exactamente ocho veces una.
 *
 * Lo único que la acelera sin cambiar ni un resultado es darle más hilos a ONNX
 * Runtime dentro de una misma inferencia. Cuatro caminos alternativos se
 * probaron y se descartaron con medición; quedan anotados para que nadie los
 * repita:
 *
 *   · Pool de worker_threads. `onnxruntime-node` no admite inferencias
 *     simultáneas en varios hilos del mismo proceso: aborta el proceso entero
 *     con «HandleScope: Entering the V8 API without proper locking in place»,
 *     incluso cargando los modelos de forma escalonada.
 *   · Pool de procesos hijo. Funciona, pero cuatro procesos rinden 3,49 cons/s
 *     —lo mismo que UN proceso con cuatro hilos— triplicando la latencia
 *     (1.145 ms frente a 286) y costando ~330 MB de RSS cada uno.
 *   · Agrupar consultas concurrentes en un lote. El rendimiento BAJA al crecer
 *     el lote (2,77 cons/s con 32 pares frente a 3,49 con 16) porque el relleno
 *     llega hasta la secuencia más larga; y además cambia los resultados: los
 *     mismos 16 pares puntúan distinto solos que dentro de un lote de 64
 *     (diferencia máxima 0,33), porque la salida no es invariante al relleno.
 *   · Cuantizar los vectores a int8 acelera el escaneo cero (ver retrievalMath).
 *
 * El número de hilos, en cambio, NO altera la salida: comprobado idéntica bit a
 * bit con 2 y con 4, y validado de punta a punta contra los 88 casos de
 * `baseline:check`.
 */
import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers';
import path from 'node:path';
import { retrievalCacheDir } from './embeddings.js';
import { availableCores } from './workerEntry.js';
import { setting } from './settings.js';
import { safeErrorCode } from "./safeLog.js";

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

/**
 * Hilos que ONNX Runtime reparte dentro de una inferencia.
 *
 * Medido en un Apple M4 (4 núcleos de rendimiento + 6 de eficiencia), con 16
 * fragmentos reales del corpus:
 *
 *   2 hilos   512 ms      6 hilos   402 ms
 *   4 hilos   286 ms      8 hilos   372 ms
 *
 * El óptimo sigue a los núcleos *de rendimiento*, no al total: pasar de cuatro
 * solo añade contención. Como eso depende de la máquina, el valor se ajusta con
 * `RERANK_INTRA_OP_THREADS` y se calibra con `npm run bench:rerank`, que imprime
 * esta misma tabla para el hardware donde se despliegue.
 */
function intraOpThreads(): number {
  // 0 = automático: seguir a los núcleos de rendimiento, que es lo que mide la
  // tabla de arriba. El valor por defecto es justamente 0, así que una máquina
  // sin configurar obtiene el óptimo de SU hardware y no un 4 grabado a fuego.
  const configured = setting('rerankIntraOpThreads');
  return configured > 0 ? configured : Math.min(4, availableCores());
}

let reranker: Promise<Reranker> | undefined;
let loadedWith = 0;

async function loadReranker(threads: number): Promise<Reranker> {
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(rerankerModel),
    AutoModelForSequenceClassification.from_pretrained(rerankerModel, {
      dtype: 'q8',
      session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 }
    })
  ]);
  return { tokenizer, model };
}

/**
 * Puntúa los candidatos. `threads` existe para que `bench:rerank` pueda barrer
 * valores en un mismo proceso; en producción se omite y se usa el configurado.
 */
export async function rerank(
  query: string, candidates: RerankInput[], threads = intraOpThreads(),
): Promise<Map<number, number>> {
  if (!candidates.length) return new Map();

  // El número de hilos se fija al crear la sesión de ONNX, así que cambiarlo
  // obliga a rehacerla. Solo ocurre en el banco de calibración.
  if (reranker && loadedWith !== threads) {
    const previous = reranker;
    reranker = undefined;
    void previous.then(loaded => loaded.model.dispose()).catch(() => {});
  }
  if (!reranker) {
    loadedWith = threads;
    reranker = loadReranker(threads).catch(error => {
      reranker = undefined;
      throw error;
    });
  }

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

/**
 * Deja el modelo cargado para que no lo pague la primera consulta.
 *
 * Son un par de segundos de lectura y preparación de la sesión. Un solo par
 * basta para forzar todo el camino: tokenizador, sesión y primera inferencia.
 */
export async function warmUpReranker(): Promise<void> {
  try {
    await rerank('calentamiento', [{ id: 0, snippet: 'calentamiento' }]);
  } catch (error) {
    console.warn(`[rerank] No se pudo precargar el modelo: ${safeErrorCode(error)}`);
  }
}

export async function disposeReranker(): Promise<void> {
  const pending = reranker;
  reranker = undefined;
  if (pending) (await pending).model.dispose();
}
