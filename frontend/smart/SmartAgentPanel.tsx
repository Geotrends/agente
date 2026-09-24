"use client";

import { FormEvent, useState, useEffect, useRef } from "react";
import { fetchWithSession } from "../shared/session";
import {
  AGENT_CHAT_URL,
  backendUnavailableMessage,
} from "../shared/agentConfig";
import type { ChatMessage } from "../shared/agentTypes";
import { MessageContent } from "../shared/MessageContent";

const WELCOME: ChatMessage = {
  role: "assistant",
  content:`
¡Hola! Soy Geobot, el asistente virtual del Observatorio Ambiental y Agropecuario del Municipio de Envigado.

Estoy aquí para orientarte sobre trámites, requisitos, procedimientos y canales de atención relacionados con las direcciones de Ecosistemas, Bienestar Animal y Gestión Ambiental.

Cuéntame, ¿en qué puedo ayudarte?`,
};

const DEFAULT_MAX_QUESTION_CHARS = 2500;

export default function SmartAgentPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [maxQuestionChars, setMaxQuestionChars] = useState(DEFAULT_MAX_QUESTION_CHARS);

  const [sources, setSources] = useState<
    Array<{
      path: string;
      chunk: number;
      title?: string;
      sourceUrl?: string;
      sourcePageUrl?: string;
      category?: string;
    }>
  >([]);
  const [indexStatus, setIndexStatus] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    void fetch(AGENT_CHAT_URL.replace(/\/chat$/, "/retrieval/status"))
      .then(response => response.ok ? response.json() : undefined)
      .then((data: { limits?: { maxMessageChars?: number } } | undefined) => {
        const configured = data?.limits?.maxMessageChars;
        if (typeof configured === "number" && Number.isInteger(configured) && configured > 0) {
          setMaxQuestionChars(configured);
        }
      })
      .catch(() => { /* El backend validará con su límite autoritativo. */ });
  }, []);

  useEffect(() => {
    if (!loading) return;
    const poll = async () => {
      try {
        const data = await fetch(
          AGENT_CHAT_URL.replace(/\/chat$/, "/retrieval/status"),
        ).then((r) => r.json());
        setIndexStatus(
          data.state === "indexing"
            ? `Preparando documentos: ${data.completed} de ${data.total}. La primera consulta puede tardar varios minutos.`
            : "Buscando información y preparando la respuesta…",
        );
      } catch {
        /* The chat request reports connection errors. */
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [loading]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const startedAt = performance.now();

    const history = messages
      .slice(1)
      .map(({ role, content }) => ({ role, content }));

    const nextUserMessage: ChatMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, nextUserMessage]);
    setInput("");
    setLoading(true);
    setSources([]);
    setIndexStatus("Buscando información…");

    try {
      const response = await fetchWithSession(AGENT_CHAT_URL, AGENT_CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          provider: "auto",
          autoRoute: true,
          history,
        }),
      });

      const data = (await response.json()) as {
        answer?: string;
        error?: string;
        meta?: {
          providerLabel?: string;
          provider?: string;
          model?: string;
          routingReason?: string;
          sources?: Array<{
            path: string;
            chunk: number;
            title?: string;
            sourceUrl?: string;
            sourcePageUrl?: string;
            category?: string;
          }>;
        };
      };

      const retryAfter = Number(response.headers.get("Retry-After"));
      const retryHint = !response.ok && Number.isFinite(retryAfter) && retryAfter > 0
        ? ` ${formatRetryAfter(retryAfter)}`
        : "";

      setSources(data.meta?.sources ?? []);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.answer ||
            (data.error ? `${data.error}${retryHint}` : undefined) ||
            "Ocurrio un error al procesar la respuesta.",
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: backendUnavailableMessage(),
        },
      ]);
    } finally {
      setLoading(false);
      setLastLatencyMs(Math.round(performance.now() - startedAt));
    }
  };

  return (
    <div className="smart-agent-shell agent-smart">
      <header className="chat-header">
        <img
          className="bot-avatar"
          src="/agent-avatar.png"
          alt="Avatar del agente inteligente"
        />
        <div>
          <strong>Geobot</strong>
          <p>Consulta todas tus bibliotecas</p>
        </div>
      </header>

      <p className="latency-hint">
        Ultima respuesta: <strong>{formatLatency(lastLatencyMs)}</strong>
      </p>

      <div className="messages smart-messages">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`message-row ${message.role}`}
          >
            <img
              className="message-avatar"
              src={
                message.role === "user"
                  ? "/avatar_persona.png"
                  : "/avatar_chatbot.png"
              }
              alt={
                message.role === "user"
                  ? "Avatar del usuario"
                  : "Avatar del agente"
              }
            />
            <article className={`message ${message.role}`}>
              {message.providerLabel && (
                <span className="provider-badge">{message.providerLabel}</span>
              )}
              <MessageContent role={message.role} content={message.content} />
            </article>
          </div>
        ))}
        {loading && (
          <div className="message-row assistant">
            <img
              className="message-avatar"
              src="/avatar_chatbot.png"
              alt="Avatar del agente"
            />
            <article
              className="message assistant typing"
              aria-live="polite"
              aria-label="Agente escribiendo"
            >
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </article>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {loading && <p role="status">{indexStatus}</p>}
      {sources.length > 0 && (
        <details>
          <summary>Fuentes consultadas ({sources.length})</summary>
          <ul>
            {sources.map((s) => (
              <li key={`${s.path}-${s.chunk}`}>
                {s.sourceUrl ? (
                  <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                    {s.title || getFileName(s.path)}
                  </a>
                ) : (
                  s.title || getFileName(s.path)
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <form className="form" onSubmit={onSubmit}>
        <div className="question-input-wrap">
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={maxQuestionChars}
            aria-label="Pregunta"
            aria-describedby="question-character-count"
            placeholder="¿Qué necesitas saber?"
          />
          <span
            id="question-character-count"
            className={`character-count${input.length >= Math.floor(maxQuestionChars * 0.9) ? " warning" : ""}`}
            aria-live="polite"
          >
            {input.length}/{maxQuestionChars}
          </span>
        </div>
        <button
          className="button icon-button"
          type="submit"
          disabled={loading || !input.trim() || input.length > maxQuestionChars}
          aria-label="Enviar"
        >
          <svg
            className="send-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M21 3L10 14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M21 3L14 21L10 14L3 10L21 3Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
    </div>
  );
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "--";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  return `${(seconds / 60).toFixed(2)} min`;
}

function formatRetryAfter(seconds: number): string {
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `Intenta nuevamente en unos ${rounded} segundos.`;
  const minutes = Math.ceil(rounded / 60);
  if (minutes < 60) return `Intenta nuevamente en unos ${minutes} minutos.`;
  const hours = Math.ceil(minutes / 60);
  return `Intenta nuevamente en unas ${hours} horas.`;
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
