import "dotenv/config";
import os from "node:os";

// Este script corre offline, separado del servidor de chat (ver README:
// "npm run index" antes de "npm run dev"/"npm start"). A diferencia del
// servidor en vivo, aca no hay peticiones concurrentes con las que competir
// por CPU, asi que usamos casi todos los cores disponibles para embeddings.
// Debe fijarse ANTES de importar embeddings.ts, que lee la env var una sola
// vez al crear el pipeline.
process.env.EMBEDDING_INTRA_OP_THREADS ??= String(Math.max(2, os.cpus().length - 1));

const { prepareIndex } = await import("./services/search.js");
const { disposeEmbeddings } = await import("./services/embeddings.js");
const { disposeReranker } = await import("./services/reranker.js");

const startedAt = Date.now();
const index = await prepareIndex();
const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
console.log(`Índice listo: ${index.documents} documentos, ${index.count} fragmentos (${elapsedMin} min).`);
await disposeEmbeddings();
await disposeReranker();
