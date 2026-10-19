/**
 * Recuperación y publicación con Qdrant real y los modelos locales reales (embeddings y reranker):
 * trazas híbridas, caída del reranker, calibración de la candidata antes de mover el alias y
 * publicación inválida que conserva el alias anterior (RF-C3-DI-05/06/12/13/14, RNF-C3-IV-02).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { reconstruirColeccion } from "../../src/kb/service.js";
import { calibrateCollection } from "../../src/kb/calibrateCollection.js";
import { CalibrationError } from "../../src/kb/calibration.js";
import { embed } from "../../src/services/embeddings.js";
import { hybridSearch, prepareIndex, retrievalStatus, retrieveCandidates, setRerankerForTests } from "../../src/services/search.js";
import { resetCalibrationCache } from "../../src/services/calibration.js";
import { aliasKb, coleccionDelAlias, qdrant } from "../../src/services/qdrant.js";
import { crearBaseDePrueba, type BaseDePrueba } from "../kb-integracion/helpers.js";
import { DOCS, ORO, sembrar } from "./kbCorpus.js";
import { prepararQdrantDePrueba } from "../kb-integracion/qdrantPruebas.js";

let base: BaseDePrueba;
let alias: string;

before(async () => {
  base = await crearBaseDePrueba();
  alias = prepararQdrantDePrueba();
  process.env.APP_DATABASE_URL = base.appUrl;
  process.env.RETRIEVAL_WORKER = "false";
  await sembrar(base.kb);
});

after(async () => {
  setRerankerForTests(undefined);
  await base?.borrar();
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

test("candidatas calibradas antes de mover el alias; el umbral viaja con la colección", async () => {
  const calibrar = (coleccion: string, info: { corpusHash: string }) => calibrateCollection(coleccion, ORO, "oro-hash", info);
  const r = await reconstruirColeccion(base.kb, "cli:prueba", { embedder: embed, calibrar });
  assert.equal(await coleccionDelAlias(), r.coleccion);
  const { rows } = await base.kb.query("SELECT umbral, embedding_version, reranker_version, politica_version, reporte FROM kb.kb_calibracion WHERE coleccion = $1", [r.coleccion]);
  assert.equal(rows.length, 1, "calibración guardada junto a la colección");
  assert.ok(Number.isFinite(rows[0].umbral));
  assert.equal(rows[0].reporte.selectedThreshold, rows[0].umbral);
  assert.equal(rows[0].reporte.respondibles.length, 3);
  assert.equal(rows[0].reporte.ausentes.length, 2);
  assert.ok(rows[0].reporte.barrido.length === rows[0].reporte.valores.length && rows[0].reporte.valores.length > 3, "se guarda todo el barrido");
  // Cero falsas abstenciones con el umbral elegido, comprobado contra el recuperador real.
  resetCalibrationCache();
  await prepareIndex();
  assert.equal(retrievalStatus.calibracion, "vigente");
  for (const c of ORO.cases.filter(k => k.kind === "factual")) {
    assert.ok((await hybridSearch(c.query)).hits.length > 0, `falsa abstención en ${c.id}`);
  }
});

test("5 trazas híbridas: ambos motores aportan, ≤16 candidatos, ≤8 fragmentos de mayor a menor relevancia", async () => {
  for (const c of ORO.cases.slice(0, 5)) {
    const set = await retrieveCandidates(c.query);
    assert.ok(set.candidates.length <= 16);
    assert.ok(set.bm25ById.size > 0 || set.semanticById.size > 0);
    assert.ok(set.semanticById.size > 0, "aporta el denso");
    assert.ok(set.reranked !== null);
    const r = await hybridSearch(c.query);
    assert.ok(r.hits.length <= 8);
    const scores = r.hits.map(h => h.rerank!);
    for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] >= scores[i]);
  }
  const ambos = await retrieveCandidates("registrar mascota RUM carnet de vacunación");
  assert.ok(ambos.bm25ById.size > 0 && ambos.semanticById.size > 0, "BM25 y denso aportan resultados");
});

test("3 caídas del reranker: los 8 mejores de RRF, sin umbral, degradado; el siguiente éxito vuelve a normal", async () => {
  for (const c of ORO.cases.slice(0, 3)) {
    setRerankerForTests(async () => { throw new Error("reranker apagado"); });
    const caido = await hybridSearch(c.query);
    assert.equal(caido.degraded, true);
    assert.equal(caido.thresholdApplied, false);
    const set = await retrieveCandidates(c.query);
    assert.deepEqual(caido.hits.map(h => h.chunk), set.candidates.slice(0, 8).map(k => set.payloads[k.id].fragmento), "mismo orden de la fusión");
    setRerankerForTests(undefined);
    const normal = await hybridSearch(c.query);
    assert.equal(normal.degraded, false);
    assert.equal(normal.thresholdApplied, true);
  }
});

test("una búsqueda fallida (colección inexistente) lanza error: nunca se confunde con abstención", async () => {
  await assert.rejects(hybridSearch("¿qué requisitos hay?", undefined, "coleccion_que_no_existe"), /no está disponible/i);
  await assert.rejects(retrieveCandidates("x", undefined, "coleccion_que_no_existe"));
});

test("publicación inválida (palabra >1000 caracteres) o calibración imposible: el alias anterior se conserva", async () => {
  const antes = await coleccionDelAlias();
  const { rows } = await base.kb.query("SELECT id FROM kb.kb_elemento ORDER BY clave LIMIT 1");
  const { rows: [v] } = await base.kb.query("SELECT version_publicada_id AS id FROM kb.kb_elemento WHERE id = $1", [rows[0].id]);
  // Una tabla se divide por filas y una fila que no cabe pasa a prosa; lo no publicable es una palabra >1000.
  const tablaGrande = ["| A | B |", "| --- | --- |", `| fila única | ${"x".repeat(1100)} |`].join("\n");
  await base.kb.query("UPDATE kb.kb_version SET contenido_md = $2 WHERE id = $1", [v.id, `# Con tabla\n\n${tablaGrande}`]);
  await assert.rejects(reconstruirColeccion(base.kb, "cli:prueba", { embedder: embed }), /palabra_excede/);
  assert.equal(await coleccionDelAlias(), antes, "el alias sigue en la colección validada");
  const { rows: notif } = await base.kb.query("SELECT tipo, descripcion FROM kb.kb_notificacion WHERE tipo = 'indexacion_fallida'");
  assert.ok(notif.length >= 1, "se notificó sin revelar contenido");
  const { collections } = await qdrant().getCollections();
  assert.equal(collections.filter(c => c.name.startsWith(alias) && c.name !== antes).length, 0, "la candidata se descartó");

  // Restaura y prueba una calibración imposible: un respondible sin ningún candidato válido.
  await base.kb.query("UPDATE kb.kb_version SET contenido_md = $2 WHERE id = $1", [v.id, DOCS[0].texto]);
  const imposible = { cases: [...ORO.cases, { id: "x", kind: "factual" as const, query: "   " }] };
  await assert.rejects(
    reconstruirColeccion(base.kb, "cli:prueba", { embedder: embed, calibrar: (c, i) => calibrateCollection(c, imposible, "h", i, async () => ({
      collection: c, payloads: [], candidates: [], reranked: new Map(), bm25ById: new Map(), semanticById: new Map(), method: "x" })) }),
    (e: unknown) => e instanceof CalibrationError);
  assert.equal(await coleccionDelAlias(), antes, "calibración imposible: no se publica");
  assert.equal(aliasKb(), alias);
});
