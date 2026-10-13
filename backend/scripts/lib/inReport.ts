/**
 * Informe de aceptación de SPEC005 (T069/T071, RNF-C3-IN-09, constitución IX/X).
 *
 * Un caso solo avanza por RESULTADOS de corridas efectivas —no por la existencia de archivos—:
 *  - cada resultado cita un artefacto cuyo SHA-256 coincide con el archivo en disco;
 *  - las cantidades del manifiesto deben estar cubiertas por resultados que pasan;
 *  - todos los resultados de un caso comparten la misma versión (hash del árbol, incluidos archivos
 *    sin seguimiento relevantes, sin secretos);
 *  - un componente real (A/P/H/B) solo lo cubre un resultado marcado `real: true`; uno controlado
 *    (C/DB) no sustituye a un real.
 * Estados: pendiente · controlado_conforme · real_conforme · fallo · descartado. N309 queda fuera del
 * denominador activo.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Componente = "C" | "DB" | "A" | "P" | "H" | "B";
export const REALES: readonly Componente[] = ["A", "P", "H", "B"];
export type Estado = "pendiente" | "controlado_conforme" | "real_conforme" | "fallo" | "descartado";

export type CasoManifiesto = {
  id: string; requisito: string; cantidades: Record<string, unknown>;
  componentes_requeridos: Componente[]; estado: string; nota?: string;
};
export type Manifiesto = { casos: CasoManifiesto[] };

export type Resultado = {
  runId: string; caseId: string; componente: Componente;
  /** true solo si la corrida usó el componente real (AWS, nginx desplegado, portal, dispositivo…). */
  real: boolean;
  resultado: "pass" | "fail";
  /** Cantidades que ESTA corrida cubrió y verificó. */
  cantidades: Record<string, unknown>;
  version: { treeHash: string; commit?: string };
  startedAt: string; finishedAt: string;
  /** Archivo de evidencia (ruta relativa a la raíz) y su huella. */
  artefacto: { ruta: string; sha256: string };
  revisor?: string;
  nota?: string;
};

export type InformeCaso = {
  id: string; requisito: string; estado: Estado;
  requeridos: Componente[]; cubiertos: Componente[]; faltantes: Componente[];
  problemas: string[]; resultados: number;
};

export type Informe = {
  generado: string; version: string | null;
  casos: InformeCaso[];
  resumen: Record<Estado, number> & { activos: number; conformes: number };
  completo: boolean;
};

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

/** Hash del árbol relevante: contenido de archivos versionados y NO versionados, sin secretos ni artefactos. */
export function treeHash(raiz: string, destinos: string[], excluir: RegExp[] = DEFAULT_EXCLUDE): string {
  const lineas: string[] = [];
  const visita = (ruta: string): void => {
    let st; try { st = statSync(ruta); } catch { return; }
    const rel = relative(raiz, ruta);
    if (excluir.some(r => r.test(rel))) return;
    if (st.isDirectory()) { for (const n of readdirSync(ruta).sort()) visita(join(ruta, n)); return; }
    if (st.size > 5_000_000) return;
    lineas.push(`${rel}\0${sha256(readFileSync(ruta))}`);
  };
  for (const d of destinos) visita(join(raiz, d));
  return sha256(lineas.join("\n"));
}

/** Nunca se leen secretos ni artefactos regenerables ni la propia evidencia (cambia con cada informe). */
export const DEFAULT_EXCLUDE: RegExp[] = [
  /(^|\/)\.env($|\.)/, /(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)\.next\//, /(^|\/)dist\//, /(^|\/)out\//,
  /(^|\/)\.cache\//, /(^|\/)var\//, /(^|\/)test-results\//, /(^|\/)playwright-report\//, /(^|\/)evidencias\//,
  /\.tsbuildinfo$/, /(^|\/)csp-chat(\.e2e)?\.conf$/, /\.log$/, /\.DS_Store$/,
];

