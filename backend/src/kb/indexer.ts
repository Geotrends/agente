/**
 * Indexación en Qdrant (research R3/R4, contracts/qdrant-coleccion.md).
 *
 * Una colección física por construcción, `<alias>_<marca>`, servida a través
 * del alias. Cada punto es un fragmento de la versión PUBLICADA de un elemento
 * publicado, con su vector denso (e5-small, local) y su vector BM25 disperso.
 * Nada pendiente ni derogado tiene puntos aquí: esa es la garantía de que el
 * chat solo responde con contenido validado (principio III), y la búsqueda la
 * refuerza filtrando además por `estado = publicado`.
 *
 * Escritor único: el kb-worker. El backend del chat solo consulta el alias.
 */
import { createHash } from "node:crypto";
import { chunkDocument } from "../services/chunking.js";
import { embed } from "../services/embeddings.js";
import { aliasKb, coleccionDelAlias, DIMENSIONES_DENSO, qdrant } from "../services/qdrant.js";
import { longitudBm25, textoLexico, vectorBm25 } from "./sparse.js";

/** Longitud media por defecto (en términos) antes de la primera construcción completa. */
export const AVGDL_POR_DEFECTO = 140;
const LOTE_EMBEDDINGS = 8;
const LOTE_UPSERT = 64;

/** Cliente con margen para escrituras con `wait: true`. */
const cliente = () => qdrant(120_000);

export type Embedder = (textos: string[], tipo: "query" | "passage") => Promise<number[][]>;

export type ElementoIndexable = {
  id: string;
  codigo: string | null;
  nombre: string;
  tipo: string;
  direccion: string;
  urlOrigen: string;
  urlPadre: string | null;
  fechaActualizacion: string | null;   // yyyy-mm-dd
};

export type VersionIndexable = { id: string; contenidoMd: string; fechaAcceso: Date };

export type Fragmento = { texto: string; pagina?: number; numero: number };

// ── Identidad de puntos ─────────────────────────────────────────────────────

/** Espacio de nombres fijo para los UUID v5 de los puntos (generado una vez). */
const NAMESPACE = "6f1c4a2e-9b3d-4e57-8a21-3c5d7e9f0b14";

