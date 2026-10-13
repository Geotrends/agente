"use client";
import { MessageContent } from "../shared/MessageContent";
import { ExternalLink } from "../shared/ExternalLink";
import { OPCIONES_CATEGORIA } from "../shared/chatContracts";
import { ContactsUnavailable, ImmediateChannels } from "./ContactChannels";
import { useChat } from "./ChatContext";
import { AVISO_ANONIMA } from "./texts";

/**
 * Único flujo de arranque (SPEC003): apertura exacta → Autorizo/No autorizo → cuatro categorías.
 * Emergencia está disponible desde la apertura sin decisión ni modelo y vuelve al flujo normal.
 */
export function StartupFlow() {
  const chat = useChat();
  const { session, config, contacts } = chat;

  if (session.startup === "apertura" || (!config && contacts.status === "loading")) {
    return <p role="status" className="status-line">Cargando Geobot…</p>;
  }
  if (!config || session.startup === "bloqueada") {
    // Sin configuración íntegra no se inventa apertura ni política: solo salida oficial.
    return <ContactsUnavailable onRetry={chat.ensureContacts} />;
  }

  return (
    <>
      <section className="consent-box" aria-labelledby="apertura-titulo">
        <h2 id="apertura-titulo" className="sr-only">Presentación de Geobot</h2>
        <MessageContent role="assistant" content={config.apertura} />

        {(session.startup === "consentimiento" || session.startup === "creandoConversacion") && (
          <>
            <p>
              Antes de empezar, lea la{" "}
              <ExternalLink href={config.politica.url} label={`política de tratamiento de datos, versión ${config.politica.version}`}>
                política de tratamiento de datos (versión {config.politica.version})
              </ExternalLink>
              . Si autoriza, Geobot recordará esta conversación mientras no recargue la página; si no autoriza, podrá consultar igualmente, pero cada pregunta se atiende sola.
            </p>
            <div className="consent-actions">
              {config.opciones.map(o => (
                <button key={o.valor} type="button" className="button"
                  // Tras reiniciar, no se autoriza hasta confirmar la versión vigente de la política.
                  disabled={chat.creating || session.startup === "creandoConversacion" || contacts.status === "loading"}
                  onClick={() => chat.decide(o.valor === "autorizo")}>
                  {o.etiqueta}
                </button>
              ))}
            </div>
            {chat.conversationNotice && (
              <p role="alert" className="status-line">
                {chat.conversationNotice === "politica"
                  ? "La política de datos cambió. Recargue la página para continuar."
                  : "No fue posible iniciar la conversación. Puede intentarlo de nuevo."}
              </p>
            )}
          </>
        )}
        {session.decision === "no_autorizo" && <p role="note" className="consent-note">{AVISO_ANONIMA}</p>}

        {session.startup !== "emergencia" && (
          <div className="emergency-option">
            <button type="button" className="button" aria-expanded={false} aria-controls="canales-emergencia"
              onClick={chat.openEmergency}>
              Emergencia o situación en curso
            </button>
          </div>
        )}
      </section>

      {session.startup === "emergencia" && (
        <section id="canales-emergencia" className="urgent-channels" aria-labelledby="emergencia-titulo">
          <h2 id="emergencia-titulo">Canales de atención inmediata</h2>
          {contacts.snapshot && contacts.snapshot.inmediatos.length > 0
            ? <ImmediateChannels contactos={contacts.snapshot} />
            : <ContactsUnavailable onRetry={chat.ensureContacts} />}
          <button type="button" className="button" onClick={chat.closeEmergency}>Continuar con la orientación</button>
        </section>
      )}

      {(session.startup === "categoria" || session.startup === "lista") && (
        <fieldset className="category-box">
          <legend>¿Sobre qué dirección es tu consulta?</legend>
          <p>Sirve para priorizar la búsqueda; no limita las respuestas a esa dirección.</p>
          <div className="consent-actions">
            {OPCIONES_CATEGORIA.map(o => (
              <button key={o.etiqueta} type="button" className="button"
                aria-pressed={session.categoria !== undefined && session.categoria === o.categoria}
                onClick={() => chat.chooseCategory(o.categoria)}>
                {o.etiqueta}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}
