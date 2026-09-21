/**
 * Volcado binario del índice, para no reconstruirlo en cada arranque.
 *
 * Construir el índice desde la caché por documento cuesta ~92 s: 11 s de
 * `JSON.parse` sobre 1,54 GB —el vector de cada fragmento ocupa 7,7 KB escrito
 * como dígitos decimales frente a 1,5 KB en binario— más la construcción del
 * índice invertido. Como F1 y F2 dejaron todo en `TypedArray`, guardarlo es
 * volcar búferes y cargarlo es crear vistas sobre ellos, sin parsear nada.
 *
 * El snapshot es un artefacto DERIVADO Y DESECHABLE. Si falta, si la firma no
 * coincide, si la versión de formato cambió o si está corrupto, se ignora y el
 * índice se reconstruye desde la caché por documento, que sigue siendo la
 * fuente de verdad. Borrarlo nunca cuesta más que un arranque lento, y en
 * particular NO afecta a la clave de `cacheFileFor()`: nada se re-embebe jamás.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { BM25, type Bm25Snapshot } from "./retrievalMath.js";

/** Subir esto invalida los snapshots existentes sin tocar la caché por documento. */
const FORMAT_VERSION = 3;
const MAGIC = "GBIX";
/** Todas las secciones empiezan en múltiplo de 8: `Float32Array` exige alineación. */
const ALIGNMENT = 8;

export type IndexSnapshot = {
  signature: string;
  count: number;
  documents: number;
  dimensions: number;
  docPaths: string[];
  chunkDoc: Int32Array;
  chunkNo: Int32Array;
  /** Página del PDF donde empieza cada fragmento; 0 = el formato no tiene páginas (M-4). */
  chunkPage: Int32Array;
  snippets: string[];
  vectors: Float32Array;
  bm25: BM25;
};

type SectionName =
  | "vectors" | "chunkDoc" | "chunkNo" | "chunkPage"
  | "docPaths" | "docPathOffsets" | "snippets" | "snippetOffsets"
  | "terms" | "termOffsets" | "start" | "postingDoc" | "postingTf" | "lengths";

type Header = {
  formatVersion: number;
  signature: string;
  count: number;
  documents: number;
  dimensions: number;
  bm25: { total: number; average: number };
  sections: Record<SectionName, [offset: number, byteLength: number]>;
};

/**
 * Prefijo que agrupa los snapshots de una misma raiz documental.
 *
 * La firma del indice ya incluye la raiz, asi que dos corpus distintos producen
 * snapshots distintos y pueden convivir. Lo que no puede es que la limpieza de
 * uno borre los del otro: `npm run test:integration` indexa un corpus temporal
 * reutilizando el mismo RETRIEVAL_CACHE_DIR, y sin este prefijo se llevaba por
 * delante el snapshot del corpus real.
 */
export function rootScope(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 12);
}

export function snapshotPathFor(cacheDir: string, root: string, signature: string): string {
  return path.join(cacheDir, `snapshot-${rootScope(root)}-${signature}.bin`);
}

function align(value: number): number {
  return Math.ceil(value / ALIGNMENT) * ALIGNMENT;
}

/** Concatena cadenas en UTF-8 y devuelve el blob más los offsets de cada una. */
function packStrings(values: string[]): { blob: Uint8Array; offsets: Int32Array } {
  const encoder = new TextEncoder();
  const encoded = values.map(value => encoder.encode(value));
  const offsets = new Int32Array(values.length + 1);
  let total = 0;
  for (const [index, bytes] of encoded.entries()) {
    total += bytes.length;
    offsets[index + 1] = total;
  }
  const blob = new Uint8Array(total);
  for (const [index, bytes] of encoded.entries()) blob.set(bytes, offsets[index]);
  return { blob, offsets };
}

/**
 * Decodifica cada cadena por separado en lugar de decodificar el blob entero y
 * cortarlo. Un único `decode` produciría una cadena padre de dos bytes por
 * carácter en cuanto apareciera un solo carácter fuera de Latin-1 —una comilla
 * tipográfica basta—, duplicando la memoria de los 169 MB de fragmentos.
 */
function unpackStrings(blob: Buffer, offsets: Int32Array): string[] {
  const values = new Array<string>(offsets.length - 1);
  for (let index = 0; index + 1 < offsets.length; index++) {
    values[index] = blob.toString("utf8", offsets[index], offsets[index + 1]);
  }
  return values;
}

