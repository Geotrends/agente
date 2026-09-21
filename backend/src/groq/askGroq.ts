import { getResponseTokenLimit } from "../services/contextBudget.js";
import { createOpenAiCompatibleProvider } from "../shared/openAiCompatible.js";

/**
 * Aquí hubo una escalera de seis intentos que recortaba progresivamente el
 * contexto ante un HTTP 413, y se borró porque no podía dispararse (hallazgo
 * M-6): el diseño anterior mandaba documentos enteros, pero hoy el contexto son
 * 8 fragmentos de ~1.000 caracteres —unos 8-10 KB— contra un tope de 18.000.
 * El 413 se sigue tratando como error, con un mensaje que dice qué hacer; lo
 * que ya no existe es el bucle que fingía resolverlo.
 */
export const askGroq = createOpenAiCompatibleProvider({
  label: "Groq",
  provider: "groq",
  apiKeyEnv: "GROQ_API_KEY",
  missingKeyMessage: "Falta configurar GROQ_API_KEY en el backend.",
  url: () => "https://api.groq.com/openai/v1/chat/completions",
  body: base => ({ ...base, temperature: 0.25, max_tokens: getResponseTokenLimit() }),
  statusMessage: status => status === 413
    ? "Groq rechazo la solicitud por tamaño (HTTP 413). Prueba: elegir una subcarpeta en el panel para acotar el contexto, o usar otro proveedor."
    : undefined,
});
