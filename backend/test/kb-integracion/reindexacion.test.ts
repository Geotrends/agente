/**
 * Reindexación completa sin interrupción (T068; RNF-C3-IV-02, SC-009):
 * el alias solo se mueve cuando la colección nueva está completa y verificada;
 * un fallo la borra y deja todo como estaba.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { contarPuntos, elementosIndexados } from "../../src/kb/indexer.js";
import { publicar, reconstruirColeccion, UMBRAL_PUBLICACION_MASIVA } from "../../src/kb/service.js";
import { aliasKb, coleccionDelAlias, qdrant } from "../../src/services/qdrant.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";
import { embedderSintetico, prepararQdrantDePrueba } from "./qdrantPruebas.js";

let base: BaseDePrueba;
let alias: string;
const EMBEDDER = embedderSintetico;

async function sembrar(cantidad: number, prefijo: string, estado: "publicado" | "pendiente"): Promise<void> {
  for (let i = 0; i < cantidad; i++) {
    const clave = `https://ambientometroenvigado.com/${prefijo}-${i}/`;
    const { rows: [el] } = await base.kb.query(
      `INSERT INTO kb.kb_elemento (clave, codigo, nombre, tipo, direccion, url_origen, estado, formato_original, procedimientos_origen, fuente)
       VALUES ($1, NULL, $2, 'pagina', 'ecosistemas', $1, $3, 'html', ARRAY['Ambientómetro'], 'ambientometro') RETURNING id`,
      [clave, `Página ${prefijo} ${i}`, estado === "publicado" ? "publicado" : "pendiente_aprobacion"]);
    const { rows: [v] } = await base.kb.query(
      `INSERT INTO kb.kb_version (elemento_id, hash_contenido, contenido_md, fecha_acceso)
       VALUES ($1, $2, $3, now()) RETURNING id`,
      [el.id, randomUUID().replace(/-/g, "").padEnd(64, "0"), `# ${prefijo} ${i}\n\nContenido de la página ${prefijo} número ${i} sobre calidad del aire y fauna.`]);
    await base.kb.query(
      estado === "publicado"
        ? "UPDATE kb.kb_elemento SET version_publicada_id = $2 WHERE id = $1"
        : "UPDATE kb.kb_elemento SET version_pendiente_id = $2 WHERE id = $1", [el.id, v.id]);
  }
}

before(async () => {
  base = await crearBaseDePrueba();
  alias = prepararQdrantDePrueba();
  await sembrar(12, "pub", "publicado");
});

after(async () => {
  await base?.borrar();
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

test("durante la reconstrucción, el chat responde siempre y con la colección completa", async () => {
  // Primera construcción: deja el alias sirviendo las 12 páginas.
  const primera = await reconstruirColeccion(base.kb, "cli:prueba", { embedder: EMBEDDER });
  assert.equal(primera.elementos, 12);
  const total = primera.puntos;
  assert.ok(total >= 12);

  const resultados: Array<{ ok: boolean; puntos: number; error?: string }> = [];
  let corriendo = true;
  const sonda = (async () => {
    while (corriendo) {
      try {
        const { count } = await qdrant().count(aliasKb(), { exact: true });
        resultados.push({ ok: true, puntos: count });
      } catch (error) {
        resultados.push({ ok: false, puntos: 0, error: String(error) });
      }
      await new Promise(r => setTimeout(r, 200));
    }
  })();
  // Embedder lento a propósito: la reconstrucción dura lo bastante para varias consultas.
  const lento = async (t: string[]) => { await new Promise(r => setTimeout(r, 120)); return EMBEDDER(t); };
  const segunda = await reconstruirColeccion(base.kb, "cli:prueba", { embedder: lento });
  corriendo = false;
  await sonda;

  assert.ok(resultados.length >= 3, `solo hubo ${resultados.length} consultas`);
  assert.deepEqual(resultados.filter(r => !r.ok), [], "ninguna consulta falló");
  assert.ok(resultados.every(r => r.puntos === total), `siempre el índice completo: ${JSON.stringify(resultados.map(r => r.puntos))}`);
  assert.equal(await coleccionDelAlias(), segunda.coleccion);
  const { collections } = await qdrant().getCollections();
  assert.ok(!collections.some(c => c.name === primera.coleccion), "la colección anterior se borró");
  const { rows: [ind] } = await base.kb.query("SELECT estado, puntos_esperados, puntos_indexados, duracion_etapas_ms FROM kb.kb_indexacion WHERE id = $1", [segunda.indexacionId]);
  assert.equal(ind.estado, "terminada");
  assert.equal(ind.puntos_esperados, ind.puntos_indexados);
  assert.deepEqual(Object.keys(ind.duracion_etapas_ms).sort(), ["conversion", "embeddings", "indexacion", "ocr"]);
});

test("un fallo a mitad borra la colección nueva, deja el alias y notifica", async () => {
  const antes = await coleccionDelAlias();
  const puntosAntes = await contarPuntos();
  process.env.NODE_ENV = "test";
  process.env.KB_FALLO_FORZADO_EN = "50%";
  try {
    await assert.rejects(reconstruirColeccion(base.kb, "cli:prueba", { embedder: EMBEDDER }), /fallo forzado/);
  } finally {
    delete process.env.KB_FALLO_FORZADO_EN;
  }
  assert.equal(await coleccionDelAlias(), antes, "el alias sigue en la colección anterior");
  assert.equal(await contarPuntos(), puntosAntes);
  const { collections } = await qdrant().getCollections();
  assert.equal(collections.filter(c => c.name.startsWith(alias)).length, 1, "la colección parcial se borró");
  const { rows: [ind] } = await base.kb.query("SELECT estado, detalle FROM kb.kb_indexacion ORDER BY iniciada_en DESC LIMIT 1");
  assert.equal(ind.estado, "fallida");
  assert.match(ind.detalle, /fallo forzado/);
  const notif = await base.kb.query("SELECT 1 FROM kb.kb_notificacion WHERE tipo = 'indexacion_fallida'");
  assert.equal(notif.rowCount, 1);
});

test("una segunda indexación mientras hay una en curso se rechaza", async () => {
  await base.kb.query("INSERT INTO kb.kb_indexacion (tipo, coleccion, estado) VALUES ('completa', 'otra', 'en_curso')");
  await assert.rejects(reconstruirColeccion(base.kb, "cli:prueba", { embedder: EMBEDDER }), /en curso/);
  await base.kb.query("DELETE FROM kb.kb_indexacion WHERE estado = 'en_curso'");
});

test("una publicación masiva reconstruye la colección y publica todo o nada", async () => {
  await sembrar(UMBRAL_PUBLICACION_MASIVA + 1, "pend", "pendiente");
  const antes = await coleccionDelAlias();
  const { publicados } = await publicar(base.kb, { todosPendientes: true }, "cli:prueba", { embedder: EMBEDDER });
  assert.equal(publicados.length, UMBRAL_PUBLICACION_MASIVA + 1);
  assert.notEqual(await coleccionDelAlias(), antes, "el alias se movió de una vez");
  const { rows: [r] } = await base.kb.query("SELECT count(*) FILTER (WHERE estado = 'publicado')::int AS pub, count(*) FILTER (WHERE version_pendiente_id IS NOT NULL)::int AS pend FROM kb.kb_elemento");
  assert.deepEqual({ ...r }, { pub: 12 + UMBRAL_PUBLICACION_MASIVA + 1, pend: 0 });
  assert.equal((await elementosIndexados()).size, 12 + UMBRAL_PUBLICACION_MASIVA + 1, "el índice sirve todo lo publicado");
});
