/**
 * Retención de registros (T073; RNF-C3-IV-03, SC-012): 11 meses siguen, 14 se
 * purgan, y una notificación sin revisar no se borra nunca.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { purgarRetencion } from "../../src/kb/retention.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";

let base: BaseDePrueba;
let runs: string;
let corrida: string;

const meses = (n: number) => `now() - interval '${n} months'`;

before(async () => {
  base = await crearBaseDePrueba();
  runs = await fs.mkdtemp(path.join(os.tmpdir(), "kb-ret-"));
  process.env.KB_RUNS_DIR = runs;
  corrida = randomUUID();
  await base.kb.query(
    "INSERT INTO kb.kb_corrida (id, iniciada_en, terminada_en, programada, completa, informe) VALUES ($1, now(), now(), true, true, 'x.json')", [corrida]);
});

after(async () => {
  delete process.env.KB_RUNS_DIR;
  delete process.env.KB_RETENCION_MESES;
  await base?.borrar();
  await fs.rm(runs, { recursive: true, force: true });
});

async function sembrar(antiguedad: number, marca: string): Promise<void> {
  await base.kb.query(
    `INSERT INTO kb.kb_verificacion (corrida_id, url, fecha_hora, estado_detectado, resultado)
     VALUES ($1, $2, ${meses(antiguedad)}, 'vigente', 'sin_cambios')`, [corrida, `https://x/${marca}`]);
  await base.kb.query(
    `INSERT INTO kb.kb_procesamiento (clave_elemento, formato_original, caracteres_nativos, ocr_aplicado, decision, fecha)
     VALUES ($1, 'pdf', 100, false, 'cargado', ${meses(antiguedad)})`, [marca]);
  await base.kb.query(
    `INSERT INTO kb.kb_notificacion (tipo, objeto, descripcion, estado, revisada_en, revisada_por, primera_en, ultima_en)
     VALUES ('verificacion_fallida', $1, 'x', 'revisada', ${meses(antiguedad)}, 'cli:prueba', ${meses(antiguedad)}, ${meses(antiguedad)})`, [`revisada-${marca}`]);
  await base.kb.query(
    `INSERT INTO kb.kb_notificacion (tipo, objeto, descripcion, estado, primera_en, ultima_en)
     VALUES ('verificacion_fallida', $1, 'x', 'no_revisada', ${meses(antiguedad)}, ${meses(antiguedad)})`, [`sinrevisar-${marca}`]);
}

const contar = async (tabla: string) => (await base.kb.query(`SELECT count(*)::int AS n FROM kb.${tabla}`)).rows[0].n as number;

test("conserva 11 meses, borra 14 revisados y nunca una notificación sin revisar", async () => {
  await sembrar(11, "once");
  await sembrar(14, "catorce");
  for (const sub of ["procesados", "rechazados"]) await fs.mkdir(path.join(runs, sub), { recursive: true });
  const viejo = path.join(runs, "procesados", "viejo.json");
  const reciente = path.join(runs, "procesados", "reciente.json");
  await fs.writeFile(viejo, "{}");
  await fs.writeFile(reciente, "{}");
  const hace14 = new Date(Date.now() - 14 * 31 * 86_400_000);
  await fs.utimes(viejo, hace14, hace14);

  const r = await purgarRetencion(base.kb, { actor: "cli:prueba" });
  assert.deepEqual(r.filasPorTabla, { kb_verificacion: 1, kb_procesamiento: 1, kb_notificacion: 1, informes: 1 });
  assert.equal(await contar("kb_verificacion"), 1);
  assert.equal(await contar("kb_procesamiento"), 1);
  const objetos = (await base.kb.query("SELECT objeto FROM kb.kb_notificacion ORDER BY objeto")).rows.map(x => x.objeto);
  assert.deepEqual(objetos, ["revisada-once", "sinrevisar-catorce", "sinrevisar-once"]);
  await assert.rejects(fs.access(viejo));
  await fs.access(reciente);

  const purgas = await base.kb.query("SELECT filas_por_tabla FROM kb.kb_purga");
  assert.equal(purgas.rowCount, 1);
  assert.equal(purgas.rows[0].filas_por_tabla.kb_verificacion, 1);
});

test("KB_RETENCION_MESES=11 se recorta a 12: lo de 11 meses y medio sigue", async () => {
  process.env.KB_RETENCION_MESES = "11";
  await base.kb.query(
    `INSERT INTO kb.kb_procesamiento (clave_elemento, formato_original, caracteres_nativos, ocr_aplicado, decision, fecha)
     VALUES ('once-y-medio', 'pdf', 100, false, 'cargado', now() - interval '11 months 15 days')`);
  const r = await purgarRetencion(base.kb, { actor: "cli:prueba" });
  assert.equal(r.meses, 12);
  assert.equal((await base.kb.query("SELECT 1 FROM kb.kb_procesamiento WHERE clave_elemento = 'once-y-medio'")).rowCount, 1);
});
