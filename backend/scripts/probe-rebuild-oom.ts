/**
 * Reproduce el fallo del hallazgo C-2.
 *
 *     npm run probe:rebuild
 *
 * Construye el índice, añade un documento diminuto al corpus y fuerza una
 * reconstrucción sobre el proceso ya caliente — exactamente lo que ocurre hoy
 * cuando alguien edita un documento con el servidor arriba.
 *
 * Resultado esperado HOY:
 *     FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 *
 * `buildIndex` mantiene vivo el índice anterior hasta la línea final, así que
 * una reconstrucción necesita el doble de lo que ocupa el índice: ~2,4 GB + ~2,4 GB
 * contra un límite de 4.144 MB. No hace falta que el corpus crezca; basta con
 * que cambie un archivo.
 *
 * Este script es el CRITERIO DE ACEPTACIÓN de las fases F1-F2: cuando el índice
 * baje a ~530 MB, debe terminar sin caerse e imprimir el pico alcanzado.
 *
 * El proceso muere antes de poder limpiar, así que el documento de prueba se
 * crea dentro del corpus y hay que borrarlo a mano. La ruta se imprime al
 * principio y el borrado deja la firma del índice como estaba.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import v8 from "node:v8";
import { getDocumentsRootPath } from "../src/services/context.js";
import { prepareIndex, retrievalStatus } from "../src/services/search.js";

const MB = 1048576;
const limitMb = v8.getHeapStatistics().heap_size_limit / MB;
const snapshot = () => {
  const usage = process.memoryUsage();
  return `heap ${(usage.heapUsed / MB).toFixed(0)} MB · rss ${(usage.rss / MB).toFixed(0)} MB`;
};

const root = getDocumentsRootPath();
const probePath = path.join(root, "_probe-rebuild-oom.md");
const relative = path.relative(process.cwd(), probePath);

console.log(`\nLímite de heap: ${limitMb.toFixed(0)} MB`);
console.log(`Documento de prueba: ${relative}`);
console.log(`Si el proceso muere, bórralo con:  rm "${relative}"\n`);

// La revalidación automática se desactiva: aquí se fuerza a mano, para medir.
process.env.INDEX_REVALIDATE_MS = "0";

console.log("1) Construyendo el índice desde la caché…");
const coldStart = Date.now();
const index = await prepareIndex();
console.log(`   listo en ${((Date.now() - coldStart) / 1000).toFixed(0)} s — ${index.documents} documentos`);
console.log(`   ${snapshot()}   ·  estado=${retrievalStatus.state}`);

let peakHeap = 0;
let peakRss = 0;
const watch = setInterval(() => {
  const usage = process.memoryUsage();
  peakHeap = Math.max(peakHeap, usage.heapUsed / MB);
  peakRss = Math.max(peakRss, usage.rss / MB);
}, 50);
watch.unref();

console.log("\n2) Añadiendo un documento y reconstruyendo sobre el proceso caliente…");
await fs.writeFile(probePath, "# Sonda\n\nDocumento minimo para forzar una reconstruccion del indice.\n", "utf8");

let crashed = false;
const startedAt = Date.now();
try {
  const rebuilt = await prepareIndex();
  console.log(`   SOBREVIVIÓ en ${((Date.now() - startedAt) / 1000).toFixed(0)} s — ${rebuilt.documents} documentos`);
} catch (error) {
  crashed = true;
  console.log(`   FALLÓ: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  clearInterval(watch);
}

console.log(`   pico durante la reconstrucción: heap ${peakHeap.toFixed(0)} MB · rss ${peakRss.toFixed(0)} MB`);
console.log(`   pico/límite = ${(100 * peakHeap / limitMb).toFixed(0)} %`);

await fs.rm(probePath, { force: true });
console.log(`\n3) Documento de prueba eliminado; la firma del índice vuelve a su valor original.`);
process.exitCode = crashed ? 1 : 0;
