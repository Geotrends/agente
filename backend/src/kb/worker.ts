/**
 * Proceso de larga duración del servicio `kb-worker` (research R1/R5).
 *
 *   - Al arrancar: aplica las migraciones pendientes y garantiza el alias de Qdrant.
 *   - En cada ciclo: procesa los informes de corrida pendientes y corre el
 *     vigilante de la verificación semanal.
 *   - Una vez al día: la purga de retención.
 *
 * Es el único escritor de la matriz y de Qdrant. Corre fuera del backend del
 * chat precisamente para que sincronizar o reindexar nunca lo detenga ni le
 * robe CPU (RNF-C3-IV-02, RNF-C3-IN-13).
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";

// Igual que el antiguo indexador offline: aquí no hay peticiones de chat con
// las que competir, así que los embeddings pueden usar casi todos los núcleos.
// Debe fijarse ANTES de importar embeddings.ts, que lo lee una sola vez.
process.env.EMBEDDING_INTRA_OP_THREADS ??= String(Math.max(2, os.cpus().length - 1));

const { aplicarMigraciones, cerrarPool, kbPool } = await import("./db.js");
const { asegurarColeccion } = await import("./indexer.js");
const { setting } = await import("../services/settings.js");
const { registrarTareaCiclo, tareasDelCiclo } = await import("./ciclo.js");
const { procesarPendientes, vigilarInformes } = await import("./informes.js");
const { verificarAtraso } = await import("./vigilante.js");
const { purgarRetencion, purgaAlDia } = await import("./retention.js");
const { procesarOperaciones } = await import("./documentOperations.js");
const { procesarCargasManuales, reanudarCargas } = await import("./manualUploads.js");
const { procesarVencimientos } = await import("./expiry.js");
const { adoptarGeneracionInicial } = await import("./publicationManifest.js");
const { elementosIndexados } = await import("./indexer.js");
const { aliasKb } = await import("../services/qdrant.js");
const { limpiarStagingViejo } = await import("./documentFiles.js");
const { publicarSnapshot, sembrarEnlaces } = await import("./managedLinks.js");

// US1 (T039): informes de corrida del scraper.
registrarTareaCiclo("informes de corrida", async db => { await procesarPendientes(db); });
// US4 (T066): avisa si el scraper lleva más de 7 días sin dejar una corrida programada.
registrarTareaCiclo("vigilante de la corrida semanal", async db => { await verificarAtraso(db); });
// US6 (T076): retención de registros, una vez al día (la marca es la última fila de kb_purga).
registrarTareaCiclo("retención de registros", async db => { if (!(await purgaAlDia(db))) await purgarRetencion(db); });

// SPEC007: cargas manuales, vencimientos por fecha de validez y temporales viejos. Las operaciones
// documentales (publicar/rechazar/retirar/reindexar) corren en su propio bucle corto, abajo.
registrarTareaCiclo("cargas manuales", async db => { await procesarCargasManuales(db); });
registrarTareaCiclo("vencimientos", async db => { await procesarVencimientos(db); });
registrarTareaCiclo("temporales de carga", async () => { await limpiarStagingViejo(); });

/** Calibración de la candidata con el oro si está configurado; si no, hereda la vigente. */
async function opcionesDeOperacion() {
  const oroPath = process.env.KB_ORO_PATH;
  if (!oroPath) return {};
  const { calibrateCollection, loadGold } = await import("./calibrateCollection.js");
  const { gold, hash } = await loadGold(oroPath);
  return { calibrar: (coleccion: string, info: { corpusHash: string }) => calibrateCollection(coleccion, gold, hash, info) };
}

let operacionesEnCurso = false;
async function bucleOperaciones(): Promise<void> {
  if (detenido || operacionesEnCurso) return;
  operacionesEnCurso = true;
  try {
    await procesarCargasManuales(kbPool());
    await procesarOperaciones(kbPool(), await opcionesDeOperacion());
    // Lista de enlaces del scraper: el snapshot se republica solo cuando cambió.
    await publicarSnapshot(kbPool());
  } catch (error) {
    console.error(`[kb-worker] Operaciones documentales con error: ${error instanceof Error ? error.message : error}`);
  } finally {
    operacionesEnCurso = false;
  }
}

// Latido para el healthcheck de Docker: el worker no atiende HTTP, así que el
// HEALTHCHECK del backend (puerto 4000) no aplica. Mientras el bucle de eventos
// responda, el archivo se renueva; docker-compose.yml lo lee (T087).
const ARCHIVO_LATIDO = process.env.KB_WORKER_LATIDO || "/tmp/kb-worker.alive";
function latir(): void {
  try { fs.writeFileSync(ARCHIVO_LATIDO, String(Date.now())); } catch { /* sin latido: el healthcheck lo reportará */ }
}

let detenido = false;
let temporizador: NodeJS.Timeout | undefined;
let cicloEnCurso: Promise<void> | undefined;

async function ciclo(): Promise<void> {
  try {
    await tareasDelCiclo(kbPool());
  } catch (error) {
    // Un ciclo fallido no tumba el proceso: el siguiente lo reintenta.
    console.error(`[kb-worker] Ciclo con error: ${error instanceof Error ? error.message : error}`);
  }
}

function programar(): void {
  if (detenido) return;
  temporizador = setTimeout(() => {
    cicloEnCurso = ciclo().finally(programar);
  }, setting("kbSondeoMs"));
}

async function detener(senal: string): Promise<void> {
  if (detenido) return;
  detenido = true;
  console.log(`[kb-worker] ${senal}: terminando el ciclo en curso y cerrando.`);
  clearTimeout(temporizador);
  await cicloEnCurso;
  await cerrarPool();
  process.exit(0);
}

process.on("SIGTERM", () => void detener("SIGTERM"));
process.on("SIGINT", () => void detener("SIGINT"));

const aplicadas = await aplicarMigraciones(kbPool());
if (aplicadas.length) console.log(`[kb-worker] Migraciones aplicadas: ${aplicadas.join(", ")}`);
const coleccion = await asegurarColeccion();
console.log(`[kb-worker] Listo. Colección servida: ${coleccion}.`);
// Generación activa: se adopta la colección y versiones actuales verificadas; si discrepan se informa
// y la primera reindexación creará la generación (el chat sigue sirviendo con el alias mientras tanto).
const adopcion = await adoptarGeneracionInicial(kbPool(), aliasKb(), c => elementosIndexados(c));
if (adopcion === "discrepante") console.warn("[kb-worker] La colección servida no coincide con la matriz: reindexe para crear la generación activa.");
await reanudarCargas(kbPool());
await sembrarEnlaces(kbPool());
setInterval(() => { void bucleOperaciones(); }, 2_000).unref();
void bucleOperaciones();
latir();
setInterval(latir, 30_000).unref();
cicloEnCurso = ciclo().finally(programar);
// Un informe nuevo se procesa en cuanto aparece (B2), sin esperar el sondeo.
vigilarInformes(() => {
  if (detenido) return;
  void procesarPendientes(kbPool()).catch(error =>
    console.error(`[kb-worker] Procesando informes: ${error instanceof Error ? error.message : error}`));
});
