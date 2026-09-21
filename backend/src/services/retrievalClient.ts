/**
 * Cara del hilo principal del worker de recuperación.
 *
 * Expone la misma firma que `hybridSearch` para que la ruta HTTP no sepa dónde
 * se ejecuta la búsqueda, y mantiene un espejo de `retrievalStatus` alimentado
 * por los mensajes del worker.
 *
 * Si el worker no puede arrancar —o se cae y no logra reiniciarse— se degrada a
 * ejecutar la búsqueda en proceso. Se pierde el beneficio de no bloquear, pero
 * el servicio sigue respondiendo, que importa más.
 */
import { Worker } from "node:worker_threads";
import { setting } from "./settings.js";
import { hybridSearch, retrievalStatus as inProcessStatus } from "./search.js";
import { workerEntry, workerExecArgv, type WithoutId } from "./workerEntry.js";
import type { RetrievalStatusSnapshot, WorkerMessage, WorkerRequest } from "./retrievalWorker.js";

export type SearchResult = Awaited<ReturnType<typeof hybridSearch>>;

/**
 * La recuperación está saturada y esta consulta se rechaza sin encolarla.
 *
 * La lleva su propio tipo para que la ruta HTTP pueda distinguirla de un fallo
 * —es una respuesta legítima, no un error— y contestar 503 con `Retry-After`.
 */
export class RetrievalBusyError extends Error {
  constructor(readonly queued: number, readonly retryAfterSeconds: number) {
    super(`La búsqueda está saturada: ${queued} consultas en cola.`);
    this.name = "RetrievalBusyError";
  }
}

/**
 * Cuántas consultas pueden estar esperando antes de empezar a rechazar.
 *
 * El reranker no se puede paralelizar dentro del proceso (ver reranker.ts), así
 * que la recuperación atiende estrictamente de una en una: la cola crece sin
 * tope y la espera crece con ella. Sin límite, una ráfaga de doscientas
 * consultas se pasa más de un minuto trabajando para clientes que ya cerraron
 * la conexión —trabajo hecho para nadie mientras los que llegan después esperan—.
 *
 * Con el defecto de 24 y unos 350 ms por consulta, el último de la cola espera
 * en torno a 8 s; a partir de ahí es más honesto decir «vuelve a intentarlo»
 * que dejar la petición colgada.
 */
function maxPending(): number {
  return setting('retrievalMaxQueue');
}

/** Coste típico de una consulta, promediado, para estimar la espera. */
let averageMs = 350;
let inFlight = 0;

function recordDuration(ms: number): void {
  // Media móvil exponencial: sigue los cambios de carga sin guardar histórico.
  averageMs = averageMs * 0.8 + ms * 0.2;
}

/** Espejo alimentado por los mensajes del worker. */
const mirror: RetrievalStatusSnapshot = { ...inProcessStatus };

/**
 * Estado del índice, tomado de donde de verdad vive.
 *
 * Con worker, la autoridad es el espejo que él alimenta. Sin worker —pruebas,
 * scripts o modo degradado— la autoridad es el objeto del propio proceso, y
 * leer el espejo dejaría a la ruta viendo `idle` para siempre, rechazando con
 * 503 consultas que se podrían atender.
 */
export function getRetrievalStatus(): RetrievalStatusSnapshot & {
  queued: number; averageMs: number;
} {
  const source = workerEnabled() && !degraded ? mirror : inProcessStatus;
  // `queued` y `averageMs` viven en el hilo principal, no en el worker: son lo
  // que ve quien espera, y hacen visible en /api/retrieval/status la cola que
  // antes solo se notaba como lentitud.
  return { ...source, queued: inFlight, averageMs: Math.round(averageMs) };
}

/** `false` desactiva el worker y ejecuta todo en proceso (pruebas y scripts). */
function workerEnabled(): boolean {
  return process.env.RETRIEVAL_WORKER !== "false";
}

const MAX_RESTARTS = 3;

type Pending = { resolve: (value: SearchResult) => void; reject: (error: Error) => void };

let worker: Worker | undefined;
let restarts = 0;
let degraded = false;
let stopping = false;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

function failPending(reason: string): void {
  for (const { reject } of pending.values()) reject(new Error(reason));
  pending.clear();
}

