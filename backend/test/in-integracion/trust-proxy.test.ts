/**
 * T052 — Topología de proxies (RNF-C3-IN-05): TRUST_PROXY como número de saltos o lista exacta,
 * nunca «confiar en todos»; la IP del cliente no se suplanta con cabeceras y la ventana de 60 s
 * cuenta solo consultas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseTrustProxy } from "../../src/services/trustProxy.js";
import { chatWindow } from "../../src/chat/perimeter.js";
import { M20, ORIGIN, queueAnswers, sessionToken, startInApp } from "./harness.js";

test("parseTrustProxy: números y listas exactas pasan; «confiar en todos» y basura se rechazan", () => {
  assert.deepEqual(parseTrustProxy(undefined), { value: false, problems: [] });
  assert.deepEqual(parseTrustProxy("  "), { value: false, problems: [] });
  assert.deepEqual(parseTrustProxy("1"), { value: 1, problems: [] });
  assert.deepEqual(parseTrustProxy("2"), { value: 2, problems: [] });
  assert.deepEqual(parseTrustProxy("10.0.0.0/8, 172.16.0.5, loopback"), { value: ["10.0.0.0/8", "172.16.0.5", "loopback"], problems: [] });
  assert.deepEqual(parseTrustProxy("fd00::/8,::1"), { value: ["fd00::/8", "::1"], problems: [] });
  for (const malo of ["true", "*", "0.0.0.0/0", "::/0", "0", "11", "999.1.1.1", "abc", "10.0.0.1, true"]) {
    const r = parseTrustProxy(malo);
    assert.equal(r.value, false, malo);
    assert.ok(r.problems.length > 0, malo);
  }
});

async function conTrust<T>(valor: string, fn: (c: Awaited<ReturnType<typeof startInApp>>) => Promise<T>): Promise<T> {
  const previo = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = valor;
  const c = await startInApp();
  try { return await fn(c); } finally {
    await c.close();
    if (previo === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previo;
  }
}
const consulta = (base: string, tk: string, xff: string) => fetch(`${base}/chat`, {
  method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, authorization: `Bearer ${tk}`, "x-forwarded-for": xff },
  body: JSON.stringify({ pregunta: "¿Qué requisitos tiene?" }) });

test("TRUST_PROXY=2 (Traefik → nginx): falsificar la izquierda de X-Forwarded-For no evita el límite; otro cliente no comparte cupo", async () => {
  await conTrust("2", async c => {
    chatWindow.reset();
    const tk = await sessionToken(c);
    queueAnswers(c, 70, M20);
    // Cadena real: cliente 5.5.5.5 → Traefik 10.9.9.9 → nginx (socket). El cliente antepone IP falsas.
    let limitadas = 0;
    for (let i = 0; i < 65; i++) {
      const r = await consulta(c.base, tk, `1.2.3.${i}, 5.5.5.5, 10.9.9.9`);
      if (r.status === 429) limitadas++;
      await r.text();
    }
    assert.equal(limitadas, 5, "60 pasan y 5 se limitan aunque cambie la cabecera falsa");
    const otro = await consulta(c.base, tk, "9.9.9.9, 6.6.6.6, 10.9.9.9");
    assert.equal(otro.status, 200, "otra IP real tiene su propio cupo");
    await otro.text();
  });
});

test("TRUST_PROXY=1 con un proxy más delante: todos comparten la IP del proxy (el aviso [proxy] existe para detectarlo)", async () => {
  await conTrust("1", async c => {
    chatWindow.reset();
    const tk = await sessionToken(c);
    queueAnswers(c, 70, M20);
    let limitadas = 0;
    // Con 1 salto solo se confía en el socket: la IP resuelta es la última de la cadena (el proxy).
    for (let i = 0; i < 61; i++) {
      const r = await consulta(c.base, tk, `1.2.3.${i}, 5.5.5.${i % 3}, 10.9.9.9`);
      if (r.status === 429) limitadas++;
      await r.text();
    }
    assert.equal(limitadas, 1, "todos cuentan como la IP del proxy: cupo global");
  });
});
