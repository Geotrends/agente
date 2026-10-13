/**
 * Recolecta RESULTADOS controlados (C y DB) de SPEC005 ejecutando de verdad las suites que cubren
 * cada caso y guardando su salida como artefacto con huella. No fabrica resultados reales: los
 * componentes A/P/H/B solo los aportan corridas en el entorno autorizado (ver `quickstart.md`).
 *
 *   npx tsx scripts/in-collect-results.ts [--only=C301,N304] [--no-frontend]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RAIZ_ARBOL, sha256Archivo, treeHash, type Componente, type Manifiesto, type Resultado } from "./lib/inReport.js";

const raiz = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const only = arg("only")?.split(",");
const sinFrontend = process.argv.includes("--no-frontend");

type Corrida = { tipo: "backend" | "playwright"; archivo: string; componente: Componente };
const B = (a: string, c: Componente = "DB"): Corrida => ({ tipo: "backend", archivo: a, componente: c });
const P = (a: string): Corrida => ({ tipo: "playwright", archivo: a, componente: "C" });
const BC = (a: string): Corrida => B(a, "C");

/** Qué suites cubren qué caso (componentes controlados; los reales no se infieren). */
const MAPA: Record<string, Corrida[]> = {
  C301: [B("test/di-integracion/consent.test.ts"), BC("test/di-integracion/consent.test.ts"), P("test/in-continuity.spec.ts")],
  C302: [B("test/di-integracion/consent.test.ts"), BC("test/di-integracion/consent.test.ts")],
  C303: [B("test/in-integracion/results-records.test.ts"), BC("test/in-integracion/results-records.test.ts"), BC("test/in-integracion/public-response.test.ts")],
  C304: [B("test/in-integracion/end-to-end-deadline.test.ts"), BC("test/in-integracion/end-to-end-deadline.test.ts"), BC("test/di-integracion/error-contract.test.ts")],
  C305: [B("test/in-integracion/results-records.test.ts"), BC("test/in-integracion/results-records.test.ts")],
  C306: [B("test/di-integracion/privacy.test.ts"), BC("test/di-integracion/privacy.test.ts")],
  C307: [B("test/di-integracion/privacy.test.ts"), BC("test/di-integracion/privacy.test.ts")],
  C308: [B("test/in-integracion/registry-episode.test.ts"), BC("test/in-integracion/registry-episode.test.ts"), BC("test/di-integracion/consumption.test.ts")],
  C309: [B("test/ui-integracion/feedback-api.test.ts"), BC("test/ui-integracion/feedback-api.test.ts"), B("test/ui-integracion/feedback-database.test.ts"), P("test/feedback.spec.ts")],
  C310: [B("test/in-integracion/contacts-config.test.ts"), BC("test/in-integracion/contacts-config.test.ts")],
  C401: [P("test/in-continuity.spec.ts"), B("test/di-integracion/consent.test.ts")],
  C402: [P("test/in-continuity.spec.ts"), B("test/di-integracion/consent.test.ts")],
  C403: [P("test/query-integration.spec.ts")],
  C404: [P("test/query-integration.spec.ts")],
  C405: [P("test/feedback.spec.ts"), B("test/ui-integracion/feedback-api.test.ts")],
  C406: [P("test/query-integration.spec.ts")],
  N301: [B("test/di-integracion/consumption.test.ts"), B("test/in-integracion/purge-scheduler.test.ts")],
  N304: [BC("test/di-integracion/chat-perimeter.test.ts")],
  N305: [BC("test/di-integracion/chat-perimeter.test.ts"), BC("test/in-integracion/trust-proxy.test.ts")],
  N306: [BC("test/di-integracion/chat-perimeter.test.ts"), BC("test/in-integracion/cache-entrypoint.test.ts")],
  N310: [BC("test/in-integracion/secret-redaction.test.ts")],
  N311: [BC("test/in-integracion/injection-matrix.test.ts")],
  N312: [BC("test/in-integracion/cache-entrypoint.test.ts"), B("test/in-integracion/results-records.test.ts")],
  N401: [P("test/storage.spec.ts")],
  N402: [P("test/widget-csp.spec.ts"), BC("test/in-integracion/cache-entrypoint.test.ts")],
};

