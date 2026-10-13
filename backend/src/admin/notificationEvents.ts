/**
 * Emisión idempotente de avisos del panel con propietario verificado (T010, RF-C3-AD-28..31).
 *
 * Un aviso se agrupa por tipo + objeto + alcance + propietario mientras esté «no revisada»; una
 * repetición suma y mueve la última ocurrencia. Sin envíos externos (correo/webhook) ni textos de
 * personas: solo tipo, objeto seguro y descripción saneada. Se escribe con el cliente de la
 * mutación que lo origina para que ambos sean atómicos.
 */
import type pg from "pg";

export type NotificationScope = "sistema" | "carga";
export type NotificationObjectType = "componente" | "cuenta" | "documento";

export type NotificationEvent = {
  type: string;
  objectType: NotificationObjectType;
  objectId: string;
  description: string;
  scope?: NotificationScope;
  /** Cuenta verificada que subió el documento; obligatoria en alcance `carga`. */
  ownerAccountId?: string | null;
  documentIdentity?: string | null;
  at?: Date;
};

const MAX_DESCRIPTION = 240;

/** Descripción corta sin saltos de línea ni caracteres de control. */
export function safeDescription(text: string): string {
  // eslint-disable-next-line no-control-regex
  return [...text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()].slice(0, MAX_DESCRIPTION).join("");
}

export async function emitNotification(db: pg.Pool | pg.PoolClient, e: NotificationEvent): Promise<void> {
  const scope = e.scope ?? "sistema";
  if (scope === "carga" && !e.ownerAccountId) {
    // Sin propietario verificado no se inventa uno: el aviso queda de sistema (solo técnico).
    return emitNotification(db, { ...e, scope: "sistema", ownerAccountId: null });
  }
  const at = e.at ?? new Date();
  await db.query(
    `INSERT INTO admin.notification (type, object_type, object_id, safe_description, first_at, last_at,
                                     repetitions, scope, owner_account_id, document_identity)
     VALUES ($1,$2,$3,$4,$5,$5,1,$6,$7,$8)
     ON CONFLICT (type, object_type, object_id, scope, owner_key) WHERE state = 'no_revisada'
     DO UPDATE SET last_at = GREATEST(admin.notification.last_at, EXCLUDED.last_at),
                   repetitions = admin.notification.repetitions + 1,
                   revision = admin.notification.revision + 1`,
    [e.type, e.objectType, e.objectId, safeDescription(e.description), at, scope,
      scope === "carga" ? e.ownerAccountId : null, e.documentIdentity ?? null]);
}
