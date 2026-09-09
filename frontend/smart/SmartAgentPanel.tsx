"use client";

import { FormEvent, useState, useEffect } from "react";
import {
  AGENT_CHAT_URL,
  backendUnavailableMessage,
  COURSE_ID
} from "../shared/agentConfig";
import type { ChatMessage } from "../shared/agentTypes";
import { MessageContent } from "../shared/MessageContent";

const WELCOME: ChatMessage = {
  role: "assistant",
  content:
    "Hola, soy Geobot. Puedes preguntarme directamente sobre todos tus documentos."
};

export default function SmartAgentPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [lastProvider, setLastProvider] = useState<string | null>(null);

  const [provider, setProvider] = useState("auto");
  const [providers, setProviders] = useState<Array<{ id: string; configured: boolean }>>([]);
  const [sources, setSources] = useState<Array<{ path: string; chunk: number }>>([]);
  const [indexStatus, setIndexStatus] = useState("");
  useEffect(() => {
    fetch(AGENT_CHAT_URL.replace(/\/chat$/, "/providers")).then(r => r.json())
      .then(data => setProviders(data.providers)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!loading) return;
    const poll = async () => {
      try {
        const data = await fetch(AGENT_CHAT_URL.replace(/\/chat$/, "/retrieval/status")).then(r => r.json());
        setIndexStatus(data.state === "indexing" ? `Preparando documentos: ${data.completed} de ${data.total}. La primera consulta puede tardar varios minutos.` : "Buscando información y preparando la respuesta…");
      } catch { /* The chat request reports connection errors. */ }
    };
    void poll(); const timer = setInterval(poll, 2000);
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
      const response = await fetch(AGENT_CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          courseId: COURSE_ID,
          provider,
          autoRoute: provider === "auto",
          history
        })
      });

      const data = (await response.json()) as {
        answer?: string;
        error?: string;
        meta?: { providerLabel?: string; provider?: string; routingReason?: string; sources?: Array<{ path: string; chunk: number }> };
      };

      setSources(data.meta?.sources ?? []);
      const providerLabel =
        data.meta?.providerLabel || data.meta?.provider || "auto";
      setLastProvider(
        data.meta?.routingReason
          ? `${providerLabel} — ${data.meta.routingReason}`
          : providerLabel
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer || data.error || "Ocurrio un error al procesar la respuesta.",
          providerLabel
        }
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: backendUnavailableMessage()
        }
      ]);
    } finally {
      setLoading(false);
      setLastLatencyMs(Math.round(performance.now() - startedAt));
    }
  };

  return (
    <div className="smart-agent-shell agent-smart">
      <header className="chat-header">
        <img className="bot-avatar" src="/agent-avatar.png" alt="Avatar del agente inteligente" />
        <div>
          <strong>
            Geobot — <span className="agent-name">{provider}</span>
          </strong>
          <p>Consulta todas tus bibliotecas</p>
        </div>
      </header>

      <p className="doc-ready-badge">
        Alcance: <strong>Todos los documentos</strong>
      </p>
      <label htmlFor="provider">Modelo </label>
      <select id="provider" className="folder-select" value={provider} disabled={loading} onChange={e => setProvider(e.target.value)}>
        <option value="auto">Automático</option>
        {providers.map(p => <option key={p.id} value={p.id} disabled={!p.configured}>{p.id}{p.configured ? "" : " (sin API key)"}</option>)}
      </select>
      <p className="latency-hint">
        Ultima respuesta: <strong>{formatLatency(lastLatencyMs)}</strong>
        {lastProvider ? (
          <>
            {" "}
            · Modelo: <strong>{lastProvider}</strong>
          </>
        ) : null}
      </p>

      <div className="messages smart-messages">
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
            {message.providerLabel && (
              <span className="provider-badge">{message.providerLabel}</span>
            )}
            <MessageContent role={message.role} content={message.content} />
          </article>
        ))}
        {loading && (
          <article className="message assistant typing" aria-live="polite" aria-label="Agente escribiendo">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </article>
        )}
      </div>

      {loading && <p role="status">{indexStatus}</p>}
      {sources.length > 0 && <details><summary>Fuentes consultadas ({sources.length})</summary>
        <ul>{sources.map(s => <li key={`${s.path}-${s.chunk}`}>{s.path} · fragmento {s.chunk}</li>)}</ul>
      </details>}
      <form className="form" onSubmit={onSubmit}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Pregunta"
          placeholder="¿Qué necesitas saber?"
        />
        <button className="button icon-button" type="submit" disabled={loading} aria-label="Enviar">
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
