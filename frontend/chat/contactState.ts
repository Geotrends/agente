/**
 * Estado de los contactos oficiales (RF-C4-IN-06). Se obtienen con el bloque de configuración en el
 * primer montaje del iframe; nunca se guardan en storage/URL ni existen valores de reserva.
 */
import type { ContactosPublicos } from "../shared/chatContracts";
import { safeHttpsUrl } from "../shared/safeUrl";

export type ContactStatus = "absent" | "loading" | "ready" | "failed";

export type ContactState = {
  status: ContactStatus;
  /** Snapshot validado íntegro, solo en memoria. */
  snapshot?: ContactosPublicos;
  revision?: number;
  /** Solo una respuesta del epoch vigente puede modificar el estado. */
  requestedEpoch: number;
};

export const MAX_CONTACT_WAIT_MS = 5_000;

export const initialContactState = (epoch = 0): ContactState => ({ status: "absent", requestedEpoch: epoch });

export type ContactAction =
  | { type: "solicitar"; epoch: number }
  | { type: "listo"; epoch: number; snapshot: ContactosPublicos }
  | { type: "fallo"; epoch: number };

export function contactReducer(s: ContactState, a: ContactAction): ContactState {
  switch (a.type) {
    case "solicitar":
      // Un epoch nuevo reemplaza la solicitud anterior: su respuesta tardía quedará descartada.
      return s.status === "loading" && s.requestedEpoch === a.epoch ? s : { ...s, status: "loading", requestedEpoch: a.epoch };
    case "listo":
      if (a.epoch !== s.requestedEpoch) return s;
      return { status: "ready", snapshot: a.snapshot, revision: a.snapshot.revision, requestedEpoch: a.epoch };
    case "fallo":
      if (a.epoch !== s.requestedEpoch) return s;
      // Un snapshot ya disponible se conserva: un fallo posterior no lo borra.
      return s.snapshot ? { ...s, status: "ready" } : { status: "failed", requestedEpoch: a.epoch };
  }
}

/** Enlace oficial de contacto configurado al construir; nunca un teléfono ni un correo. */
export function officialContactUrl(): string | undefined {
  return safeHttpsUrl(process.env.NEXT_PUBLIC_OFFICIAL_CONTACT_URL);
}

export const CONTACTS_UNAVAILABLE_MESSAGE =
  "No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado.";
