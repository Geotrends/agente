/**
 * T069 — El informe de 31 casos rechaza resultados ausentes, cantidades insuficientes, versiones
 * distintas, archivos sin corrida y componentes reales sustituidos por controlados; N309 queda fuera
 * del denominador activo; el hash del árbol incluye archivos sin seguimiento y excluye secretos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluarCaso, generarInforme, sha256Archivo, treeHash, type CasoManifiesto, type Manifiesto, type Resultado } from "../../scripts/lib/inReport.js";

const manifiesto = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/in/acceptance-manifest.json", import.meta.url)), "utf8")) as Manifiesto;

function entorno() {
  const raiz = mkdtempSync(join(tmpdir(), "gb-in-report-"));
  mkdirSync(join(raiz, "evid"), { recursive: true });
  const artefacto = (nombre: string, contenido = "salida de la corrida") => {
    const ruta = `evid/${nombre}.log`;
    writeFileSync(join(raiz, ruta), contenido);
    return { ruta, sha256: sha256Archivo(join(raiz, ruta)) };
  };
  const res = (caso: CasoManifiesto, componente: Resultado["componente"], over: Partial<Resultado> = {}): Resultado => ({
    runId: `run-${caso.id}-${componente}`, caseId: caso.id, componente, real: !["C", "DB"].includes(componente), resultado: "pass",
    cantidades: caso.cantidades, version: { treeHash: "v1" }, startedAt: "2026-10-10T00:00:00Z", finishedAt: "2026-10-10T00:01:00Z",
    artefacto: artefacto(`${caso.id}-${componente}`), ...over,
  });
  return { raiz, res, artefacto };
}
const caso = (id: string): CasoManifiesto => manifiesto.casos.find(c => c.id === id)!;

test("manifiesto: 31 casos, 30 activos y N309 descartado; sin resultados todo queda pendiente", () => {
  const { raiz } = entorno();
  assert.equal(manifiesto.casos.length, 31);
  const i = generarInforme(manifiesto, [], raiz);
  assert.equal(i.resumen.activos, 30);
  assert.equal(i.resumen.descartado, 1);
  assert.equal(i.resumen.pendiente, 30);
  assert.equal(i.casos.find(c => c.id === "N309")!.estado, "descartado");
  assert.equal(i.completo, false);
});

test("un archivo de prueba o un resultado sin corrida/huella válida no acredita nada", () => {
  const { raiz, res } = entorno();
  const c = caso("N310");
  const sinArchivo = { ...res(c, "C"), artefacto: { ruta: "evid/no-existe.log", sha256: "0".repeat(64) } };
  assert.equal(evaluarCaso(c, [sinArchivo], raiz).estado, "pendiente");
  assert.match(evaluarCaso(c, [sinArchivo], raiz).problemas.join(" "), /no existe/);
  const huellaMala = { ...res(c, "C"), artefacto: { ...res(c, "C").artefacto, sha256: "f".repeat(64) } };
  assert.match(evaluarCaso(c, [huellaMala], raiz).problemas.join(" "), /huella/);
});

test("cantidades insuficientes y versiones distintas dejan el caso pendiente", () => {
  const { raiz, res } = entorno();
  const c = caso("C301");
  const corta = { ...c.cantidades, anonimas: 3 };
  const r1 = evaluarCaso(c, ["C", "DB", "A", "P"].map(k => res(c, k as never, { cantidades: corta })), raiz);
  assert.equal(r1.estado, "pendiente");
  assert.match(r1.problemas.join(" "), /cantidad «anonimas»/);
  const v = evaluarCaso(c, [res(c, "C"), res(c, "DB", { version: { treeHash: "v2" } }), res(c, "A"), res(c, "P")], raiz);
  assert.equal(v.estado, "pendiente");
  assert.match(v.problemas.join(" "), /versiones distintas/);
});

test("un componente real no se sustituye por uno controlado", () => {
  const { raiz, res } = entorno();
  const c = caso("N308"); // exige A
  const falsa = res(c, "A", { real: false });
  const r = evaluarCaso(c, [falsa], raiz);
  assert.equal(r.estado, "pendiente");
  assert.match(r.problemas.join(" "), /no sustituye al componente real A/);
  assert.deepEqual(r.faltantes, ["A"]);
});

test("estados: controlado_conforme solo cuando la fuente exige simulación; real_conforme con todas las partes reales; fallo prevalece", () => {
  const { raiz, res } = entorno();
  const n310 = caso("N310"); // C únicamente
  assert.equal(evaluarCaso(n310, [res(n310, "C")], raiz).estado, "controlado_conforme");
  const c301 = caso("C301");
  const solo = evaluarCaso(c301, [res(c301, "C"), res(c301, "DB")], raiz);
  assert.equal(solo.estado, "pendiente", "la parte controlada no completa un caso que exige A/P");
  assert.deepEqual(solo.faltantes.sort(), ["A", "P"]);
  const todo = evaluarCaso(c301, ["C", "DB", "A", "P"].map(k => res(c301, k as never)), raiz);
  assert.equal(todo.estado, "real_conforme");
  const falla = evaluarCaso(c301, [res(c301, "C"), res(c301, "DB", { resultado: "fail" })], raiz);
  assert.equal(falla.estado, "fallo");
});

test("30 activos conformes + N309 descartado = informe completo; con un fallo no", () => {
  const { raiz, res } = entorno();
  const todos = manifiesto.casos.filter(c => c.estado !== "descartado").flatMap(c => c.componentes_requeridos.map(k => res(c, k)));
  const i = generarInforme(manifiesto, todos, raiz, "v1");
  assert.equal(i.resumen.conformes, 30);
  assert.equal(i.completo, true);
  const roto = generarInforme(manifiesto, todos.map((r, k) => (k === 0 ? { ...r, resultado: "fail" as const } : r)), raiz);
  assert.equal(roto.completo, false);
  assert.equal(roto.resumen.fallo, 1);
});

test("hash del árbol: cambia con un archivo SIN seguimiento y no se altera con secretos ni evidencias", () => {
  const raiz = mkdtempSync(join(tmpdir(), "gb-tree-"));
  mkdirSync(join(raiz, "backend/src"), { recursive: true });
  mkdirSync(join(raiz, "specs/x/evidencias"), { recursive: true });
  writeFileSync(join(raiz, "backend/src/a.ts"), "export const a = 1;\n");
  const destinos = ["backend/src", ".env", "backend/.env.local"];
  const h0 = treeHash(raiz, destinos);
  writeFileSync(join(raiz, "backend/src/nuevo-sin-seguimiento.ts"), "export const b = 2;\n");
  const h1 = treeHash(raiz, destinos);
  assert.notEqual(h1, h0, "un archivo nuevo sin seguimiento cambia el hash");
  writeFileSync(join(raiz, ".env"), "AWS_ACCESS_KEY_ID=AKIASECRETO\n");
  writeFileSync(join(raiz, "backend/.env.local"), "X=1\n");
  assert.equal(treeHash(raiz, destinos), h1, "los secretos no se leen ni afectan el hash");
  writeFileSync(join(raiz, "specs/x/evidencias/r.json"), "{}");
  assert.equal(treeHash(raiz, [...destinos, "specs"]), h1, "la propia evidencia no cambia la versión");
});
