/**
 * Servidores locales de prueba: host (fixture del Observatorio) e iframe (export de Next en `out/`).
 * Son orígenes distintos. La variante de CSP de prueba permite SOLO el origen del fixture y nunca
 * se usa en producción (RNF-C4-IN-02).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const HOST_PORT = Number(process.env.E2E_HOST_PORT ?? 4310);
const CHAT_PORT = Number(process.env.E2E_CHAT_PORT ?? 4311);
export const HOST_ORIGIN = `http://localhost:${HOST_PORT}`;
export const CHAT_ORIGIN = `http://localhost:${CHAT_PORT}`;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json",
};

async function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(body);
}

function safeJoin(base: string, urlPath: string): string | null {
  const full = normalize(join(base, urlPath));
  return full.startsWith(base) ? full : null;
}

function hostServer() {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", HOST_ORIGIN).pathname;
    try {
      if (path === "/observatorio") {
        const html = (await readFile(join(root, "test/fixtures/observatorio.html"), "utf8")).replaceAll("{{CHAT_ORIGIN}}", CHAT_ORIGIN);
        return send(res, 200, html, TYPES[".html"]);
      }
      if (path === "/embed/geobot-launcher.js") {
        return send(res, 200, await readFile(join(root, "public/embed/geobot-launcher.js")), TYPES[".js"]);
      }
      return send(res, 404, "no encontrado", "text/plain");
    } catch {
      return send(res, 404, "no encontrado", "text/plain");
    }
  });
}

/** CSP real generada por build-csp.mjs para la variante de pruebas; respaldo: solo frame-ancestors. */
function chatCsp(): string {
  try {
    const m = readFileSync(join(root, "csp-chat.e2e.conf"), "utf8").match(/Content-Security-Policy "([^"]+)"/);
    if (m) return m[1];
  } catch { /* sin generar todavía */ }
  return `frame-ancestors ${HOST_ORIGIN}`;
}

function chatServer() {
  return createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", CHAT_ORIGIN).pathname;
    const out = join(root, "out");
    const candidates = path === "/" ? ["index.html"] : [path.slice(1), `${path.slice(1)}.html`, join(path.slice(1), "index.html")];
    for (const c of candidates) {
      const full = safeJoin(out, c);
      if (!full) continue;
      try {
        const body = await readFile(full);
        const isHtml = extname(full) === ".html";
        return send(res, 200, body, TYPES[extname(full)] ?? "application/octet-stream",
          isHtml ? { "Content-Security-Policy": chatCsp() } : {});
      } catch { /* siguiente candidato */ }
    }
    return send(res, 404, "no encontrado", "text/plain");
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  hostServer().listen(HOST_PORT, () => console.log(`host ${HOST_ORIGIN}`));
  chatServer().listen(CHAT_PORT, () => console.log(`chat ${CHAT_ORIGIN}`));
}
