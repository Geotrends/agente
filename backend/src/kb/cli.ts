/**
 * CLI del operador de la base de conocimiento (contracts/kb-cli.md).
 *
 *   docker compose exec kb-worker node dist/kb/cli.js <comando> [opciones]
 *   make kb CMD="<comando> [opciones]"
 *
 * Códigos de salida: 0 éxito · 1 error de validación · 2 infraestructura
 * (PostgreSQL o Qdrant no disponibles). Cada comando llama a una función de
 * `service.ts`; aquí solo se interpretan argumentos y se imprime.
 */
import "dotenv/config";
import { actorActual, registrarAccion } from "./audit.js";
import { cerrarPool, kbPool } from "./db.js";
import { dirInformes, procesarPendientes } from "./informes.js";
import * as servicio from "./service.js";
import { procesarInforme } from "./sync.js";

export class ErrorValidacion extends Error {}

type Comando = (args: string[], flags: Set<string>) => Promise<number>;

function imprimir(valor: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(valor, null, 2));
    return;
  }
  if (Array.isArray(valor)) {
    if (!valor.length) console.log("(sin resultados)");
    else console.table(valor);
    return;
  }
  console.log(valor);
}

const COMANDOS: Record<string, { ayuda: string; correr: Comando }> = {
  migrar: {
    ayuda: "Aplica las migraciones pendientes (idempotente).",
    correr: async () => {
      const aplicadas = await servicio.aplicarMigraciones();
      console.log(aplicadas.length ? `Migraciones aplicadas: ${aplicadas.join(", ")}` : "El esquema ya estaba al día.");
      return 0;
    },
  },
  estado: {
    ayuda: "Alias, colección, conteos por estado, última corrida e indexación.",
    correr: async (_args, flags) => {
      imprimir(await servicio.estadoBase(), flags.has("--json"));
      return 0;
    },
  },
  sincronizar: {
    ayuda: "Procesa los informes pendientes (o --informe=<archivo>). --completa reconstruye la colección sin cortar el chat; --medir imprime la duración por etapa.",
    correr: async (_args, flags) => {
      const json = flags.has("--json");
      if (flags.has("--medir") && !flags.has("--completa")) throw new ErrorValidacion("--medir requiere --completa.");
      const informe = [...flags].find(f => f.startsWith("--informe="))?.slice("--informe=".length);
      const resumenes = informe ? [await procesarInforme(kbPool(), informe)] : await procesarPendientes(kbPool());
      if (!resumenes.length && !flags.has("--completa")) console.log(`No hay informes pendientes en ${dirInformes()}.`);
      imprimir(resumenes, json);
      for (const r of resumenes) if (r.enProceso) console.log(`La corrida ${r.corrida} la está procesando otro proceso (kb-worker); consulta el avance con kb estado.`);
      if (flags.has("--completa")) {
        // Con --oro=<archivo> (o KB_ORO_PATH) la candidata se calibra ANTES de mover el alias (RF-C3-DI-05).
        const oroPath = [...flags].find(f => f.startsWith("--oro="))?.slice("--oro=".length) ?? process.env.KB_ORO_PATH;
        type Opciones = NonNullable<Parameters<typeof servicio.reconstruirColeccion>[2]>;
        let calibrar: Opciones["calibrar"] | undefined;
        if (oroPath) {
          const { calibrateCollection, loadGold } = await import("./calibrateCollection.js");
          const { gold, hash } = await loadGold(oroPath);
          calibrar = (coleccion, info) => calibrateCollection(coleccion, gold, hash, info);
        }
        const r = await servicio.reconstruirColeccion(kbPool(), actorActual(), calibrar ? { calibrar } : {});
        if (flags.has("--medir")) {
          const e = r.duracionEtapasMs;
          const total = e.conversion + e.ocr + e.embeddings + e.indexacion;
          imprimir({ ...r, duracionEtapasMs: { ...e, total_ms: total, total_min: Math.round(total / 600) / 100 } }, json);
        } else {
          imprimir({ coleccion: r.coleccion, elementos: r.elementos, puntos: r.puntos }, json);
        }
      }
      return 0;
    },
  },
  pendientes: {
    ayuda: "Elementos con versión pendiente de aprobación.",
    correr: async (_args, flags) => {
      imprimir(await servicio.listarPendientes(), flags.has("--json"));
      return 0;
    },
  },
  publicar: {
    ayuda: "Publica versiones pendientes: <clave>… o --todos-pendientes. Se niega si una corrida se está procesando, salvo --forzar.",
    correr: async (args, flags) => {
      if (!args.length && !flags.has("--todos-pendientes")) throw new ErrorValidacion("Indica claves o --todos-pendientes.");
      const r = await servicio.publicar(kbPool(), { claves: args.length ? args : undefined, todosPendientes: flags.has("--todos-pendientes") }, actorActual(), { forzar: flags.has("--forzar") });
      console.log(`Publicados: ${r.publicados.length}.`);
      if (r.rechazados.length) { imprimir(r.rechazados, flags.has("--json")); return 1; }
      return 0;
    },
  },
  "exportar-fichas": {
    ayuda: "Escribe un .md por ficha y por página publicada (--salida=<dir>).",
    correr: async (_args, flags) => {
      const salida = [...flags].find(f => f.startsWith("--salida="))?.slice("--salida=".length);
      const r = await servicio.exportarFichas(kbPool(), salida || undefined, actorActual());
      if (flags.has("--json")) imprimir(r, true);
      else console.log(`${r.archivos.length} archivos en ${r.directorio}.`);
      return 0;
    },
  },
  notificaciones: {
    ayuda: "Avisos al administrador sin revisar (--todas incluye los revisados).",
    correr: async (_args, flags) => {
      const filas = await servicio.notificaciones(kbPool(), { todas: flags.has("--todas") });
      if (flags.has("--json")) imprimir(filas, true);
      else if (!filas.length) console.log("(sin notificaciones)");
      else console.table(filas.map(n => ({
        id: n.id, tipo: n.tipo, objeto: n.objeto, veces: n.repeticiones, estado: n.estado,
        ultima: n.ultimaEn.toISOString(), descripcion: n.descripcion,
      })));
      return 0;
    },
  },
  revisar: {
    ayuda: "Marca una notificación como revisada: revisar <id>.",
    correr: async args => {
      if (args.length !== 1) throw new ErrorValidacion("Uso: revisar <id>");
      const ok = await servicio.revisarNotificacion(kbPool(), args[0], actorActual());
      console.log(ok ? "Marcada como revisada." : "No existe o ya estaba revisada.");
      return ok ? 0 : 1;
    },
  },
  "exportar-matriz": {
    ayuda: "Exporta la matriz documental a .xlsx (--salida=<dir>).",
    correr: async (_args, flags) => {
      const salida = [...flags].find(f => f.startsWith("--salida="))?.slice("--salida=".length);
      const r = await servicio.exportarMatriz(kbPool(), salida || undefined);
      await registrarAccion(kbPool(), actorActual(), "exportar_matriz", r.ruta, `${r.filas} filas`);
      if (flags.has("--json")) imprimir(r, true);
      else console.log(`${r.filas} filas en ${r.ruta}`);
      return 0;
    },
  },
  "purgar-retencion": {
    ayuda: "Ejecuta la retención a mano (también corre a diario en el kb-worker).",
    correr: async (_args, flags) => {
      imprimir(await servicio.purgarRetencion(kbPool(), { actor: actorActual() }), flags.has("--json"));
      return 0;
    },
  },
  "auditar-alcance": {
    ayuda: "Compara matriz, colección servida y reglas de alcance (sale con 1 si hay diferencias).",
    correr: async (_args, flags) => {
      const a = await servicio.auditarAlcance();
      imprimir(a, flags.has("--json"));
      return a.ok ? 0 : 1;
    },
  },
  "recalcular-nombres": {
    ayuda: "Vuelve a nombrar las páginas con su nombre descriptivo (matriz e índice).",
    correr: async (_args, flags) => {
      const cambios = await servicio.recalcularNombres(kbPool(), actorActual());
      imprimir(cambios, flags.has("--json"));
      return 0;
    },
  },
  "recalcular-direcciones": {
    ayuda: "Vuelve a aplicar el mapa de direcciones a la matriz y al índice.",
    correr: async (_args, flags) => {
      const cambios = await servicio.recalcularDirecciones(kbPool(), actorActual());
      imprimir(cambios, flags.has("--json"));
      return 0;
    },
  },
};

