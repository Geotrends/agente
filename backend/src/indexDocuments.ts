import "dotenv/config";
import { prepareIndex } from "./services/search.js";
import { disposeEmbeddings } from "./services/embeddings.js";
const index = await prepareIndex();
console.log(`Índice listo: ${index.documents} documentos, ${index.chunks.length} fragmentos.`);
await disposeEmbeddings();