export async function saveSnapshot(
  cacheDir: string,
  root: string,
  snapshot: Omit<IndexSnapshot, "bm25"> & { bm25: Bm25Snapshot },
): Promise<void> {
  const docPathsPacked = packStrings(snapshot.docPaths);
  const snippetsPacked = packStrings(snapshot.snippets);

  const payload: Record<SectionName, ArrayBufferView> = {
    vectors: snapshot.vectors,
    chunkDoc: snapshot.chunkDoc,
    chunkNo: snapshot.chunkNo,
    chunkPage: snapshot.chunkPage,
    docPaths: docPathsPacked.blob,
    docPathOffsets: docPathsPacked.offsets,
    snippets: snippetsPacked.blob,
    snippetOffsets: snippetsPacked.offsets,
    terms: snapshot.bm25.terms,
    termOffsets: snapshot.bm25.termOffsets,
    start: snapshot.bm25.start,
    postingDoc: snapshot.bm25.postingDoc,
    postingTf: snapshot.bm25.postingTf,
    lengths: snapshot.bm25.lengths,
  };

  // Primero se calcula la cabecera con offsets provisionales, porque su tamaño
  // (que depende de los propios offsets) desplaza el inicio de la primera
  // sección. Se resuelve en dos pasadas: la longitud del JSON no cambia al
  // sustituir los ceros por los offsets reales porque se rellenan a ancho fijo.
  const names = Object.keys(payload) as SectionName[];
  const sections = {} as Header["sections"];
  for (const name of names) sections[name] = [0, payload[name].byteLength];
  const header: Header = {
    formatVersion: FORMAT_VERSION,
    signature: snapshot.signature,
    count: snapshot.count,
    documents: snapshot.documents,
    dimensions: snapshot.dimensions,
    bm25: { total: snapshot.bm25.total, average: snapshot.bm25.average },
    sections,
  };

  const assignOffsets = (headerBytes: number): number => {
    let offset = align(8 + headerBytes);
    for (const name of names) {
      sections[name][0] = offset;
      offset = align(offset + payload[name].byteLength);
    }
    return offset;
  };
  // Dos iteraciones bastan: la segunda solo puede crecer el JSON en dígitos, y
  // se vuelve a resolver hasta que el tamaño se estabiliza.
  let headerJson = Buffer.from(JSON.stringify(header), "utf8");
  for (let attempt = 0; attempt < 4; attempt++) {
    assignOffsets(headerJson.byteLength);
    const next = Buffer.from(JSON.stringify(header), "utf8");
    if (next.byteLength === headerJson.byteLength) { headerJson = next; break; }
    headerJson = next;
  }
  assignOffsets(headerJson.byteLength);

  const target = snapshotPathFor(cacheDir, root, snapshot.signature);
  const temporary = `${target}.tmp`;
  const handle = await fs.open(temporary, "w");
  try {
    const prologue = Buffer.alloc(align(8 + headerJson.byteLength));
    prologue.write(MAGIC, 0, "ascii");
    prologue.writeUInt32LE(headerJson.byteLength, 4);
    headerJson.copy(prologue, 8);
    let position = prologue.byteLength;
    await handle.write(prologue, 0, prologue.byteLength, 0);

    for (const name of names) {
      const view = payload[name];
      const bytes = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
      const [offset] = sections[name];
      if (offset > position) {
        await handle.write(Buffer.alloc(offset - position), 0, offset - position, position);
      }
      await handle.write(bytes, 0, bytes.byteLength, offset);
      position = offset + bytes.byteLength;
    }
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, target);
}

/**
 * Carga el snapshot de esa firma. Devuelve `undefined` ante cualquier problema:
 * un snapshot ausente, viejo, truncado o corrupto solo significa reconstruir.
 */
/**
 * Se lee sección por sección en lugar de cargar el archivo entero.
 *
 * Con un único `readFile`, las vistas numéricas apuntan al búfer completo y lo
 * mantienen vivo — incluidos los ~171 MB de bytes de cadenas que ya se han
 * decodificado a strings de JavaScript, duplicándolos. Leyendo por secciones,
 * cada arreglo tipado es dueño de su propia memoria y los blobs de texto se
 * liberan en cuanto se decodifican.
 */