/** UUID v5 (RFC 4122, SHA-1): el mismo fragmento de la misma versión siempre tiene el mismo id. */
export function uuidv5(nombre: string, namespace = NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(nombre, "utf8").digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function idPunto(versionId: string, numeroFragmento: number): string {
  return uuidv5(`${versionId}:${numeroFragmento}`);
}

// ── Colecciones y alias ─────────────────────────────────────────────────────

/** `<alias>_yyyymmddHHMMssSSS`: ordenable y único aunque se creen dos en el mismo segundo. */
export function nombreColeccionNueva(alias = aliasKb(), ahora = new Date()): string {
  const marca = ahora.toISOString().replace(/[-:TZ.]/g, "");
  return `${alias}_${marca}`;
}

export async function crearColeccion(nombre: string): Promise<void> {
  const client = cliente();
  await client.createCollection(nombre, {
    vectors: { dense: { size: DIMENSIONES_DENSO, distance: "Cosine" } },
    sparse_vectors: { bm25: { modifier: "idf" } },
  });
  for (const campo of ["elemento_id", "estado", "direccion"]) {
    await client.createPayloadIndex(nombre, { field_name: campo, field_schema: "keyword", wait: true });
  }
}

/**
 * Garantiza que el alias exista. Si no, crea la primera colección vacía y lo
 * apunta a ella. Devuelve la colección física servida.
 */
export async function asegurarColeccion(alias = aliasKb()): Promise<string> {
  const actual = await coleccionDelAlias(cliente(), alias);
  if (actual) return actual;
  const nombre = nombreColeccionNueva(alias);
  await crearColeccion(nombre);
  await cliente().updateCollectionAliases({
    actions: [{ create_alias: { collection_name: nombre, alias_name: alias } }],
  });
  return nombre;
}

/** Mueve el alias a otra colección en UNA operación atómica (R4). */
export async function moverAlias(destino: string, alias = aliasKb()): Promise<string | undefined> {
  const anterior = await coleccionDelAlias(cliente(), alias);
  const actions: Array<Record<string, unknown>> = [];
  if (anterior) actions.push({ delete_alias: { alias_name: alias } });
  actions.push({ create_alias: { collection_name: destino, alias_name: alias } });
  // delete + create en la misma llamada: Qdrant las aplica juntas, sin un
  // instante en que el alias no exista.
  await cliente().updateCollectionAliases({ actions: actions as never });
  return anterior;
}

// ── Fragmentos y puntos ─────────────────────────────────────────────────────

export function fragmentar(version: VersionIndexable): Fragmento[] {
  return chunkDocument(version.contenidoMd).map((c, i) => ({
    texto: c.text, numero: i + 1, ...(c.page === undefined ? {} : { pagina: c.page }),
  }));
}

export function tituloDe(elemento: ElementoIndexable): string {
  return elemento.codigo && !elemento.nombre.toUpperCase().startsWith(elemento.codigo.toUpperCase())
    ? `${elemento.codigo} - ${elemento.nombre}`
    : elemento.nombre;
}

/** Longitud BM25 de cada fragmento de una versión: insumo de `avgdl`. */
export function longitudesDe(version: VersionIndexable, elemento: ElementoIndexable): number[] {
  const titulo = tituloDe(elemento);
  return fragmentar(version).map(f =>
    longitudBm25(textoLexico({ titulo, url: elemento.urlOrigen, direccion: elemento.direccion, texto: f.texto })));
}

export type OpcionesIndexado = {
  coleccion?: string;
  avgdl?: number;
  embedder?: Embedder;
};

/**
 * Indexa todos los fragmentos de una versión publicada. Devuelve cuántos
 * puntos escribió. Idempotente: reindexar la misma versión sobrescribe los
 * mismos ids.
 */
export async function indexarVersion(
  version: VersionIndexable, elemento: ElementoIndexable, opciones: OpcionesIndexado = {},
): Promise<number> {
  const coleccion = opciones.coleccion ?? await asegurarColeccion();
  const avgdl = opciones.avgdl ?? AVGDL_POR_DEFECTO;
  const embedder = opciones.embedder ?? embed;
  const titulo = tituloDe(elemento);
  const fragmentos = fragmentar(version);

  const puntos = [];
  for (let i = 0; i < fragmentos.length; i += LOTE_EMBEDDINGS) {
    const lote = fragmentos.slice(i, i + LOTE_EMBEDDINGS);
    const densos = await embedder(lote.map(f => f.texto), "passage");
    for (const [k, f] of lote.entries()) {
      puntos.push({
        id: idPunto(version.id, f.numero),
        vector: {
          dense: densos[k],
          bm25: vectorBm25(textoLexico({ titulo, url: elemento.urlOrigen, direccion: elemento.direccion, texto: f.texto }), avgdl),
        },
        payload: {
          elemento_id: elemento.id,
          version_id: version.id,
          estado: "publicado",
          tipo: elemento.tipo,
          codigo: elemento.codigo,
          titulo,
          url: elemento.urlOrigen,
          url_padre: elemento.urlPadre,
          direccion: elemento.direccion,
          fecha_actualizacion: elemento.fechaActualizacion,
          fecha_acceso: version.fechaAcceso.toISOString(),
          fragmento: f.numero,
          ...(f.pagina === undefined ? {} : { pagina: f.pagina }),
          texto: f.texto,
        },
      });
    }
  }
  for (let i = 0; i < puntos.length; i += LOTE_UPSERT) {
    await cliente().upsert(coleccion, { wait: true, points: puntos.slice(i, i + LOTE_UPSERT) });
  }
  return puntos.length;
}

async function borrarPor(campo: "version_id" | "elemento_id", valor: string, coleccion?: string): Promise<void> {
  const destino = coleccion ?? await coleccionDelAlias(cliente());
  if (!destino) return;
  await cliente().delete(destino, { wait: true, filter: { must: [{ key: campo, match: { value: valor } }] } });
}

export const borrarPuntosVersion = (versionId: string, coleccion?: string) => borrarPor("version_id", versionId, coleccion);
export const borrarPuntosElemento = (elementoId: string, coleccion?: string) => borrarPor("elemento_id", elementoId, coleccion);

/** Cuántos puntos tiene la colección (o los de un elemento). */
export async function contarPuntos(coleccion?: string, elementoId?: string): Promise<number> {
  const destino = coleccion ?? await coleccionDelAlias(cliente());
  if (!destino) return 0;
  const { count } = await cliente().count(destino, {
    exact: true,
    ...(elementoId ? { filter: { must: [{ key: "elemento_id", match: { value: elementoId } }] } } : {}),
  });
  return count;
}

/** Actualiza la dirección en el payload de los puntos de un elemento (kb recalcular-direcciones). */
export async function actualizarDireccion(elementoId: string, direccion: string, coleccion?: string): Promise<void> {
  const destino = coleccion ?? await coleccionDelAlias(cliente());
  if (!destino) return;
  await cliente().setPayload(destino, {
    wait: true, payload: { direccion },
    filter: { must: [{ key: "elemento_id", match: { value: elementoId } }] },
  });
}

/** Actualiza el título en el payload de los puntos de un elemento (kb recalcular-nombres). */
export async function actualizarTitulo(elementoId: string, titulo: string, coleccion?: string): Promise<void> {
  const destino = coleccion ?? await coleccionDelAlias(cliente());
  if (!destino) return;
  await cliente().setPayload(destino, {
    wait: true, payload: { titulo },
    filter: { must: [{ key: "elemento_id", match: { value: elementoId } }] },
  });
}

/** Ids de elementos con al menos un punto en la colección servida (auditoría de alcance). */
export async function elementosIndexados(coleccion?: string): Promise<Set<string>> {
  const destino = coleccion ?? await coleccionDelAlias(cliente());
  const ids = new Set<string>();
  if (!destino) return ids;
  let offset: string | number | undefined | null = undefined;
  do {
    const pagina: Awaited<ReturnType<ReturnType<typeof cliente>["scroll"]>> = await cliente().scroll(destino, {
      limit: 512, with_payload: ["elemento_id"], with_vector: false, ...(offset ? { offset } : {}),
    });
    for (const p of pagina.points) ids.add(String((p.payload as Record<string, unknown>).elemento_id));
    offset = pagina.next_page_offset as string | number | null | undefined;
  } while (offset);
  return ids;
}
