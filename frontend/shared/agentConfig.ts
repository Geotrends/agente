/** URL del chat; ruta relativa al origen de Geobot en producción (la sirve el proxy de nginx). */
export const AGENT_CHAT_URL =
  process.env.NEXT_PUBLIC_AGENT_API_URL || "http://localhost:3001/api/chat";
