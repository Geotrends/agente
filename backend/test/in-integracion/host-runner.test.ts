/**
 * T061 — Ejecutor de no degradación del anfitrión (RNF-C3-IN-13): 180 muestras, línea base propia
 * por destino, errores/timeouts en el denominador, caché fija y solapamiento demostrado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CACHE_HEADERS, CONDICIONES, DESTINOS, ejecutarNoDegradacion, evaluarNoDegradacion, medirDestino, resumirCelda, type DestinoSpec, type HostSample, type Condicion, type DestinoId } from "../../scripts/lib/hostRunner.js";

type Srv = { url: string; peticiones: Array<{ method: string; headers: http.IncomingHttpHeaders }>; latencia: { ms: number; fallar?: boolean; colgar?: boolean }; close: () => Promise<void> };
async function servidor(latenciaMs = 5): Promise<Srv> {
  const peticiones: Srv["peticiones"] = [];
  const latencia: Srv["latencia"] = { ms: latenciaMs };
  const s = http.createServer((req, res) => {
    peticiones.push({ method: req.method ?? "", headers: req.headers });
    if (latencia.colgar) return;
    setTimeout(() => {
      if (latencia.fallar) { res.statusCode = 500; return void res.end("error"); }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, relleno: "x".repeat(200) }));
    }, latencia.ms);
  });
  await new Promise<void>(r => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/`, peticiones, latencia, close: () => new Promise(r => { s.closeAllConnections(); s.close(() => r()); }) };
}
const spec = (id: DestinoId, url: string): DestinoSpec => ({ id, url, method: "GET", criterio: { status: [200], minBytes: 100, esquema: c => { try { return JSON.parse(c).ok === true; } catch { return false; } } } });

/** Muestras sintéticas con un p95 dado por celda (la 30.ª es la que fija el p95 nearest-rank con n=30: ceil(28,5)=29.º). */
function celda(destino: DestinoId, condicion: Condicion, ms: number, over: Partial<HostSample> = {}): HostSample[] {
  return Array.from({ length: 30 }, (_, i) => ({
    destino, condicion, indice: i, inicioMs: 1_000 + i, finMs: 1_001 + i, ms, status: 200, bytes: 300, ok: true,
    enCarga: condicion !== "sin_carga", ...over,
  }));
}
const completo = (ms: Record<string, number>, over: Partial<HostSample> = {}) =>
  DESTINOS.flatMap(d => CONDICIONES.flatMap(c => celda(d, c, ms[`${d}/${c}`] ?? 100, c !== "sin_carga" ? over : {})));

test("180 muestras = 30 × 2 destinos × 3 condiciones; mismo método y configuración de caché en cada petición", async () => {
  const a = await servidor(); const b = await servidor();
  try {
    const muestras: HostSample[] = [];
    for (const c of CONDICIONES) {
      muestras.push(...await medirDestino(spec("observatorio", a.url), c));
      muestras.push(...await medirDestino(spec("geoportal", b.url), c));
    }
    assert.equal(muestras.length, 180);
    for (const d of DESTINOS) for (const c of CONDICIONES) assert.equal(resumirCelda(muestras, d, c).n, 30);
    assert.ok(muestras.every(m => m.ok && m.status === 200));
    for (const p of [...a.peticiones, ...b.peticiones]) {
      assert.equal(p.method, "GET");
      assert.equal(p.headers["cache-control"], CACHE_HEADERS["Cache-Control"]);
      assert.equal(p.headers.pragma, CACHE_HEADERS.Pragma);
    }
    // Sin carga real ni reindexación: ninguna muestra cuenta como «en carga» y por eso la evaluación lo señala.
    const ev = evaluarNoDegradacion(muestras);
    assert.ok(ev.problemas.some(p => /solaparon/.test(p)), "sin ventana de carga no hay solapamiento demostrado");
  } finally { await a.close(); await b.close(); }
});

test("la medición solo cuenta como «en carga» lo que ocurre completo dentro de la ventana de carga", async () => {
  const a = await servidor(5);
  try {
    const ahora = Date.now();
    const dentro = await medirDestino(spec("observatorio", a.url), "oleada_25", { n: 5, ventana: () => ({ inicioMs: ahora - 1_000, finMs: ahora + 60_000 }) });
    assert.ok(dentro.every(m => m.enCarga));
    const fuera = await medirDestino(spec("observatorio", a.url), "oleada_25", { n: 5, ventana: () => ({ inicioMs: ahora - 10_000, finMs: ahora - 5_000 }) });
    assert.ok(fuera.every(m => !m.enCarga));
    const sinVentana = await medirDestino(spec("observatorio", a.url), "oleada_25", { n: 3 });
    assert.ok(sinVentana.every(m => !m.enCarga));
  } finally { await a.close(); }
});

