/**
 * Notificaciones al administrador técnico (FR-018; RF-C3-IV-03, IV-04, IV-07).
 *
 * Se persisten ahora y se muestran en el panel del bloque 7 (RF-C3-AD-28);
 * mientras tanto se consultan con `kb notificaciones`. NUNCA salen por correo
 * ni por ningún canal externo: es una regla del documento C3–C4, no una
 * omisión.
 *
 * Las repetidas del mismo tipo y objeto se agrupan mientras sigan sin revisar
 * (un enlace caído cuatro semanas seguidas es UNA notificación con contador
 * 4), con el índice único parcial de la migración 001. Revisada la anterior,
 * la siguiente ocurrencia abre una nueva (RF-C3-AD-30).
 */
import type { Pool, PoolClient } from "./db.js";
import { maskPersonalData } from "../services/pii.js";

export const TIPOS_NOTIFICACION = [
  "documento_derogado", "verificacion_fallida", "descarte_ocr", "formato_con_datos_personales",
  "texto_nativo_ilegible", "fuera_de_alcance", "verificacion_atrasada", "indexacion_fallida",
  "procedimiento_faltante", "documento_vencido", "fuente_retirada", "carga_rechazada",
] as const;
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

type Db = Pool | PoolClient;

/**
 * Quita lo que no debe llegar a una pantalla de administración: rutas
 * absolutas del contenedor o del host, trazas y datos personales.
 */
export function sanitizarDescripcion(texto: string): string {
  return maskPersonalData(texto)
    .replace(/(?:\/(?:app|data|home|Users|tmp|var|opt|private)\/)[^\s"'),]*/g, "[ruta]")
    .replace(/[A-Za-z]:\\[^\s"']*/g, "[ruta]")
    .replace(/\n\s+at\s.*$/gms, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export type OpcionesNotificacion = {
  /** Cuenta verificada que subió el documento: el aviso es «de carga» y solo ella (y el técnico) lo ve. */
  propietario?: string | null;
  identidadDocumento?: string | null;
};

/**
 * Crea o agrupa una notificación. Devuelve su id. Con propietario verificado el aviso es de carga;
 * sin él es de sistema (solo el técnico): nunca se asigna un autor por heurística.
 */
export async function notificar(
  db: Db, tipo: TipoNotificacion, objeto: string, descripcion: string, opciones: OpcionesNotificacion = {},
): Promise<string> {
  const propietario = opciones.propietario ?? null;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO kb.kb_notificacion (tipo, objeto, descripcion, alcance, propietario_cuenta, identidad_documento)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tipo, objeto, alcance, propietario_clave) WHERE estado = 'no_revisada'
     DO UPDATE SET repeticiones = kb.kb_notificacion.repeticiones + 1,
                   ultima_en = now(),
                   revision = kb.kb_notificacion.revision + 1,
                   descripcion = EXCLUDED.descripcion
     RETURNING id`,
    [tipo, objeto.slice(0, 1000), sanitizarDescripcion(descripcion), propietario ? "carga" : "sistema", propietario,
      opciones.identidadDocumento ?? null],
  );
  return rows[0].id;
}

export type Notificacion = {
  id: string; tipo: TipoNotificacion; objeto: string; descripcion: string;
  estado: "no_revisada" | "revisada"; repeticiones: number;
  primeraEn: Date; ultimaEn: Date; revisadaPor: string | null; revisadaEn: Date | null;
};

export async function listarNotificaciones(db: Db, { todas = false } = {}): Promise<Notificacion[]> {
  const { rows } = await db.query(
    `SELECT id, tipo, objeto, descripcion, estado, repeticiones, primera_en, ultima_en, revisada_por, revisada_en
       FROM kb.kb_notificacion ${todas ? "" : "WHERE estado = 'no_revisada'"}
      ORDER BY ultima_en DESC`,
  );
  return rows.map(r => ({
    id: r.id, tipo: r.tipo, objeto: r.objeto, descripcion: r.descripcion, estado: r.estado,
    repeticiones: r.repeticiones, primeraEn: r.primera_en, ultimaEn: r.ultima_en,
    revisadaPor: r.revisada_por, revisadaEn: r.revisada_en,
  }));
}

/** Marca una notificación como revisada. false si no existía o ya estaba revisada. */
export async function marcarRevisada(db: Db, id: string, actor: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE kb.kb_notificacion SET estado = 'revisada', revisada_por = $2, revisada_en = now()
      WHERE id = $1 AND estado = 'no_revisada'`,
    [id, actor],
  );
  return (rowCount ?? 0) > 0;
}