export function registrarComando(nombre: string, ayuda: string, correr: Comando): void {
  COMANDOS[nombre] = { ayuda, correr };
}

function ayuda(): void {
  console.log("Uso: kb <comando> [opciones]\n");
  for (const [nombre, { ayuda: texto }] of Object.entries(COMANDOS)) console.log(`  ${nombre.padEnd(24)} ${texto}`);
}

/** Errores de conexión a PostgreSQL o Qdrant → código 2. */
function esInfraestructura(error: unknown): boolean {
  const e = error as { code?: string; message?: string; cause?: { code?: string } };
  return ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "57P01", "28P01", "3D000"].includes(e?.code ?? e?.cause?.code ?? "")
    || /fetch failed|timeout|ECONNREFUSED/i.test(e?.message ?? "");
}

export async function ejecutar(argv: string[]): Promise<number> {
  const [nombre, ...resto] = argv;
  const flags = new Set(resto.filter(a => a.startsWith("--")));
  // --informe ruta  →  --informe=ruta (igual con --salida)
  for (const opcion of ["--informe", "--salida"]) {
    const i = resto.indexOf(opcion);
    if (i >= 0 && resto[i + 1]) { flags.delete(opcion); flags.add(`${opcion}=${resto[i + 1]}`); resto.splice(i + 1, 1); }
  }
  const args = resto.filter(a => !a.startsWith("--"));
  if (!nombre || nombre === "ayuda" || nombre === "--help") { ayuda(); return nombre ? 0 : 1; }
  const comando = COMANDOS[nombre];
  if (!comando) { console.error(`Comando desconocido: ${nombre}`); ayuda(); return 1; }
  try {
    return await comando.correr(args, flags);
  } catch (error) {
    if (error instanceof ErrorValidacion) { console.error(error.message); return 1; }
    console.error(error instanceof Error ? error.message : String(error));
    return esInfraestructura(error) ? 2 : 1;
  } finally {
    await cerrarPool();
  }
}

// Ejecución directa (node dist/kb/cli.js …), no al importarlo desde las pruebas.
if (process.argv[1] && /[\\/]kb[\\/]cli\.(?:js|ts)$/.test(process.argv[1])) {
  ejecutar(process.argv.slice(2)).then(codigo => { process.exitCode = codigo; });
}