function startWorker(): Worker | undefined {
  try {
    const started = new Worker(workerEntry("retrievalWorker"), { execArgv: workerExecArgv() });
    started.on("message", (message: WorkerMessage) => {
      if (message.kind === "status") {
        Object.assign(mirror, message.status);
        return;
      }
      const waiting = pending.get(message.id);
      if (!waiting) return;
      if (message.ok) waiting.resolve(message.value);
      else waiting.reject(new Error(message.error));
    });
    started.on("error", error => {
      console.error("[retrieval] El worker falló:", error);
      failPending("El worker de recuperación falló.");
    });
    started.on("exit", code => {
      worker = undefined;
      failPending("El worker de recuperación se detuvo.");
      // `terminate()` sale con código 1: una parada deliberada no es una caída.
      if (code === 0 || stopping) return;
      if (restarts >= MAX_RESTARTS) {
        degraded = true;
        console.error(`[retrieval] El worker se cayó ${restarts} veces; se pasa a buscar en el hilo principal.`);
        return;
      }
      restarts++;
      console.warn(`[retrieval] Worker caído (código ${code}); reiniciando (${restarts}/${MAX_RESTARTS}).`);
      worker = startWorker();
    });
    // Ocioso, el worker no debe impedir que el proceso termine; con una
    // consulta en vuelo, sí tiene que mantenerlo vivo hasta responderla.
    started.unref();
    return started;
  } catch (error) {
    degraded = true;
    console.error("[retrieval] No se pudo arrancar el worker; se busca en el hilo principal:", error);
    return undefined;
  }
}

function ensureWorker(): Worker | undefined {
  if (degraded || !workerEnabled()) return undefined;
  if (!worker) worker = startWorker();
  return worker;
}

function settle(id: number, target: Worker): void {
  pending.delete(id);
  if (!pending.size) target.unref();
}

function ask(target: Worker, request: WithoutId<WorkerRequest>): Promise<SearchResult> {
  return new Promise<SearchResult>((resolve, reject) => {
    const id = nextRequestId++;
    pending.set(id, {
      resolve: value => { settle(id, target); resolve(value); },
      reject: error => { settle(id, target); reject(error); },
    });
    target.ref();
    target.postMessage({ ...request, id } as WorkerRequest);
  });
}

/** Arranca el worker y deja el índice cargado, sin esperar a la primera consulta. */
export async function warmUpRetrieval(): Promise<void> {
  const target = ensureWorker();
  if (!target) {
    const { prepareIndex } = await import("./search.js");
    await prepareIndex();
    return;
  }
  await ask(target, { kind: "warmup" });
}

export async function search(query: string, context?: string): Promise<SearchResult> {
  const limit = maxPending();
  if (inFlight >= limit) {
    // Se rechaza ANTES de encolar. Cada consulta admitida de más es trabajo que
    // se le quita a las que ya están esperando.
    throw new RetrievalBusyError(inFlight, Math.max(1, Math.ceil(inFlight * averageMs / 1000)));
  }
  inFlight++;
  const started = Date.now();
  try {
    const target = ensureWorker();
    if (!target) return await hybridSearch(query, context);
    try {
      return await ask(target, { kind: "search", query, context });
    } catch (error) {
      // Un worker que murió a media consulta no debe traducirse en un error para
      // el usuario si el hilo principal puede responder.
      if (degraded || !worker) {
        console.warn("[retrieval] Consulta reintentada en el hilo principal:", error);
        return await hybridSearch(query, context);
      }
      throw error;
    }
  } finally {
    inFlight--;
    recordDuration(Date.now() - started);
  }
}

/** Detiene el worker. Para pruebas y para un apagado ordenado. */
export async function stopRetrievalWorker(): Promise<void> {
  const running = worker;
  stopping = true;
  worker = undefined;
  failPending("El worker de recuperación se detuvo.");
  try {
    if (running) await running.terminate();
  } finally {
    stopping = false;
    degraded = false;
    restarts = 0;
  }
}

/**
 * Cierra el worker de recuperación de forma ordenada (hallazgo M-12).
 *
 * Sin esto, un SIGTERM mataba el proceso con el worker vivo: quedaban sesiones
 * ONNX de `@huggingface/transformers` sin liberar y, si el índice se estaba
 * reconstruyendo, un archivo de caché a medio escribir. Es idempotente, porque
 * SIGINT y SIGTERM pueden llegar los dos.
 */
export async function shutdownRetrieval(): Promise<void> {
  const running = worker;
  worker = undefined;
  if (running) await running.terminate();
}
