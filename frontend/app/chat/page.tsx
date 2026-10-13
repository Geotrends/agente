"use client";
import "../../chat/panel.css";
import ChatPanel from "../../chat/ChatPanel";

/** Ruta del iframe del widget. Comparte el mismo estado/flujo que la página de inicio. */
export default function ChatPage() {
  return <main className="chat-route"><ChatPanel /></main>;
}
