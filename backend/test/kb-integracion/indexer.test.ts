/**
 * Indexador contra Qdrant real (T019): alias, puntos por versión, borrado y
 * cambio de alias atómico. Usa un embedder sintético: aquí se prueba la
 * mecánica de Qdrant, no la calidad semántica (eso lo cubre busqueda.test.ts).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { qdrant } from "../../src/services/qdrant.js";
import {
  asegurarColeccion, borrarPuntosElemento, borrarPuntosVersion, contarPuntos, crearColeccion,
  idPunto, indexarVersion, moverAlias, nombreColeccionNueva, uuidv5,
} from "../../src/kb/indexer.js";
import { embedderSintetico, prepararQdrantDePrueba } from "./qdrantPruebas.js";

let alias: string;
before(() => { alias = prepararQdrantDePrueba(); });
after(async () => {
  const { collections } = await qdrant().getCollections();
  for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name);
});

const elemento = {
  id: "11111111-1111-4111-8111-111111111111", codigo: "GT-P-004", nombre: "Procedimiento permisos y autorizaciones ambientales",
  tipo: "procedimiento", direccion: "gestion_ambiental", urlOrigen: "https://gmas2.envigado.gov.co/x", urlPadre: null,
  fechaActualizacion: "2022-09-12",
};
const version = (id: string, texto: string) => ({ id, contenidoMd: texto, fechaAcceso: new Date("2026-10-11T07:00:00Z") });

test("uuidv5 es determinista y con forma de UUID v5", () => {
  assert.equal(uuidv5("x"), uuidv5("x"));
  assert.match(uuidv5("x"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(idPunto("v1", 1), idPunto("v1", 2));
});

test("asegurarColeccion crea el alias una sola vez", async () => {
  const a = await asegurarColeccion(alias);
  const b = await asegurarColeccion(alias);
  assert.equal(a, b);
  assert.ok(a.startsWith(`${alias}_`));
});

test("indexar una versión escribe un punto por fragmento con el payload del contrato", async () => {
  const coleccion = await asegurarColeccion(alias);
  const largo = "Recibir solicitud del interesado. ".repeat(80);
  const n = await indexarVersion(version("22222222-2222-4222-8222-222222222222", largo), elemento,
    { coleccion, embedder: embedderSintetico });
  assert.ok(n > 1, "un texto largo da varios fragmentos");
  assert.equal(await contarPuntos(coleccion), n);
  const { points } = await qdrant().scroll(coleccion, { limit: 1, with_payload: true });
  const payload = points[0].payload as Record<string, unknown>;
  for (const campo of ["elemento_id", "version_id", "estado", "tipo", "codigo", "titulo", "url", "url_padre",
    "direccion", "fecha_actualizacion", "fecha_acceso", "fragmento", "texto"]) {
    assert.ok(campo in payload, `falta ${campo} en el payload`);
  }
  assert.equal(payload.estado, "publicado");

  await borrarPuntosVersion("22222222-2222-4222-8222-222222222222", coleccion);
  assert.equal(await contarPuntos(coleccion), 0);
});

test("borrar por elemento quita todas sus versiones", async () => {
  const coleccion = await asegurarColeccion(alias);
  await indexarVersion(version("33333333-3333-4333-8333-333333333333", "uno"), elemento, { coleccion, embedder: embedderSintetico });
  await indexarVersion(version("44444444-4444-4444-8444-444444444444", "dos"), elemento, { coleccion, embedder: embedderSintetico });
  assert.equal(await contarPuntos(coleccion, elemento.id), 2);
  await borrarPuntosElemento(elemento.id, coleccion);
  assert.equal(await contarPuntos(coleccion, elemento.id), 0);
});

test("mover el alias es atómico: siempre apunta a alguna colección", async () => {
  const anterior = await asegurarColeccion(alias);
  const nueva = `${nombreColeccionNueva(alias)}${randomBytes(2).toString("hex")}`;
  await crearColeccion(nueva);
  const previo = await moverAlias(nueva, alias);
  assert.equal(previo, anterior);
  const { aliases } = await qdrant().getAliases();
  assert.equal(aliases.find(a => a.alias_name === alias)?.collection_name, nueva);
});
