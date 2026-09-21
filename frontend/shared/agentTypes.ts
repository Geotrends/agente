export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Modelo que respondio (solo agente unificado). */
  providerLabel?: string;
};
