/**
 * T051 (parte 2) — Ningún secreto sale en logs, avisos, base, HTTP ni paquete (RNF-C3-IN-10).
 *
 * Ocho escenarios con SEÑUELOS (llaves, sesión, bearer, DSN y webhook falsos) inyectados en mensajes
 * de error del SDK, de la búsqueda, de la base y en cabeceras: 4 fallos, 2 éxitos, 1 reinicio del
 * proceso y 1 revisión de código/paquete. Las aserciones nunca imprimen un señuelo ni una coincidencia
 * sensible: solo booleanos, etiquetas de escenario y conteos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { operations } from "../../src/admin/operations.js";
import { registerProcessGuards } from "../../src/services/processGuards.js";
import { hit } from "../di-support.js";
import { scanSecrets } from "../../scripts/lib/secretScan.js";
import { authorize, queueAnswers, sessionToken, startInApp } from "./harness.js";

const SENUELOS = [
  "AKIAZZZZSENUELO000001", "wJalrXUtnFEMI/K7MDENG/bPxRfiSENUELOKEY0001", "ABSKQmVkcm9ja0FQSUtleVNFTlVFTE8xMjM0",
  "IQoJb3JpZ2luX2VjSENUELO0002", "eyJhbGciOiJIUzI1NiIsInR5cCI6SENUELO", "postgres://admin:SenueloPass0003@db.interna:5432/geobot",
  "https://hooks.example.test/services/T000/B000/SENUELOWEBHOOK0004",
];
const TODOS = SENUELOS.join(" | ");
const contiene = (texto: string): number => SENUELOS.filter(s => texto.includes(s)).length;

function capturarConsola(): { texto: () => string; restaurar: () => void } {
  const lineas: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const toma = (...a: unknown[]) => { lineas.push(a.map(x => (typeof x === "string" ? x : x instanceof Error ? `${x.name}:${x.message}:${x.stack ?? ""}` : JSON.stringify(x))).join(" ")); };
  console.log = console.warn = console.error = console.info = console.debug = toma as typeof console.log;
  return { texto: () => lineas.join("\n"), restaurar: () => Object.assign(console, original) };
}

test("control negativo: el barrido detecta un señuelo que sí se escribe en el log", () => {
  const logs = capturarConsola();
  try { console.error(`fuga simulada ${SENUELOS[1]}`); assert.equal(contiene(logs.texto()), 1); } finally { logs.restaurar(); }
});

test("N310 · 8 escenarios (4 fallos, 2 éxitos, 1 reinicio, 1 revisión): 0 señuelos en logs, avisos, base, HTTP y paquete", async () => {
  const logs = capturarConsola();
  const c = await startInApp();
  const http: string[] = [];
  try {
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    const hdrs = { authorization: `Bearer ${tk}`, "x-amz-security-token": SENUELOS[3], "x-api-key": SENUELOS[2], "x-forwarded-for": "7.7.7.7" };
    const llama = async (body: unknown, extra: Record<string, string> = {}) => {
      const r = await fetch(`${c.base}/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "https://geobot.ejemplo.gov.co", ...hdrs, ...extra }, body: JSON.stringify(body) });
      const texto = await r.text();
      http.push(texto, JSON.stringify([...r.headers.entries()]));
      return { status: r.status, texto };
    };

    // 1 · fallo: AccessDenied del SDK con señuelos en el mensaje.
    c.senderError.error = Object.assign(new Error(`AccessDenied: ${TODOS}`), { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } });
    queueAnswers(c, 2);
    assert.equal((await llama({ pregunta: "escenario 1" })).status, 503);
    // 2 · fallo: el proveedor de credenciales falla con DSN/llaves en el mensaje.
    c.senderError.error = Object.assign(new Error(`Could not load credentials ${TODOS}`), { name: "CredentialsProviderError" });
    assert.equal((await llama({ pregunta: "escenario 2" })).status, 503);
    c.senderError.error = undefined;
    // 3 · fallo: la búsqueda lanza un error con señuelos.
    c.retrieval.hits = [];
    c.failSearch.on = true;
    assert.equal((await llama({ pregunta: "escenario 3", conversationId: conv })).status, 503);
    c.failSearch.on = false;
    c.retrieval.hits = [hit(1)];
    // 4 · fallo: la base rechaza la escritura con un mensaje que trae el DSN y la contraseña.
    c.failRecording.on = true;
    c.failRecording.error = Object.assign(new Error(`password authentication failed for user "admin" ${TODOS}`), { code: "28P01" });
    assert.equal((await llama({ pregunta: "escenario 4", conversationId: conv })).status, 200);
    c.failRecording.on = false;
    c.failRecording.error = undefined;
    // 5 · éxito autorizado con cabeceras con señuelos; 6 · éxito anónimo.
    queueAnswers(c, 2);
    assert.equal((await llama({ pregunta: "escenario 5", conversationId: conv })).status, 200);
    assert.equal((await llama({ pregunta: "escenario 6" })).status, 200);

    // 7 · reinicio del proceso: rechazo sin capturar y excepción fatal con señuelos en el mensaje.
    const proc = new EventEmitter();
    let fatal = 0;
    const retirar = registerProcessGuards({ onFatal: () => { fatal++; }, proc: proc as unknown as NodeJS.Process });
    proc.emit("unhandledRejection", new Error(`rechazo ${TODOS}`));
    proc.emit("uncaughtException", Object.assign(new Error(`fatal ${TODOS}`), { stack: `Error: fatal ${TODOS}\n    at x` }));
    retirar();
    assert.equal(fatal, 1);
    assert.equal(proc.listenerCount("unhandledRejection"), 0);

    // 8 · revisión de código y paquete: el repositorio, la configuración y el export del frontend no traen llaves.
    const raiz = fileURLToPath(new URL("../../..", import.meta.url));
    const escaneo = scanSecrets(raiz, ["backend/src", "backend/migrations", "backend/config", "frontend/app", "frontend/chat", "frontend/shared",
      "frontend/widget", "frontend/scripts", "frontend/public", "frontend/out", "docker-compose.yml", ".env.example",
      "backend/Dockerfile", "frontend/Dockerfile", "frontend/nginx.conf"]);
    assert.ok(escaneo.revisados > 50, `se revisaron ${escaneo.revisados} archivos`);
    assert.deepEqual(escaneo.hallazgos, [], "archivos con patrones de credenciales (solo rutas y regla)");

    // Barrido final: logs, avisos, base y HTTP.
    await new Promise(r => setTimeout(r, 300));
    assert.equal(contiene(logs.texto()), 0, "logs");
    const avisos = JSON.stringify((await operations.list("todas")).avisos);
    assert.equal(contiene(avisos), 0, "avisos del panel");
    assert.equal(contiene(JSON.stringify(await operations.status())), 0, "estado de componentes");
    const tablas = (await c.db.migrator.query("SELECT table_schema s, table_name t FROM information_schema.tables WHERE table_schema IN ('chat','admin') AND table_type='BASE TABLE'")).rows;
    for (const { s, t } of tablas) {
      const dump = JSON.stringify((await c.db.migrator.query(`SELECT row_to_json(x) j FROM ${s}.${t} x`)).rows);
      assert.equal(contiene(dump), 0, `tabla ${s}.${t}`);
    }
    assert.equal(contiene(http.join("\n")), 0, "respuestas y cabeceras HTTP (lo que ve el frontend)");
    // Hubo actividad real: los fallos produjeron eventos y avisos (no es un barrido vacío).
    assert.ok(logs.texto().length > 0);
    assert.ok((await operations.list("todas")).avisos.length > 0);
  } finally { logs.restaurar(); await c.close(); }
});
