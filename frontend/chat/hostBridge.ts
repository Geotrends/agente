/**
 * Puente iframe → host (T022). Solo habla con `window.parent` y únicamente en el origen oficial
 * configurado al construir; nunca usa `targetOrigin="*"` ni recibe el origen por querystring.
 */
import { envelope, parseFromHost, type ToHost, type ToIframe } from "../widget/protocol";
import { safeHttpsUrl } from "../shared/safeUrl";

/** Origen oficial del Observatorio. La variante de pruebas lo cambia en BUILD, nunca en runtime. */
export const HOST_ORIGIN: string = (() => {
  const configured = process.env.NEXT_PUBLIC_HOST_ORIGIN;
  if (configured) {
    // Las pruebas locales usan http://localhost; producción exige https.
    if (/^https:\/\/[^/]+$/.test(configured) || /^http:\/\/localhost(:\d+)?$/.test(configured)) return configured;
  }
  return safeHttpsUrl("https://observatorioenvigado.geotrends.co")!.replace(/\/$/, "");
})();

export const isEmbedded = (): boolean => typeof window !== "undefined" && window.parent !== window;

export function postToHost(m: ToHost): void {
  if (!isEmbedded()) return;
  window.parent.postMessage(envelope(m), HOST_ORIGIN);
}

/**
 * Escucha mensajes del host. Valida origin, source (== window.parent), versión, tipo y esquema; todo
 * lo demás se ignora sin efectos. Devuelve la función que desuscribe.
 */
export function listenToHost(handler: (m: ToIframe) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onMessage = (e: MessageEvent) => {
    if (!isEmbedded()) return;
    if (e.origin !== HOST_ORIGIN || e.source !== window.parent) return;
    const parsed = parseFromHost(e.data);
    if (parsed) handler(parsed);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
