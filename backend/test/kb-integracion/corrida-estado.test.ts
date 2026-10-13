/**
 * Estado de procesamiento de la corrida (bug corrida-en-curso-sin-estado):
 * una corrida que otro proceso está procesando no se confunde con una terminada,
 * no se procesa dos veces, bloquea `publicar` y, abandonada, se retoma sin duplicar.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { procesarPendientes } from "../../src/kb/informes.js";
import { corridasEnProceso, publicar } from "../../src/kb/service.js";
import { procesarInforme } from "../../src/kb/sync.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";
import { prepararQdrantDePrueba } from "./qdrantPruebas.js";

let base: BaseDePrueba;
let dir: string;
before(async () => {
  base = await crearBaseDePrueba();
  prepararQdrantDePrueba();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kb-corrida-"));
});
after(async () => { await base?.borrar(); await fs.rm(dir, { recursive: true, force: true }); });

const enlaceError = (n: number) => ({
  url: `https://ambientometroenvigado.com/caida-${n}/`, fuente: "ambientometro", fecha_hora: new Date().toISOString(),
  rol: "pagina", padre: null, titulo: null, estado_detectado: "no_aplica", resultado: "error",
  error: { tipo: "http", codigo_http: 500, detalle: "caído" }, hash_contenido: null,
  archivo: null, archivo_original: null, hash_original: null, gmas: null,
});

async function informeConEnlaces(n: number): Promise<{ id: string; ruta: string }> {
  const id = randomUUID();
  const ruta = path.join(dir, `${id}.json`);
  const ahora = new Date().toISOString();
  await fs.writeFile(ruta, JSON.stringify({
    schema_version: 1, run_id: id, programada: false, completa: false, iniciada_en: ahora, terminada_en: ahora,
    fuentes: ["ambientometro"], enlaces: Array.from({ length: n }, (_, i) => enlaceError(i)),
  }));
  return { id, ruta };
}

const sembrarCorrida = (id: string, latido: string) => base.kb.query(
  `INSERT INTO kb.kb_corrida (id, iniciada_en, terminada_en, programada, completa, informe, estado, latido_en)
   VALUES ($1, now(), now(), false, false, $2, 'en_proceso', ${latido})`, [id, `${id}.json`]);

test("una corrida procesada termina en estado 'procesada'", async () => {
  const { id, ruta } = await informeConEnlaces(3);
  const r = await procesarInforme(base.kb, ruta);
  assert.equal(r.verificaciones, 3);
  const { rows } = await base.kb.query("SELECT estado FROM kb.kb_corrida WHERE id = $1", [id]);
  assert.equal(rows[0].estado, "procesada");
  assert.equal((await procesarInforme(base.kb, ruta)).yaProcesada, true);
});

test("una corrida con latido reciente no se reprocesa, se reporta en proceso y el informe no se mueve", async () => {
  const { id, ruta } = await informeConEnlaces(3);
  await sembrarCorrida(id, "now()");
  const r = await procesarInforme(base.kb, ruta);
  assert.equal(r.enProceso, true);
  assert.equal(r.yaProcesada, false);
  assert.equal(r.verificaciones, 0);

  const resumenes = await procesarPendientes(base.kb, dir);
  assert.ok(resumenes.some(x => x.corrida === id && x.enProceso));
  await fs.access(ruta);   // sigue en su sitio, sin ENOENT ni movimiento
  assert.ok((await corridasEnProceso(base.kb)).some(c => c.id === id));
});

test("publicar se niega mientras una corrida se está procesando", async () => {
  await assert.rejects(publicar(base.kb, { todosPendientes: true }, "cli:prueba"), /se está procesando/);
});

test("una corrida abandonada se retoma sin repetir lo ya verificado", async () => {
  const { id, ruta } = await informeConEnlaces(4);
  await sembrarCorrida(id, "now() - interval '1 hour'");
  // Un intento anterior alcanzó a registrar las dos primeras verificaciones.
  for (const n of [0, 1]) {
    await base.kb.query(
      `INSERT INTO kb.kb_verificacion (corrida_id, url, fecha_hora, estado_detectado, resultado, tipo_error, codigo_http)
       VALUES ($1, $2, now(), 'no_aplica', 'error', 'http', 500)`, [id, `https://ambientometroenvigado.com/caida-${n}/`]);
  }
  assert.ok(!(await corridasEnProceso(base.kb)).some(c => c.id === id), "abandonada: ya no cuenta como en proceso");

  const r = await procesarInforme(base.kb, ruta);
  assert.equal(r.enProceso, undefined);
  assert.equal(r.verificaciones, 2, "solo las dos que faltaban");
  const { rows } = await base.kb.query(
    "SELECT count(*)::int AS n, count(DISTINCT url)::int AS distintas FROM kb.kb_verificacion WHERE corrida_id = $1", [id]);
  assert.deepEqual(rows[0], { n: 4, distintas: 4 });
  const estado = await base.kb.query("SELECT estado FROM kb.kb_corrida WHERE id = $1", [id]);
  assert.equal(estado.rows[0].estado, "procesada");
});
