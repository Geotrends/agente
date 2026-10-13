/**
 * Cola de informes de corrida (T039): se procesan, se mueven a procesados/ y
 * uno inválido va a rechazados/ con notificación, sin bloquear la cola.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { procesarPendientes } from "../../src/kb/informes.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";
import { prepararQdrantDePrueba } from "./qdrantPruebas.js";

let base: BaseDePrueba;
let dir: string;
before(async () => {
  base = await crearBaseDePrueba();
  prepararQdrantDePrueba();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kb-runs-"));
});
after(async () => { await base?.borrar(); await fs.rm(dir, { recursive: true, force: true }); });

const vacio = (iniciada: string) => ({
  schema_version: 1, run_id: randomUUID(), programada: true, completa: false,
  iniciada_en: iniciada, terminada_en: iniciada, fuentes: ["ambientometro"], enlaces: [],
});

test("procesa en orden, mueve a procesados y rechaza el inválido con notificación", async () => {
  const a = vacio("2026-10-04T02:00:00-05:00");
  const b = vacio("2026-10-11T02:00:00-05:00");
  await fs.writeFile(path.join(dir, "zzz.json"), JSON.stringify(a));
  await fs.writeFile(path.join(dir, "aaa.json"), JSON.stringify(b));
  await fs.writeFile(path.join(dir, "roto.json"), "{ no es json");
  await fs.writeFile(path.join(dir, "medio.json.tmp"), JSON.stringify(vacio("2026-10-12T02:00:00-05:00")));

  const resumenes = await procesarPendientes(base.kb, dir);
  assert.deepEqual(resumenes.map(r => r.corrida), [a.run_id, b.run_id], "en orden de iniciada_en");
  assert.deepEqual((await fs.readdir(path.join(dir, "procesados"))).sort(), ["aaa.json", "zzz.json"]);
  assert.deepEqual(await fs.readdir(path.join(dir, "rechazados")), ["roto.json"]);
  assert.deepEqual((await fs.readdir(dir)).filter(n => !["procesados", "rechazados"].includes(n)), ["medio.json.tmp"],
    "el .tmp no se toca: está a medio escribir");
  const { rows } = await base.kb.query("SELECT tipo, objeto FROM kb.kb_notificacion");
  assert.deepEqual(rows, [{ tipo: "verificacion_fallida", objeto: "roto.json" }]);
  const corridas = await base.kb.query("SELECT count(*)::int AS n FROM kb.kb_corrida");
  assert.equal(corridas.rows[0].n, 2);
});