export async function loadSnapshot(
  cacheDir: string,
  root: string,
  signature: string,
): Promise<IndexSnapshot | undefined> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(snapshotPathFor(cacheDir, root, signature), "r");
  } catch {
    return undefined;
  }

  try {
    const { size } = await handle.stat();
    const prologue = Buffer.alloc(8);
    if ((await handle.read(prologue, 0, 8, 0)).bytesRead !== 8) return undefined;
    if (prologue.toString("ascii", 0, 4) !== MAGIC) return undefined;
    const headerBytes = prologue.readUInt32LE(4);
    if (headerBytes <= 0 || 8 + headerBytes > size) return undefined;

    const headerBuffer = Buffer.alloc(headerBytes);
    await handle.read(headerBuffer, 0, headerBytes, 8);
    const header = JSON.parse(headerBuffer.toString("utf8")) as Header;
    if (header.formatVersion !== FORMAT_VERSION || header.signature !== signature) return undefined;

    const readSection = async (name: SectionName, target: ArrayBufferView): Promise<void> => {
      const [offset, byteLength] = header.sections[name];
      if (offset + byteLength > size) throw new Error(`sección ${name} truncada`);
      if (target.byteLength !== byteLength) throw new Error(`sección ${name} con tamaño inesperado`);
      const into = Buffer.from(target.buffer, target.byteOffset, target.byteLength);
      const { bytesRead } = await handle.read(into, 0, byteLength, offset);
      if (bytesRead !== byteLength) throw new Error(`sección ${name} incompleta`);
    };
    const byteLengthOf = (name: SectionName): number => header.sections[name][1];
    const readTyped = async <T extends ArrayBufferView>(name: SectionName, make: (length: number) => T, bytesPerElement: number): Promise<T> => {
      const byteLength = byteLengthOf(name);
      if (byteLength % bytesPerElement !== 0) throw new Error(`sección ${name} con longitud no múltiplo`);
      const target = make(byteLength / bytesPerElement);
      await readSection(name, target);
      return target;
    };
    const readInt32 = (name: SectionName) => readTyped(name, l => new Int32Array(l), 4);
    const readStrings = async (blob: SectionName, offsetsSection: SectionName): Promise<string[]> => {
      const offsets = await readInt32(offsetsSection);
      const bytes = Buffer.alloc(byteLengthOf(blob));
      await readSection(blob, bytes);
      return unpackStrings(bytes, offsets);   // `bytes` queda libre al salir
    };

    const vectors = await readTyped("vectors", l => new Float32Array(l), 4);
    if (vectors.length !== header.count * header.dimensions) {
      throw new Error("el número de vectores no cuadra con el de fragmentos");
    }

    const terms = Buffer.alloc(byteLengthOf("terms"));
    await readSection("terms", terms);
    const bm25 = new BM25({
      terms,
      termOffsets: await readInt32("termOffsets"),
      start: await readInt32("start"),
      postingDoc: await readInt32("postingDoc"),
      postingTf: await readTyped("postingTf", l => new Uint16Array(l), 2),
      lengths: await readInt32("lengths"),
      total: header.bm25.total,
      average: header.bm25.average,
    });

    return {
      signature,
      count: header.count,
      documents: header.documents,
      dimensions: header.dimensions,
      docPaths: await readStrings("docPaths", "docPathOffsets"),
      chunkDoc: await readInt32("chunkDoc"),
      chunkNo: await readInt32("chunkNo"),
      chunkPage: await readInt32("chunkPage"),
      snippets: await readStrings("snippets", "snippetOffsets"),
      vectors,
      bm25,
    };
  } catch (error) {
    console.warn(`[retrieval] Snapshot inservible, se reconstruye el índice: ${error instanceof Error ? error.message : error}`);
    return undefined;
  } finally {
    await handle.close();
  }
}

/** Un snapshot de otra raiz se considera abandonado pasado este tiempo. */
const STALE_OTHER_ROOT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Limpia snapshots que ya no sirven.
 *
 * De ESTA raiz documental borra todos menos el de la firma vigente: cada uno
 * ocupa cientos de MB. De otras raices solo borra los que llevan mas de un mes
 * sin actualizarse, que es como se acumulan los de corpus temporales —cada
 * corrida de `npm run test:integration` deja uno—. Un backend vecino que siga
 * en uso reescribe el suyo y nunca envejece lo suficiente.
 */
export async function pruneSnapshots(cacheDir: string, root: string, keepSignature: string): Promise<number> {
  const prefix = `snapshot-${rootScope(root)}-`;
  const keep = `${prefix}${keepSignature}.bin`;
  const staleBefore = Date.now() - STALE_OTHER_ROOT_MS;
  let removed = 0;
  try {
    for (const name of await fs.readdir(cacheDir)) {
      if (!name.startsWith("snapshot-") || name === keep) continue;
      const file = path.join(cacheDir, name);
      if (!name.startsWith(prefix)) {
        const { mtimeMs } = await fs.stat(file).catch(() => ({ mtimeMs: Date.now() }));
        if (mtimeMs > staleBefore) continue;   // de otra raiz y todavia reciente
      }
      await fs.rm(file, { force: true });
      removed++;
    }
  } catch { /* el directorio puede no existir todavía */ }
  return removed;
}