export const RAIZ_ARBOL = ["backend/src", "backend/migrations", "backend/config", "backend/scripts", "backend/test", "backend/package.json", "backend/package-lock.json",
  "frontend/app", "frontend/chat", "frontend/shared", "frontend/widget", "frontend/scripts", "frontend/test", "frontend/public", "frontend/nginx.conf",
  "frontend/package.json", "frontend/package-lock.json", "docker-compose.yml", ".env.example", ".github"];

const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Evalúa un caso con los resultados disponibles. `raiz` permite verificar los artefactos. */
export function evaluarCaso(caso: CasoManifiesto, resultados: Resultado[], raiz: string): InformeCaso {
  const base = { id: caso.id, requisito: caso.requisito, requeridos: caso.componentes_requeridos };
  if (caso.estado === "descartado") {
    return { ...base, estado: "descartado", cubiertos: [], faltantes: [], problemas: ["descartado por la fuente; sin trabajo de rotación de llaves"], resultados: 0 };
  }
  const problemas: string[] = [];
  const mios = resultados.filter(r => r.caseId === caso.id);
  const validos: Resultado[] = [];
  for (const r of mios) {
    const archivo = join(raiz, r.artefacto.ruta);
    if (!existsSync(archivo)) { problemas.push(`${r.runId}: el artefacto ${r.artefacto.ruta} no existe`); continue; }
    if (sha256(readFileSync(archivo)) !== r.artefacto.sha256) { problemas.push(`${r.runId}: la huella del artefacto no coincide`); continue; }
    if (REALES.includes(r.componente) && !r.real) { problemas.push(`${r.runId}: un resultado controlado no sustituye al componente real ${r.componente}`); continue; }
    validos.push(r);
  }
  if (validos.some(r => r.resultado === "fail")) {
    return { ...base, estado: "fallo", cubiertos: [], faltantes: caso.componentes_requeridos, problemas: [...problemas, "al menos una corrida falló"], resultados: validos.length };
  }
  const pasan = validos.filter(r => r.resultado === "pass");
  const versiones = new Set(pasan.map(r => r.version.treeHash));
  if (versiones.size > 1) problemas.push("resultados de versiones distintas del árbol: no se combinan");
  const cubiertos = [...new Set(pasan.map(r => r.componente))] as Componente[];
  const faltantes = caso.componentes_requeridos.filter(c => !cubiertos.includes(c));
  if (faltantes.length) problemas.push(`faltan componentes: ${faltantes.join(", ")}`);
  // Cantidades: cada una del manifiesto debe estar cubierta por algún resultado que pasa.
  for (const [k, esperado] of Object.entries(caso.cantidades)) {
    if (!pasan.some(r => igual(r.cantidades[k], esperado))) problemas.push(`cantidad «${k}» no cubierta por ninguna corrida`);
  }
  const completo = faltantes.length === 0 && versiones.size <= 1 && !problemas.some(p => /cantidad|versiones/.test(p));
  const exigeReal = caso.componentes_requeridos.some(c => REALES.includes(c));
  const estado: Estado = !completo ? "pendiente" : exigeReal ? "real_conforme" : "controlado_conforme";
  return { ...base, estado, cubiertos, faltantes, problemas, resultados: validos.length };
}

export function generarInforme(manifiesto: Manifiesto, resultados: Resultado[], raiz: string, version: string | null = null): Informe {
  const casos = manifiesto.casos.map(c => evaluarCaso(c, resultados, raiz));
  const conteo = (e: Estado) => casos.filter(c => c.estado === e).length;
  const activos = casos.filter(c => c.estado !== "descartado").length;
  const conformes = casos.filter(c => c.estado === "real_conforme" || c.estado === "controlado_conforme").length;
  return {
    generado: new Date().toISOString(), version, casos,
    resumen: { pendiente: conteo("pendiente"), controlado_conforme: conteo("controlado_conforme"), real_conforme: conteo("real_conforme"), fallo: conteo("fallo"), descartado: conteo("descartado"), activos, conformes },
    completo: activos === 30 && conformes === 30 && casos.every(c => c.estado !== "fallo"),
  };
}

export const sha256Archivo = (ruta: string): string => sha256(readFileSync(ruta));
