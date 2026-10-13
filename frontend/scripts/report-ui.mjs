// Genera el reporte de los 22 casos de aceptación desde test/fixtures/ui-manifest.json (T073).
// No ejecuta pruebas: relaciona cada caso con las suites que lo cubren en modo controlado y deja
// «pendiente» todo lo que exige entorno real. No registra conversaciones reales ni secretos.
//   node scripts/report-ui.mjs [--write <archivo.md>] [--json]
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(frontend, "..");
const manifest = JSON.parse(readFileSync(resolve(frontend, "test/fixtures/ui-manifest.json"), "utf8"));
const arg = name => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };

const sha = path => existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
const git = cmd => { try { return execSync(cmd, { cwd: repo, encoding: "utf8" }).trim(); } catch { return null; } };

const identidad = {
  fecha: new Date().toISOString(),
  commit: git("git rev-parse HEAD"),
  cambiosLocales: git("git status --porcelain | wc -l")?.trim() ?? null,
  hashCambios: git("git diff HEAD | shasum -a 256 | cut -d' ' -f1"),
  matrizHash: sha(resolve(repo, manifest.matriz)),
  launcher: { bytes: existsSync(resolve(frontend, "public/embed/geobot-launcher.js")) ? readFileSync(resolve(frontend, "public/embed/geobot-launcher.js")).length : null, sha256: sha(resolve(frontend, "public/embed/geobot-launcher.js")) },
  logo: sha(resolve(frontend, "public/brand/logo-envigado.png")),
  cssOficial: "b92057e91267a58abb49a2b16fe68892847ed50667b7e72d457ab4714f488a8c (guia-estilo.md)",
  adapter: "controlled",
};

const filas = manifest.casos.map(c => {
  const faltan = c.local.filter(f => !existsSync(resolve(repo, f)));
  return {
    id: c.id, requisito: c.requisito, cantidades: c.cantidades,
    local: faltan.length === 0 ? "cubierto (controlado)" : `FALTA: ${faltan.join(", ")}`,
    suites: c.local, real: c.real, resultado: faltan.length === 0 ? "controlado ✔ / real pendiente" : "pendiente",
  };
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ identidad, filas }, null, 2));
} else {
  const md = [
    "# Matriz de aceptación SPEC004 — generada",
    "",
    "Generada por `frontend/scripts/report-ui.mjs`. **No es un acta de aceptación**: «controlado» significa API simulada, navegador emulado o base de pruebas; la aceptación real exige los entornos de la columna final.",
    "",
    "## Identidad de la corrida",
    "",
    "```json",
    JSON.stringify(identidad, null, 2),
    "```",
    "",
    "| Caso | Requisito | Cantidades | Suites locales | Estado local | Pendiente en entorno real |",
    "| --- | --- | --- | --- | --- | --- |",
    ...filas.map(f => `| ${f.id} | ${f.requisito} | ${JSON.stringify(f.cantidades)} | ${f.suites.map(s => "`" + s + "`").join("<br>")} | ${f.local} | ${f.real} |`),
    "",
    `Casos: ${filas.length}/22. Con evidencia controlada: ${filas.filter(f => f.local.startsWith("cubierto")).length}. Con evidencia real: 0.`,
    "",
  ].join("\n");
  const out = arg("--write");
  if (out) writeFileSync(resolve(repo, out), md); else console.log(md);
}
