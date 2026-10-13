/**
 * Nombres descriptivos contra PostgreSQL y Qdrant reales (bug nombres-pagina-duplicados;
 * RF-C3-IV-11, RF-C3-IV-12): páginas con el mismo título "Abril" quedan con nombres
 * distintos y `recalcular-nombres` corrige las ya cargadas, en la matriz y en el índice.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { qdrant } from "../../src/services/qdrant.js";
import { publicar, recalcularNombres } from "../../src/kb/service.js";
import { procesarInforme } from "../../src/kb/sync.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";
import { embedderSintetico, prepararQdrantDePrueba } from "./qdrantPruebas.js";

const A = "https://ambientometroenvigado.com";
const URLS = [
  `${A}/docs/boletines-2025/meteorologia/abril/`,
  `${A}/docs/boletines-2025/ruido/abril/`,
  `${A}/docs/2022-2/ruido/abril/`,
];

let base: BaseDePrueba;
let alias: string;
let datos: string;

const pagina = (url: string, i: number) => ({
  fuente: "ambientometro", fecha_hora: new Date().toISOString(), rol: "pagina", padre: null, titulo: "Abril",
  estado_detectado: "no_aplica", resultado: "nuevo", error: null, hash_contenido: String(i + 1).repeat(64),
  archivo: `ambientometro/paginas_md/abril-${i}.md`, archivo_original: null, hash_original: null, gmas: null, url,
});

before(async () => {
  base = await crearBaseDePrueba();
  alias = prepararQdrantDePrueba();
  datos = await fs.mkdtemp(path.join(os.tmpdir(), "kb-nombres-"));
  process.env.GEOTRENDS_DOCUMENTS_ROOT = datos;
  await fs.mkdir(path.join(datos, "ambientometro", "paginas_md"), { recursive: true });
  for (const [i, url] of URLS.entries()) {
    await fs.writeFile(path.join(datos, `ambientometro/paginas_md/abril-${i}.md`),
      `---\ntitle: "Abril"\nsource_url: "${url}"\n---\n\n# Abril\n\nBoletín ${i}: datos del mes con contenido suficiente para indexar.\n`);
  }
  const run = {
    schema_version: 1, run_id: randomUUID(), programada: true, completa: false,
    iniciada_en: new Date().toISOString(), terminada_en: new Date().toISOString(),
    fuentes: ["ambientometro"], enlaces: URLS.map(pagina),
  };
  const ruta = path.join(datos, "runs", `${run.run_id}.json`);
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  await fs.writeFile(ruta, JSON.stringify(run));
  await procesarInforme(base.kb, ruta);
});

after(async () => {
  await base?.borrar();
  await fs.rm(datos, { recursive: true, force: true });
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

test("tres páginas tituladas «Abril» se cargan con nombres distintos y descriptivos", async () => {
  const { rows } = await base.kb.query("SELECT nombre FROM kb.kb_elemento ORDER BY url_origen");
  assert.deepEqual(rows.map(r => r.nombre).sort(), [
    "Meteorología – Abril 2025", "Ruido – Abril 2022", "Ruido – Abril 2025",
  ]);
});

test("recalcular-nombres corrige nombres antiguos en la matriz y en el índice, y es idempotente", async () => {
  await publicar(base.kb, { todosPendientes: true }, "cli:prueba", { embedder: embedderSintetico });
  await base.kb.query("UPDATE kb.kb_elemento SET nombre = 'Abril'");
  const cambios = await recalcularNombres(base.kb, "cli:prueba");
  assert.equal(cambios.length, 3);
  const { rows } = await base.kb.query("SELECT nombre FROM kb.kb_elemento");
  assert.equal(new Set(rows.map(r => r.nombre)).size, 3);

  const { collections } = await qdrant().getCollections();
  const coleccion = collections.find(c => c.name.startsWith(alias))!.name;
  const { points } = await qdrant().scroll(coleccion, { limit: 50, with_payload: true });
  const titulos = new Set(points.map(p => (p.payload as { titulo: string }).titulo));
  assert.ok(![...titulos].includes("Abril"), "el índice ya no usa el título genérico");

  assert.equal((await recalcularNombres(base.kb, "cli:prueba")).length, 0);
  const acciones = await base.kb.query("SELECT 1 FROM kb.kb_auditoria WHERE accion = 'recalcular_nombre'");
  assert.equal(acciones.rowCount, 3);
});
