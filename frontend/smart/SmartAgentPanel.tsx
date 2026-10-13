"use client";
/**
 * El panel ya no tiene estado propio: delega en el flujo único de `frontend/chat` (SPEC004, T014).
 * Se conserva el módulo porque la página de inicio y las pruebas heredadas lo importan.
 */
import ChatPanel from "../chat/ChatPanel";

export default function SmartAgentPanel() {
  return <ChatPanel />;
}
