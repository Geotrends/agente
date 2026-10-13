"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { isEmbedded, listenToHost, postToHost } from "./hostBridge";
import { focusStart, trapFocus } from "./panelFocus";
import { applyViewport, isMobileViewport, type PanelViewport } from "./viewport";
import { MessageContent } from "../shared/MessageContent";
import { ExternalLink } from "../shared/ExternalLink";
import { ChatProvider, useChat } from "./ChatContext";
import { FeedbackControls } from "./FeedbackControls";
import { NewConversationDialog } from "./NewConversationDialog";
import { QueryFailure } from "./QueryFailure";
import { QueryStatus } from "./QueryStatus";
import { StartupFlow } from "./StartupFlow";
import { canQuery } from "./sessionReducer";

function Header({ onClose, onNew, newRef }: { onClose?: () => void; onNew: () => void; newRef: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <header className="chat-header">
      <img className="brand-logo" src="/brand/logo-envigado.png" alt="Logo del Observatorio Ambiental de Envigado" />
      <div>
        <h1 className="chat-title" tabIndex={-1} data-focus-start>Geobot</h1>
        <p>Orientación sobre trámites ambientales</p>
      </div>
      <button ref={newRef} type="button" className="button chat-new" onClick={onNew}>Nueva conversación</button>
      {onClose && <button type="button" className="button chat-close" onClick={onClose} aria-label="Cerrar Geobot">×</button>}
    </header>
  );
}

function Transcript() {
  const { session } = useChat();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [session.transcript.length, session.activeAttempt?.phase]);
  return (
    <div className="messages smart-messages" role="log" aria-live="polite" aria-label="Conversación con Geobot" tabIndex={0}>
      {session.transcript.map(m => (
        <div key={m.id} className={`message-row ${m.role === "ciudadano" ? "user" : "assistant"}`}>
          <article className={`message ${m.role === "ciudadano" ? "user" : "assistant"}`}>
            <span className="sr-only">{m.role === "ciudadano" ? "Usted: " : "Geobot: "}</span>
            {/* Consultas del ciudadano: texto plano, nunca interpretado. */}
            <MessageContent role={m.role === "ciudadano" ? "user" : "assistant"} content={m.content} />
            {m.role === "geobot" && m.sources && m.sources.length > 0 && (
              <details className="sources">
                <summary>Fuentes consultadas ({m.sources.length})</summary>
                <ul>
                  {m.sources.map(f => (
                    <li key={f.id}>
                      <ExternalLink href={f.enlace} label={f.nombre}>{f.nombre}</ExternalLink>{" · "}{f.fecha}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <FeedbackControls message={m} />
          </article>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Composer() {
  const chat = useChat();
  const [text, setText] = useState("");
  const enabled = canQuery(chat.session);
  const busy = chat.session.activeAttempt?.phase === "enviando";
  const placeholder = enabled ? "¿Qué necesita saber?"
    : chat.session.startup === "categoria" ? "Elija una dirección para empezar" : "Elija una opción para empezar";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (chat.submit(text)) setText("");
  }
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="question-input-wrap">
        <input className="input" value={text} onChange={e => setText(e.target.value)} aria-label="Pregunta"
          placeholder={placeholder} disabled={!enabled || busy} />
      </div>
      <button className="button icon-button" type="submit" aria-label="Enviar" disabled={!enabled || busy || !text.trim()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 3L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 3L14 21L10 14L3 10L21 3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}

function PanelBody({ onClose }: { onClose?: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const embedded = typeof window !== "undefined" && isEmbedded();
  const mobileRef = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !embedded) return;
    let untrap: (() => void) | undefined;
    const off = listenToHost(m => {
      if (m.type === "VISIBILITY") setVisible(m.payload.visible);
      else if (m.type === "FOCUS_START") focusStart(root);
      else if (m.type === "VIEWPORT") {
        const v: PanelViewport = m.payload;
        applyViewport(root, v);
        const mobile = isMobileViewport(v);
        if (mobile !== mobileRef.current) {
          mobileRef.current = mobile;
          untrap?.();
          untrap = mobile ? trapFocus(root, d => postToHost({ type: "FOCUS_BOUNDARY", payload: { direction: d } })) : undefined;
        }
      }
    });
    // READY no concede autorización de datos: solo informa que el iframe puede recibir geometría.
    postToHost({ type: "READY", payload: {} });
    return () => { off(); untrap?.(); };
  }, [embedded]);

  const close = embedded ? () => postToHost({ type: "CLOSE", payload: {} }) : onClose;
  const chat = useChat();
  const [dialogOpen, setDialogOpen] = useState(false);
  const newRef = useRef<HTMLButtonElement>(null);

  const cancelNew = () => { setDialogOpen(false); requestAnimationFrame(() => newRef.current?.focus()); };
  const confirmNew = () => {
    // Reinicio completo: nueva epoch, sin historial ni ID; el foco pasa al flujo nuevo.
    setDialogOpen(false);
    chat.reset();
    requestAnimationFrame(() => { const r = rootRef.current; if (r) focusStart(r); });
  };

  // Escape respeta el nivel: el diálogo lo atiende primero; sin diálogo, oculta el panel embebido.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !dialogOpen && embedded) { e.preventDefault(); postToHost({ type: "CLOSE", payload: {} }); }
  };

  return (
    <div ref={rootRef} className="smart-agent-shell agent-smart chat-panel"
      // Oculto: fuera del árbol accesible y del foco, sin desmontar (la sesión y los intentos siguen).
      onKeyDown={onPanelKeyDown}
      {...(visible ? {} : { inert: true, "aria-hidden": true })}>
      <Header onClose={close} onNew={() => setDialogOpen(true)} newRef={newRef} />
      {dialogOpen && <NewConversationDialog onConfirm={confirmNew} onCancel={cancelNew} />}
      <StartupFlow />
      <Transcript />
      <QueryStatus />
      <QueryFailure />
      <Composer />
    </div>
  );
}

/** Panel único. El mismo componente sirve a `/` (página de demostración) y a `/chat` (iframe). */
export default function ChatPanel({ onClose }: { onClose?: () => void }) {
  return (
    <ChatProvider>
      <PanelBody onClose={onClose} />
    </ChatProvider>
  );
}
