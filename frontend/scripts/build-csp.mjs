// Genera la CSP de /chat a partir del HTML exportado (T028). Los scripts en línea de Next llevan hash
// SHA-256; así no hace falta 'unsafe-inline'. Escribe un include de nginx; no hay valores a mano.
//   node scripts/build-csp.mjs [--out <dir export>] [--target <archivo .conf>] [--ancestor <origen>]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const outDir = resolve(root, arg("--out", "out"));
const target = resolve(root, arg("--target", "csp-chat.conf"));
// Producción: únicamente el Observatorio oficial. La variante de pruebas pasa su origen aparte.
const ancestor = arg("--ancestor", "https://observatorioenvigado.geotrends.co");
if (!/^https:\/\/[^\s/*]+$/.test(ancestor) && !/^http:\/\/localhost(:\d+)?$/.test(ancestor)) {
  console.error(`Origen de incrustación inválido: ${ancestor}`);
  process.exit(1);
}

const html = readFileSync(resolve(outDir, "chat.html"), "utf8");
const hashes = new Set();
for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
  if (m[1].trim() === "") continue;
  hashes.add(`'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
}

const directives = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(" ")}`.trim(),
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  `frame-ancestors ${ancestor}`,
];
const csp = directives.join("; ");
writeFileSync(target, `add_header Content-Security-Policy "${csp}" always;\n`);
console.log(`CSP escrita en ${target} (${hashes.size} hashes de scripts en línea; frame-ancestors ${ancestor})`);
