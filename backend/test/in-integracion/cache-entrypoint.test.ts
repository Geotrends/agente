/**
 * T040 — Entrada nginx efectiva y caché (RNF-C3-IN-12, RF-C4-IN-04).
 *
 * Levanta la imagen REAL de nginx (la del Dockerfile del frontend) con el `frontend/nginx.conf` del
 * repositorio, cambiando solo el destino `$backend` (la app IN corre en el host) y, para la prueba de
 * 504, el `proxy_read_timeout`. Verifica Cache-Control: no-store ÚNICO y cuerpo en catálogo en los
 * éxitos y en todos los rechazos (401/403/413/429 y los 502/503/504 que genera el propio proxy), y
 * que repetir una consulta genera dos invocaciones (nada se sirve de caché).
 *
 * Requiere Docker; si no está disponible, la prueba se omite explícitamente (no es aceptación P).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatWindow } from "../../src/chat/perimeter.js";
import { M20, ORIGIN, queueAnswers, rawRequest, startInApp, type InApp } from "./harness.js";

const IMAGE = "nginxinc/nginx-unprivileged:1.27-alpine";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function dockerAvailable(): boolean {
  try { execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }); return true; } catch { return false; }
}
const freePort = (): Promise<number> => new Promise(resolve => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

type Entrada = { base: string; stop: () => void };

async function levantarNginx(backendPort: number, readTimeout = "2s", extra: { csp?: string; htmlRoot?: string } = {}): Promise<Entrada> {
  const conf = readFileSync(fileURLToPath(new URL("../../../frontend/nginx.conf", import.meta.url)), "utf8");
  assert.match(conf, /set \$backend http:\/\/backend:4000;/);
  const port = await freePort();
  // Linux (CI): red del anfitrión y 127.0.0.1 (sin DNS). Docker Desktop (macOS/Windows): red definida
  // por el usuario —ahí existe el DNS embebido 127.0.0.11 que usa `resolver`— y host.docker.internal.
  const hostNet = process.platform === "linux";
  const render = conf
    .replace("set $backend http://backend:4000;", `set $backend http://${hostNet ? "127.0.0.1" : "host.docker.internal"}:${backendPort};`)
    .replaceAll("proxy_read_timeout 45s;", `proxy_read_timeout ${readTimeout};`)
    .replace("listen 8080;", `listen ${hostNet ? port : 8080};`);
  const dir = mkdtempSync(join(tmpdir(), "gb-nginx-"));
  writeFileSync(join(dir, "default.conf"), render);
  writeFileSync(join(dir, "csp-chat.conf"), extra.csp ?? 'add_header Content-Security-Policy "frame-ancestors https://observatorioenvigado.geotrends.co" always;\n');
  const name = `gb-in-nginx-${port}`;
  const red: string[] = hostNet ? ["--network", "host"] : ["--network", "gb-in-net", "-p", `127.0.0.1:${port}:8080`];
  if (!hostNet) { try { execFileSync("docker", ["network", "create", "gb-in-net"], { stdio: "ignore" }); } catch { /* ya existe */ } }
  execFileSync("docker", ["run", "-d", "--rm", "--name", name, ...red,
    "-v", `${join(dir, "default.conf")}:/etc/nginx/conf.d/default.conf:ro`,
    "-v", `${join(dir, "csp-chat.conf")}:/etc/nginx/snippets/csp-chat.conf:ro`,
    // SPEC008: el snippet real de cabeceras de seguridad que instala el Dockerfile del frontend.
    "-v", `${fileURLToPath(new URL("../../../frontend/security-headers.conf", import.meta.url))}:/etc/nginx/snippets/security-headers.conf:ro`,
    ...(extra.htmlRoot ? ["-v", `${extra.htmlRoot}:/usr/share/nginx/html:ro`] : []), IMAGE], { stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${base}/health`); break; } catch { await sleep(250); }
  }
  return { base, stop: () => { try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch { /* ya detenido */ } } };
}

const JSON_H = { "content-type": "application/json", origin: ORIGIN };
const catalogo = (b: unknown): boolean => {
  const e = (b as { error?: { codigo?: string; mensaje?: string }; canales?: unknown }).error;
  return typeof e?.codigo === "string" && typeof e?.mensaje === "string" && Array.isArray((b as { canales?: unknown }).canales);
};

test("nginx real: no-store único y catálogo en éxito, validación, 401/403/413/429 y errores del proxy 502/504", { skip: !dockerAvailable() && "Docker no disponible" }, async () => {
  const c: InApp = await startInApp();
  let nginx: Entrada | undefined;
  const prevLimit = process.env.CHAT_RATE_LIMIT_PER_MINUTE;
  try {
    nginx = await levantarNginx(c.port);
    const api = `${nginx.base}/api`;
    const nostore = (r: Response, nombre: string) => {
      assert.equal(r.headers.get("cache-control"), "no-store", `${nombre}: Cache-Control`);
    };

    // Clases N312: éxito, 503 del backend, valoración y validación.
    const tk = (await (await fetch(`${api}/session`, { method: "POST", headers: { origin: ORIGIN } })).json()).token as string;
    nostore(await fetch(`${api}/chat/config`), "config");
    const conv = await (await fetch(`${api}/conversations`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: JSON.stringify({ autorizacion: true, policyVersion: "2026-10" }) })).json();
    queueAnswers(c, 3, M20);
    const ok = await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: JSON.stringify({ pregunta: "¿Qué requisitos tiene?", conversationId: conv.conversationId }) });
    assert.equal(ok.status, 200); nostore(ok, "éxito");
    const rid = (await ok.json()).responseId as string;
    const valoracion = await fetch(`${api}/ratings`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: JSON.stringify({ responseId: rid, valoracion: "Útil" }) });
    assert.equal(valoracion.status, 201); nostore(valoracion, "valoración");
    const validacion = await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: JSON.stringify({}) });
    assert.equal(validacion.status, 400); nostore(validacion, "validación"); assert.ok(catalogo(await validacion.json()));
    c.failSearch.on = true;
    const indisponible = await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: JSON.stringify({ pregunta: "¿y el plazo?" }) });
    assert.equal(indisponible.status, 503); nostore(indisponible, "503 del backend"); assert.ok(catalogo(await indisponible.json()));
    c.failSearch.on = false;

    // Rechazos tempranos del backend: 401, 403, 429; y el 413 que genera nginx.
    const sin = await fetch(`${api}/chat`, { method: "POST", headers: JSON_H, body: JSON.stringify({ pregunta: "x" }) });
    assert.equal(sin.status, 401); nostore(sin, "401"); assert.ok(catalogo(await sin.json()));
    const ajeno = await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, origin: "https://malo.example", authorization: `Bearer ${tk}` }, body: "{}" });
    assert.equal(ajeno.status, 403); nostore(ajeno, "403"); assert.ok(catalogo(await ajeno.json()));
    const grande = await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: JSON.stringify({ pregunta: "a".repeat(131_100) }) });
    assert.equal(grande.status, 413); nostore(grande, "413 del proxy"); assert.ok(catalogo(await grande.json()));
    assert.match(grande.headers.get("content-type") ?? "", /json/);
    for (let i = 0; i < 70; i++) await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: "{}" });
    const limitado = await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: JSON.stringify({ pregunta: "x" }) });
    assert.equal(limitado.status, 429); nostore(limitado, "429"); assert.ok(Number(limitado.headers.get("retry-after")) >= 1); assert.ok(catalogo(await limitado.json()));

    // 504 del proxy: el backend tarda más que proxy_read_timeout (2 s en esta prueba).
    chatWindow.reset();
    c.delays.search = 4_000;
    queueAnswers(c, 1, M20);
    const tk2 = (await (await fetch(`${api}/session`, { method: "POST", headers: { origin: ORIGIN, "x-forwarded-for": "9.9.9.9" } })).json()).token as string;
    const lento = await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk2}`, "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ pregunta: "lenta" }) });
    assert.equal(lento.status, 504); nostore(lento, "504 del proxy");
    const cuerpo504 = await lento.json();
    assert.ok(catalogo(cuerpo504));
    assert.ok(!JSON.stringify(cuerpo504).match(/nginx|upstream|host\.docker|backend|timed out/i), "sin detalles técnicos");
    c.delays.search = 0;

    // 502/503 del proxy: backend inalcanzable.
    await c.close();
    const caido = await fetch(`${api}/chat/config`);
    assert.ok([502, 503].includes(caido.status), `estado ${caido.status}`);
    nostore(caido, "error del proxy sin backend");
    assert.ok(catalogo(await caido.json()));
  } finally {
    if (prevLimit === undefined) delete process.env.CHAT_RATE_LIMIT_PER_MINUTE; else process.env.CHAT_RATE_LIMIT_PER_MINUTE = prevLimit;
    nginx?.stop();
    await c.close().catch(() => {});
  }
});

