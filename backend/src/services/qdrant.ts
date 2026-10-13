/**
 * Cliente compartido de Qdrant (contracts/qdrant-coleccion.md).
 *
 * El backend del chat y el kb-worker usan el mismo cliente, pero con papeles
 * distintos: el kb-worker es el único que escribe (colecciones físicas, alias,
 * puntos) y el chat SOLO consulta el alias `kb_chunks`. Qdrant no publica
 * puerto fuera de la red interna de Compose (principio VII).
 */
import { QdrantClient } from "@qdrant/js-client-rest";

/** Alias servido. El chat nunca consulta una colección física por nombre. */
export const ALIAS_KB = "kb_chunks";
export const DIMENSIONES_DENSO = 384;

/**
 * Alias en uso. `KB_QDRANT_ALIAS` existe solo para que cada archivo de pruebas
 * de integración trabaje con su propio alias en un Qdrant compartido; en
 * producción no se define y vale `kb_chunks`.
 */
export function aliasKb(): string {
  return process.env.KB_QDRANT_ALIAS?.trim() || ALIAS_KB;
}

const clientes = new Map<string, QdrantClient>();

export function qdrantUrl(): string {
  return process.env.QDRANT_URL || "http://localhost:6333";
}

/**
 * Cliente memoizado por URL y timeout. El chat usa 5 s: una consulta que tarda
 * más ya es una falla que debe responder SERVICIO_NO_DISPONIBLE. El kb-worker
 * pide más margen para las escrituras con `wait: true` de lotes grandes.
 */
export function qdrant(timeoutMs = 5_000): QdrantClient {
  const url = qdrantUrl();
  const clave = `${url}|${timeoutMs}`;
  let client = clientes.get(clave);
  if (!client) {
    // checkCompatibility hace una petición en el constructor; la versión ya está
    // fijada en el compose y en CI, así que no aporta nada y solo ensucia los logs.
    client = new QdrantClient({ url, timeout: timeoutMs, checkCompatibility: false });
    clientes.set(clave, client);
  }
  return client;
}

/** Colección física a la que apunta el alias, o undefined si el alias no existe. */
export async function coleccionDelAlias(client = qdrant(), alias = aliasKb()): Promise<string | undefined> {
  const { aliases } = await client.getAliases();
  return aliases.find(a => a.alias_name === alias)?.collection_name;
}