const manifiesto = JSON.parse(readFileSync(join(raiz, "backend/test/fixtures/in/acceptance-manifest.json"), "utf8")) as Manifiesto;
const dirCorridas = join(raiz, "specs/005-integracion-c3-c4/evidencias/aceptacion/corridas");
const dirResultados = join(raiz, "specs/005-integracion-c3-c4/evidencias/aceptacion/resultados");
mkdirSync(dirCorridas, { recursive: true }); mkdirSync(dirResultados, { recursive: true });

const version = treeHash(raiz, RAIZ_ARBOL);
const chromium = process.env.E2E_CHROMIUM_PATH
  ?? join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell");

const cache = new Map<string, { pass: boolean; log: string; ruta: string; inicio: string; fin: string }>();
function ejecutar(c: Corrida): { pass: boolean; ruta: string; inicio: string; fin: string } {
  const clave = `${c.tipo}:${c.archivo}`;
  const hit = cache.get(clave);
  if (hit) return hit;
  const inicio = new Date().toISOString();
  const r = c.tipo === "backend"
    ? spawnSync("node", ["--import", "tsx", "--test", "--test-concurrency=1", c.archivo], { cwd: join(raiz, "backend"), encoding: "utf8", timeout: 600_000 })
    : spawnSync("npx", ["playwright", "test", c.archivo, "--project=chromium"], { cwd: join(raiz, "frontend"), encoding: "utf8", timeout: 600_000,
        env: { ...process.env, ...(existsSync(chromium) ? { E2E_CHROMIUM_PATH: chromium } : {}) } });
  const salida = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const pass = r.status === 0;
  const nombre = `${c.tipo}-${c.archivo.replace(/[\\/]/g, "__")}.log`;
  const ruta = `specs/005-integracion-c3-c4/evidencias/aceptacion/corridas/${nombre}`;
  // El log solo trae resultados de pruebas sintéticas; se recorta para no versionar ruido.
  writeFileSync(join(raiz, ruta), `# ${c.tipo} ${c.archivo}\n# inicio ${inicio}\n# estado ${pass ? "pass" : "fail"}\n${salida.slice(-12_000)}`);
  const out = { pass, log: salida, ruta, inicio, fin: new Date().toISOString() };
  cache.set(clave, out);
  return out;
}

let n = 0;
for (const caso of manifiesto.casos) {
  const corridas = MAPA[caso.id];
  if (!corridas || (only && !only.includes(caso.id))) continue;
  for (const c of corridas) {
    if (c.tipo === "playwright" && sinFrontend) continue;
    if (!caso.componentes_requeridos.includes(c.componente) && !["C", "DB"].includes(c.componente)) continue;
    const e = ejecutar(c);
    const runId = `${caso.id}-${c.componente}-${c.archivo.split("/").pop()!.replace(/\.(test|spec)\.ts$/, "")}`;
    const resultado: Resultado = {
      runId, caseId: caso.id, componente: c.componente, real: false, resultado: e.pass ? "pass" : "fail",
      cantidades: caso.cantidades, version: { treeHash: version }, startedAt: e.inicio, finishedAt: e.fin,
      artefacto: { ruta: e.ruta, sha256: sha256Archivo(join(raiz, e.ruta)) },
      nota: "Corrida controlada: proveedor doble y/o base aislada; no acredita A/P/H/B.",
    };
    writeFileSync(join(dirResultados, `${runId}.json`), JSON.stringify(resultado, null, 2) + "\n");
    n++;
    console.log(`${e.pass ? "pass" : "FAIL"} ${runId}`);
  }
}
console.log(`${n} resultados escritos; versión ${version.slice(0, 16)}…`);