test("nginx real: repetir la misma consulta generada produce dos invocaciones al modelo", { skip: !dockerAvailable() && "Docker no disponible" }, async () => {
  const c = await startInApp();
  let nginx: Entrada | undefined;
  try {
    nginx = await levantarNginx(c.port, "10s");
    const api = `${nginx.base}/api`;
    const tk = (await (await fetch(`${api}/session`, { method: "POST", headers: { origin: ORIGIN } })).json()).token as string;
    queueAnswers(c, 2, M20);
    const antes = c.counters.modelCalls;
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${api}/chat`, { method: "POST", headers: { ...JSON_H, authorization: `Bearer ${tk}` }, body: JSON.stringify({ pregunta: "¿Qué requisitos tiene el trámite?" }) });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.ok(!r.headers.get("etag") && !r.headers.get("last-modified") && !r.headers.get("age"));
      await r.json();
    }
    assert.equal(c.counters.modelCalls - antes, 2, "dos solicitudes iguales → dos invocaciones, ninguna servida de caché");
  } finally {
    nginx?.stop();
    await c.close();
  }
});

test("nginx real: un cuerpo lento cuenta contra el plazo desde la recepción (proxy_request_buffering off)", { skip: !dockerAvailable() && "Docker no disponible" }, async () => {
  const previo = process.env.CHAT_DEADLINE_MS;
  process.env.CHAT_DEADLINE_MS = "5000";
  const c = await startInApp();
  let nginx: Entrada | undefined;
  try {
    nginx = await levantarNginx(c.port, "20s");
    const puerto = Number(new URL(nginx.base).port);
    const tk = (await (await fetch(`${nginx.base}/api/session`, { method: "POST", headers: { origin: ORIGIN } })).json()).token as string;
    queueAnswers(c, 1, M20);
    const cuerpo = JSON.stringify({ pregunta: "cuerpo que tarda en llegar al proxy" });
    const trozos = [cuerpo.slice(0, 10), cuerpo.slice(10, 20), cuerpo.slice(20, 30), cuerpo.slice(30)];
    const r = await rawRequest(c, { port: puerto, path: "/chat", headers: { authorization: `Bearer ${tk}` }, chunks: trozos, gapMs: 2_000 });
    // Con buffering previo, nginx esperaría los 8 s del cuerpo y el reloj del backend arrancaría después: 200.
    assert.equal(r.status, 503, `estado ${r.status}`);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.ok(r.elapsedMs <= 6_500, `el error salió en ${r.elapsedMs} ms (plazo 5 s desde la recepción)`);
    assert.equal(c.counters.modelCalls, 0);
  } finally {
    if (previo === undefined) delete process.env.CHAT_DEADLINE_MS; else process.env.CHAT_DEADLINE_MS = previo;
    nginx?.stop();
    await c.close();
  }
});

test("nginx real: /chat lleva UNA CSP de producción con frame-ancestors solo del Observatorio y sin X-Frame-Options", { skip: !dockerAvailable() && "Docker no disponible" }, async () => {
  const frontend = fileURLToPath(new URL("../../../frontend", import.meta.url));
  const out = join(frontend, "out");
  try { readFileSync(join(out, "chat.html")); } catch { assert.fail("falta frontend/out (npm --prefix frontend run build:e2e)"); }
  const tmp = mkdtempSync(join(tmpdir(), "gb-csp-prod-"));
  const conf = join(tmp, "csp-prod.conf");
  // Variante de PRODUCCIÓN: sin --ancestor, usa el origen oficial por defecto.
  execFileSync("node", [join(frontend, "scripts/build-csp.mjs"), "--out", out, "--target", conf], { stdio: "ignore" });
  const c = await startInApp();
  let nginx: Entrada | undefined;
  try {
    nginx = await levantarNginx(c.port, "10s", { csp: readFileSync(conf, "utf8"), htmlRoot: out });
    const r = await fetch(`${nginx.base}/chat`);
    assert.equal(r.status, 200);
    const csp = r.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("frame-ancestors https://observatorioenvigado.geotrends.co"));
    assert.equal(csp.match(/frame-ancestors/g)?.length, 1, "una sola directiva frame-ancestors");
    assert.ok(!/frame-ancestors[^;]*(\*|'self'|localhost|http:)/.test(csp));
    assert.equal(r.headers.get("x-frame-options"), null, "ningún X-Frame-Options contradictorio");
    assert.ok(!csp.includes("unsafe-inline"));
    // (La API JSON conserva los encabezados de helmet; no es un documento que se incruste.)
    assert.notEqual(new URL(ORIGIN).origin, "https://observatorioenvigado.geotrends.co", "el origen del ChatBot no es el del Observatorio");
  } finally {
    nginx?.stop();
    await c.close();
  }
});