test("errores, timeouts y cuerpos fuera del criterio quedan en el denominador y rompen el criterio", async () => {
  const a = await servidor(5);
  try {
    a.latencia.fallar = true;
    const e500 = await medirDestino(spec("observatorio", a.url), "sin_carga", { n: 4 });
    assert.ok(e500.every(m => !m.ok && m.motivo === "estado_500"));
    a.latencia.fallar = false; a.latencia.colgar = true;
    const t0 = Date.now();
    const tout = await medirDestino(spec("observatorio", a.url), "sin_carga", { n: 2, timeoutMs: 200 });
    assert.ok(Date.now() - t0 < 2_000);
    assert.ok(tout.every(m => m.motivo === "timeout" && m.ms >= 190), "el timeout cuenta como error y como duración");
    a.latencia.colgar = false;
    // Esquema inválido: 200 con cuerpo que no cumple.
    const malo = await medirDestino({ ...spec("observatorio", a.url), criterio: { status: [200], esquema: () => false } }, "sin_carga", { n: 2 });
    assert.ok(malo.every(m => m.motivo === "esquema_invalido"));
    const mezcla = completo({}).map((m, i) => (i === 0 ? { ...m, ok: false, motivo: "timeout", ms: 120_000 } : m));
    const ev = evaluarNoDegradacion(mezcla);
    assert.ok(ev.problemas.some(p => /error, timeout/.test(p)));
  } finally { await a.close(); }
});

test("criterio: p95 de carga ≤ 120 % de la línea base PROPIA de cada destino; 0 errores", () => {
  const bien = evaluarNoDegradacion(completo({ "observatorio/sin_carga": 100, "observatorio/reindexacion": 115, "observatorio/oleada_25": 119, "geoportal/sin_carga": 500, "geoportal/reindexacion": 590, "geoportal/oleada_25": 600 }));
  assert.deepEqual(bien.problemas, []);
  assert.equal(bien.total, 180);
  assert.ok(bien.aprobado);
  // Un destino degradado no se compensa con el otro: cada uno contra su línea base.
  const mal = evaluarNoDegradacion(completo({ "observatorio/sin_carga": 100, "observatorio/reindexacion": 150, "observatorio/oleada_25": 100, "geoportal/sin_carga": 500, "geoportal/reindexacion": 500, "geoportal/oleada_25": 500 }));
  assert.ok(mal.problemas.some(p => /observatorio\/reindexacion.*1\.50/.test(p)), mal.problemas.join(" | "));
  assert.equal(mal.aprobado, false);
  assert.ok(Object.keys(mal).every(k => !/cpu|memoria|health/i.test(k)), "no hay sustitutos por CPU o salud");
});

test("línea base inválida (0 ms o sin muestras) y ausencia de solapamiento impiden aceptar", () => {
  const baseCero = evaluarNoDegradacion(completo({ "observatorio/sin_carga": 0 }));
  assert.ok(baseCero.problemas.some(p => /línea base inválida/.test(p)));
  const sinSolape = evaluarNoDegradacion(completo({}, { enCarga: false }));
  assert.ok(sinSolape.problemas.some(p => /solaparon/.test(p)));
  const incompleta = evaluarNoDegradacion(completo({}).slice(0, 150));
  assert.ok(incompleta.problemas.some(p => /150 muestras en lugar de 180/.test(p)));
});

test("orquestación: sin carga, reindexación y oleada real; las 180 muestras se solapan con su ventana y el criterio se evalúa", async () => {
  const obs = await servidor(10); const geo = await servidor(10);
  try {
    // La «reindexación» y la «oleada» son cargas que duran lo suficiente para contener las 30 muestras de cada destino.
    const carga = (etiqueta: string, ms: number) => () => ({ etiqueta, terminada: new Promise<void>(r => setTimeout(r, ms)) });
    const r = await ejecutarNoDegradacion({
      destinos: [spec("observatorio", obs.url), spec("geoportal", geo.url)],
      iniciarReindexacion: carga("reindexacion-simulada", 2_500), iniciarOleada: carga("oleada-simulada", 2_500),
      n: 30, pausaMs: 5,
    });
    assert.equal(r.muestras.length, 180);
    assert.deepEqual(r.evaluacion.problemas, [], r.evaluacion.problemas.join(" | "));
    assert.ok(r.evaluacion.aprobado);
    assert.equal(r.ventanas.length, 2, "una ventana por condición, sin ventanas extra");
    assert.ok(r.ventanas.every(v => !v.extra && Number.isFinite(v.finMs)));
    const bajoCarga = r.muestras.filter(m => m.condicion !== "sin_carga");
    assert.equal(bajoCarga.length, 120);
    assert.ok(bajoCarga.every(m => m.enCarga), "todas las muestras de carga ocurrieron dentro de la ventana");
  } finally { await obs.close(); await geo.close(); }
});

test("si la carga termina antes de reunir las 30 muestras se abren ventanas equivalentes identificadas como extra", async () => {
  const obs = await servidor(40); const geo = await servidor(40);
  try {
    // Ventanas de ~500 ms con 40 ms por muestra: caben unas 10 muestras por ventana → se necesitan ventanas extra.
    const carga = (etiqueta: string) => () => ({ etiqueta, terminada: new Promise<void>(r => setTimeout(r, 500)) });
    const r = await ejecutarNoDegradacion({
      destinos: [spec("observatorio", obs.url), spec("geoportal", geo.url)],
      iniciarReindexacion: carga("reindexacion-corta"), iniciarOleada: carga("oleada-corta"), n: 30, maxVentanasExtra: 6,
    });
    assert.ok(r.ventanas.some(v => v.extra), "hubo ventanas adicionales documentadas");
    assert.equal(r.muestras.length, 180);
    assert.deepEqual(r.evaluacion.problemas, []);
  } finally { await obs.close(); await geo.close(); }
});
