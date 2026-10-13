/**
 * Informe de aceptación de SPEC005: 31 casos (30 activos + N309 descartado) a partir de RESULTADOS
 * de corridas, no de archivos.  `npm run report:in -- [--results=<dir>] [--md=<archivo.md>] [--json=<archivo.json>]`
 * Sale con código 0 solo si los 30 activos son conformes y ninguno falla.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generarInforme, RAIZ_ARBOL, treeHash, type Informe, type Manifiesto, type Resultado } from "./lib/inReport.js";

const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const raiz = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dirResultados = resolve(raiz, arg("results") ?? "specs/005-integracion-c3-c4/evidencias/aceptacion/resultados");
const manifiesto = JSON.parse(readFileSync(join(raiz, "backend/test/fixtures/in/acceptance-manifest.json"), "utf8")) as Manifiesto;

let resultados: Resultado[] = [];
try {
  resultados = readdirSync(dirResultados).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(join(dirResultados, f), "utf8")) as Resultado);
} catch { /* sin resultados: todo queda pendiente */ }

const actual = treeHash(raiz, RAIZ_ARBOL);
const informe = generarInforme(manifiesto, resultados, raiz, actual);
const versiones = [...new Set(resultados.map(r => r.version.treeHash))];

const iconos: Record<string, string> = { pendiente: "⏳", controlado_conforme: "🟡", real_conforme: "✅", fallo: "❌", descartado: "➖" };
export function aMarkdown(i: Informe, versionesResultados: string[]): string {
  const filas = i.casos.map(c => `| ${c.id} | ${c.requisito} | ${iconos[c.estado]} ${c.estado} | ${c.requeridos.join("+") || "—"} | ${c.cubiertos.join("+") || "—"} | ${c.faltantes.join("+") || "—"} |`);
  return [
    "# Matriz de aceptación SPEC005 (generada)",
    "",
    `Generada: ${i.generado}. Hash del árbol actual: \`${i.version?.slice(0, 16)}…\`. Versiones de los resultados: ${versionesResultados.length ? versionesResultados.map(v => `\`${v.slice(0, 16)}…\``).join(", ") : "ninguna"}.`,
    "",
    `**Resumen**: ${i.resumen.conformes}/${i.resumen.activos} activos conformes · ${i.resumen.pendiente} pendientes · ${i.resumen.fallo} con fallo · ${i.resumen.descartado} descartado (N309). Informe completo: **${i.completo ? "sí" : "no"}**.`,
    "",
    "Componentes: C controlado · DB PostgreSQL real aislado · A AWS/rol/modelos reales · P entrada nginx y servicio desplegado · H Observatorio/Geoportal reales · B navegadores/lectores/dispositivos reales.",
    "",
    "| Caso | Requisito | Estado | Requeridos | Cubiertos | Faltantes |",
    "| --- | --- | --- | --- | --- | --- |",
    ...filas,
    "",
    "## Problemas por caso",
    "",
    ...i.casos.filter(c => c.problemas.length && c.estado !== "descartado").map(c => `- **${c.id}**: ${c.problemas.join("; ")}`),
    "",
  ].join("\n");
}

const md = arg("md");
const js = arg("json");
if (md) { mkdirSync(dirname(resolve(raiz, md)), { recursive: true }); writeFileSync(resolve(raiz, md), aMarkdown(informe, versiones)); }
if (js) { mkdirSync(dirname(resolve(raiz, js)), { recursive: true }); writeFileSync(resolve(raiz, js), JSON.stringify({ ...informe, versionesResultados: versiones }, null, 2) + "\n"); }
console.log(`${informe.resumen.conformes}/${informe.resumen.activos} activos conformes; ${informe.resumen.pendiente} pendientes; ${informe.resumen.fallo} con fallo; ${informe.resumen.descartado} descartado`);
if (versiones.length > 1) console.log(`AVISO: los resultados provienen de ${versiones.length} versiones distintas del árbol`);
if (versiones.length === 1 && versiones[0] !== actual) console.log("AVISO: el árbol cambió después de las corridas; repetir la recolección antes de aceptar");
process.exit(informe.completo ? 0 : 1);
