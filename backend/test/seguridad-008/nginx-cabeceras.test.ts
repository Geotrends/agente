/** SPEC008 FR-017: cabeceras de seguridad en cada location que define add_header (nginx no las hereda). */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const raiz = path.resolve(import.meta.dirname, "../../../frontend");
const conf = fs.readFileSync(path.join(raiz, "nginx.conf"), "utf8");
const snippet = fs.readFileSync(path.join(raiz, "security-headers.conf"), "utf8");

/** Bloques `location … { … }` de primer nivel (sin anidamiento en este archivo). */
function locations(): Array<{ nombre: string; cuerpo: string }> {
  return [...conf.matchAll(/^\s{2}location\s+([^{]+)\{([\s\S]*?)^\s{2}\}/gm)].map(m => ({ nombre: m[1].trim(), cuerpo: m[2] }));
}

test("el snippet fija nosniff, Referrer-Policy y Permissions-Policy", () => {
  assert.match(snippet, /add_header X-Content-Type-Options "nosniff" always;/);
  assert.match(snippet, /add_header Referrer-Policy "strict-origin-when-cross-origin" always;/);
  assert.match(snippet, /add_header Permissions-Policy "[^"]*camera=\(\)[^"]*" always;/);
});

test("todo location con add_header incluye el snippet de seguridad", () => {
  const faltan = locations()
    .filter(l => /add_header/.test(l.cuerpo) && !l.nombre.startsWith("@"))
    .filter(l => !/include \/etc\/nginx\/snippets\/security-headers\.conf;/.test(l.cuerpo))
    .map(l => l.nombre);
  assert.deepEqual(faltan, []);
});

test("el panel y la raíz no son incrustables; solo /chat admite el Observatorio", () => {
  const por = (n: string) => locations().find(l => l.nombre === n)!;
  assert.match(por("^~ /admin").cuerpo, /frame-ancestors 'none'/);
  assert.match(por("^~ /admin").cuerpo, /Cache-Control "no-store"/);
  assert.match(por("/").cuerpo, /frame-ancestors 'none'/);
  assert.match(por("= /chat").cuerpo, /csp-chat\.conf/);
  assert.doesNotMatch(por("= /chat").cuerpo, /frame-ancestors 'none'/);
});

test("el Dockerfile instala el snippet", () => {
  assert.match(fs.readFileSync(path.join(raiz, "Dockerfile"), "utf8"), /COPY security-headers\.conf \/etc\/nginx\/snippets\/security-headers\.conf/);
});
