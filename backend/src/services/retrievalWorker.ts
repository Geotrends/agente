/**
 * Hilo que posee el índice, el pipeline de embeddings y el reranker.
 *
 * Todo el trabajo pesado de una consulta es SÍNCRONO desde el punto de vista del
 * bucle de eventos: el escaneo vectorial recorre un búfer de 279 MB (61 ms), y
 * la inferencia del reranker con `onnxruntime-node` no cede el hilo pese a ser
 * un `await` (303 ms) —comprobado con una sonda del bucle de eventos: donde
 * deberían caber 95 latidos durante una inferencia, solo entra 1—. Ejecutándolo
 * aquí, el hilo principal solo paga serializar un mensaje de ~8 KB y queda libre
 * para atender el resto de peticiones.
 *
 * Lo que este worker NO arregla es la cola: al ser uno solo, atiende de una en
 * una, así que veinte consultas simultáneas siguen tardando veinte veces una.
 * No se reparte en varios porque `onnxruntime-node` aborta el proceso si dos
 * hilos infieren a la vez (ver services/reranker.ts, donde está medido); el
 * tope se administra con contrapresión desde `retrievalClient`.
 *
 * El protocolo es deliberadamente mínimo: una petición lleva la consulta y su
 * alcance, y la respuesta lleva los mismos fragmentos que devolvería
 * `hybridSearch` en proceso. No se comparte memoria, así que no hacen falta
 * `SharedArrayBuffer` ni el aislamiento de origen que arrastran.
 */
// El worker hereda una copia de process.env, asi que en el servidor ya vendria
// con .env cargado por src/index.ts. Cargarlo aqui tambien lo hace autonomo:
// arrancar el worker desde un script o una prueba no depende de que alguien
// haya importado dotenv antes, y un root documental equivocado produce un
// indice vacio silencioso, que es dificil de diagnosticar.
import "dotenv/config";
import { parentPort } from "node:worker_threads";
import { hybridSearch, prepareIndex, retrievalStatus } from "./search.js";
import { warmUpReranker } from "./reranker.js";

export type WorkerRequest =
  | { kind: "search"; id: number; query: string; context?: string }
  | { kind: "warmup"; id: number };

export type RetrievalStatusSnapshot = typeof retrievalStatus;

export type WorkerMessage =
  | { kind: "result"; id: number; ok: true; value: Awaited<ReturnType<typeof hybridSearch>> }
  | { kind: "result"; id: number; ok: false; error: string }
  | { kind: "status"; status: RetrievalStatusSnapshot };

if (!parentPort) throw new Error("retrievalWorker solo puede ejecutarse como worker_thread");
const port = parentPort;

function postStatus(): void {
  port.postMessage({ kind: "status", status: { ...retrievalStatus } } satisfies WorkerMessage);
}

// El estado cambia dentro de buildIndex, que no notifica. Sondearlo cada medio
// segundo basta para que el endpoint /api/retrieval/status siga siendo útil
// durante una reconstrucción, y es mucho más simple que instrumentar cada
// transición. `unref` evita que el intervalo mantenga vivo el worker.
let lastStatus = "";
const watcher = setInterval(() => {
  const current = JSON.stringify(retrievalStatus);
  if (current !== lastStatus) {
    lastStatus = current;
    postStatus();
  }
}, 500);
watcher.unref();

port.on("message", (request: WorkerRequest) => {
  void (async () => {
    try {
      if (request.kind === "warmup") {
        await Promise.all([prepareIndex(), warmUpReranker()]);
        port.postMessage({
          kind: "result", id: request.id, ok: true,
          value: { hits: [], documents: 0, chunks: 0, method: "warmup" },
        } satisfies WorkerMessage);
      } else {
        const value = await hybridSearch(request.query, request.context);
        port.postMessage({ kind: "result", id: request.id, ok: true, value } satisfies WorkerMessage);
      }
    } catch (error) {
      port.postMessage({
        kind: "result", id: request.id, ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerMessage);
    } finally {
      postStatus();
    }
  })();
});

// Cargar el índice y los modelos del pool nada más arrancar: entre el snapshot
// y el cross-encoder son unos segundos que la primera consulta real no debe
// pagar. Van en paralelo porque compiten por cosas distintas —disco y CPU—.
void Promise.all([prepareIndex(), warmUpReranker()])
  .then(postStatus)
  .catch(error => {
    console.error("[retrieval:worker] No se pudo preparar el índice:", error);
    postStatus();
  });
