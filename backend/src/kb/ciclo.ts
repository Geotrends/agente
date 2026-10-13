/**
 * Lo que hace el kb-worker en cada ciclo. Separado de `worker.ts` para poder
 * probarlo sin levantar el proceso. Cada historia de usuario agrega aquí su
 * tarea periódica (procesar informes, vigilante semanal, purga diaria).
 */
import type { Pool } from "./db.js";

export type TareaCiclo = (db: Pool) => Promise<void>;

const tareas: Array<{ nombre: string; tarea: TareaCiclo }> = [];

export function registrarTareaCiclo(nombre: string, tarea: TareaCiclo): void {
  tareas.push({ nombre, tarea });
}

/** Corre todas las tareas; el fallo de una no impide las demás. */
export async function tareasDelCiclo(db: Pool): Promise<void> {
  for (const { nombre, tarea } of tareas) {
    try {
      await tarea(db);
    } catch (error) {
      console.error(`[kb-worker] Tarea "${nombre}" con error: ${error instanceof Error ? error.message : error}`);
    }
  }
}
