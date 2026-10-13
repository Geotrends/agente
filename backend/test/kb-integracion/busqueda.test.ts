/**
 * Búsqueda híbrida del chat sobre Qdrant real (T025): ambos motores aportan,
 * nada no publicado se devuelve, los hits conservan los campos de cita que
 * consume answerQuestion, y sin alias el chat no está disponible.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { qdrant } from "../../src/services/qdrant.js";
import { asegurarColeccion, indexarVersion } from "../../src/kb/indexer.js";
import { hybridSearch, prepareIndex, retrievalStatus } from "../../src/services/search.js";
import { prepararQdrantDePrueba } from "./qdrantPruebas.js";

let alias: string;
let coleccion: string;

const elemento = (n: number, nombre: string, url: string, urlPadre: string | null = null) => ({
  id: `cccccccc-0000-4000-8000-00000000000${n}`, codigo: null, nombre, tipo: urlPadre ? "documento" : "pagina",
  direccion: "bienestar_animal", urlOrigen: url, urlPadre, fechaActualizacion: null,
});
const version = (n: number, texto: string) => ({ id: `dddddddd-0000-4000-8000-00000000000${n}`, contenidoMd: texto, fechaAcceso: new Date("2026-10-01T00:00:00Z") });

before(async () => {
  alias = prepararQdrantDePrueba();
  coleccion = await asegurarColeccion(alias);
  await indexarVersion(version(1, "La identificación de mascotas con microchip se hace los miércoles de 5:00 PM a 6:00 PM. Código del trámite ZX-7781."),
    elemento(1, "Identificación con microchip", "https://ambientometroenvigado.com/microchip/"), { coleccion });
  await indexarVersion(version(2, "Las jornadas de esterilización de perros y gatos son gratuitas para animales de compañía."),
    elemento(2, "Boletín de esterilización", "https://ambientometroenvigado.com/wp-content/esterilizacion.pdf", "https://ambientometroenvigado.com/campana-de-esterilizacion/"), { coleccion });
  await indexarVersion(version(3, "La calidad del aire se mide con sensores de material particulado PM2.5."),
    elemento(3, "Calidad del aire", "https://ambientometroenvigado.com/calidad-del-aire/"), { coleccion });
  // Un punto que NO debería existir en la colección servida: estado pendiente.
  // La búsqueda debe ignorarlo aunque esté (defensa en profundidad).
  const { points } = await qdrant().scroll(coleccion, { limit: 1, with_vector: true, with_payload: true,
    filter: { must: [{ key: "elemento_id", match: { value: "cccccccc-0000-4000-8000-000000000003" } }] } });
  await qdrant().upsert(coleccion, { wait: true, points: [{
    id: "eeeeeeee-0000-4000-8000-000000000001",
    vector: points[0].vector as Record<string, number[]>,
    payload: { ...(points[0].payload as Record<string, unknown>), estado: "pendiente_aprobacion", elemento_id: "pendiente", texto: "PENDIENTE calidad del aire PM2.5" },
  }] });
  await prepareIndex();
});

after(async () => {
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

test("el estado queda listo con el alias publicado", () => {
  assert.equal(retrievalStatus.state, "ready");
  assert.equal(retrievalStatus.coleccion, coleccion);
});

test("BM25 recupera por término exacto y el denso por significado", async () => {
  const exacto = await hybridSearch("ZX-7781");
  assert.equal(exacto.hits[0].sourceUrl, "https://ambientometroenvigado.com/microchip/");
  assert.ok((exacto.hits[0].bm25 ?? 0) > 0, "el término exacto lo aporta BM25");
  const semantico = await hybridSearch("¿cuándo le ponen el chip de identificación a mi perro?");
  assert.equal(semantico.hits[0].sourceUrl, "https://ambientometroenvigado.com/microchip/");
  assert.ok((semantico.hits[0].semantic ?? 0) > 0, "y el denso aporta por significado");
});

test("nunca devuelve puntos que no estén publicados", async () => {
  const r = await hybridSearch("calidad del aire PM2.5");
  assert.ok(r.hits.length > 0);
  assert.ok(r.hits.every(h => !h.snippet.startsWith("PENDIENTE")));
});

test("los hits conservan los campos de cita del contrato", async () => {
  const r = await hybridSearch("esterilización gratuita de gatos");
  const hit = r.hits.find(h => h.sourceUrl?.endsWith("esterilizacion.pdf"));
  assert.ok(hit, "el documento de esterilización aparece");
  assert.equal(hit.path, hit.sourceUrl);
  assert.equal(hit.sourcePageUrl, "https://ambientometroenvigado.com/campana-de-esterilizacion/");
  assert.equal(hit.title, "Boletín de esterilización");
  assert.equal(hit.category, "bienestar_animal");
  assert.match(r.method, /^qdrant:bm25\+dense\+rrf/);
});

test("sin alias, el chat queda no disponible (nunca 'sin información')", async () => {
  const anterior = process.env.KB_QDRANT_ALIAS;
  process.env.KB_QDRANT_ALIAS = `${alias}_inexistente`;
  try {
    await prepareIndex();
    assert.equal(retrievalStatus.state, "error");
    await assert.rejects(hybridSearch("microchip"), /no está disponible/);
  } finally {
    process.env.KB_QDRANT_ALIAS = anterior;
    await prepareIndex();
  }
});
