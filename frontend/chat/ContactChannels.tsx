"use client";
import { ExternalLink } from "../shared/ExternalLink";
import { safeHttpsUrl } from "../shared/safeUrl";
import type { ContactosPublicos } from "../shared/chatContracts";
import { officialContactUrl, type ContactState } from "./contactState";
import { CANALES_NO_CARGADOS } from "./texts";

/** Recepción (PQRSD, WhatsApp, correo) del snapshot; PQRSD es https, WhatsApp/correo van como texto. */
export function ReceptionChannels({ contactos }: { contactos: ContactosPublicos }) {
  const { pqrsd, whatsapp, email } = contactos.recepcion;
  return (
    <ul className="channel-list">
      <li><strong>PQRSD</strong>: {safeHttpsUrl(pqrsd)
        ? <ExternalLink href={pqrsd} label="Radicar PQRSD">{pqrsd}</ExternalLink> : pqrsd}</li>
      <li><strong>WhatsApp</strong>: {whatsapp}</li>
      <li><strong>Correo</strong>: {email}</li>
    </ul>
  );
}

/** Canales de atención inmediata (emergencia): cada valor tal como lo administra la entidad. */
export function ImmediateChannels({ contactos }: { contactos: ContactosPublicos }) {
  if (contactos.inmediatos.length === 0) return <p>No hay canales de atención inmediata registrados.</p>;
  return (
    <ul className="channel-list">
      {[...contactos.inmediatos].sort((a, b) => a.position - b.position).map(c => (
        <li key={c.id}>
          <strong>{c.name}</strong> — {c.description}:{" "}
          {c.type === "url" && safeHttpsUrl(c.value)
            ? <ExternalLink href={c.value} label={c.name}>{c.value}</ExternalLink>
            : c.value}
        </li>
      ))}
    </ul>
  );
}

/** Sin snapshot: mensaje fijo y enlace oficial configurado; nunca teléfonos ni correos de reserva. */
export function ContactsUnavailable({ onRetry }: { onRetry?: () => void }) {
  const url = officialContactUrl();
  return (
    <div role="alert" className="channels-unavailable">
      <p>{CANALES_NO_CARGADOS}</p>
      {url && <p><ExternalLink href={url} label="Canales oficiales del Municipio de Envigado">Canales oficiales del Municipio de Envigado</ExternalLink></p>}
      {onRetry && <button type="button" className="button" onClick={onRetry}>Intentar de nuevo</button>}
    </div>
  );
}

export function Reception({ contacts, onRetry }: { contacts: ContactState; onRetry?: () => void }) {
  return contacts.snapshot ? <ReceptionChannels contactos={contacts.snapshot} /> : <ContactsUnavailable onRetry={onRetry} />;
}
