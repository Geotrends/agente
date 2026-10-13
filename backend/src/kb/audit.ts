/**
 * Auditoría de las acciones del operador que modifican la base (principio VII;
 * anticipa RF-C3-AD-41). Sin contenido de documentos ni contraseñas: solo
 * quién, qué, sobre qué objeto y con qué resultado. No hay función para editar
 * ni borrar filas.
 */
import os from "node:os";
import type { Pool, PoolClient } from "./db.js";
import { sanitizarDescripcion } from "./notifications.js";

/** Actor por defecto de la CLI: el usuario del sistema operativo que la ejecuta. */
export function actorActual(): string {
  return process.env.KB_ACTOR?.trim() || `cli:${os.userInfo().username}`;
}

export async function registrarAccion(
  db: Pool | PoolClient, actor: string, accion: string, objeto: string, resultado: string,
): Promise<void> {
  await db.query(
    "INSERT INTO kb.kb_auditoria (actor, accion, objeto, resultado) VALUES ($1, $2, $3, $4)",
    [actor.slice(0, 200), accion.slice(0, 100), objeto.slice(0, 1000), sanitizarDescripcion(resultado)],
  );
}
