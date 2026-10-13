// Construye el launcher independiente (RNF-C4-UI-01): esbuild, sin React ni app, y falla si pesa
// más de 10 000 bytes sin comprimir. Salida: public/embed/geobot-launcher.js.
import { build } from "esbuild";
import { mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "public/embed/geobot-launcher.js");
const LIMIT = 10_000;

mkdirSync(dirname(out), { recursive: true });
await build({
  entryPoints: [resolve(root, "widget/launcher.ts")],
  outfile: out,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2019"],
  legalComments: "none",
  logLevel: "silent",
});

const bytes = statSync(out).size;
const sha = createHash("sha256").update(readFileSync(out)).digest("hex");
writeFileSync(resolve(root, "public/embed/geobot-launcher.js.sha256"), `${sha}  geobot-launcher.js\n`);
console.log(`geobot-launcher.js: ${bytes} bytes (límite ${LIMIT}); sha256 ${sha}`);
if (bytes > LIMIT) {
  console.error(`El launcher excede ${LIMIT} bytes sin comprimir.`);
  process.exit(1);
}
