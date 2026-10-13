/** Entorno DOM mínimo (jsdom) para probar el panel sin navegador. Solo pruebas. */
import { JSDOM } from "jsdom";

export function installDom(width = 1280): JSDOM {
  const dom = new JSDOM("<!doctype html><html lang='es'><body></body></html>", { url: "http://localhost:3000/", pretendToBeVisual: true });
  const win = dom.window as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis && key !== "document" && key !== "navigator") continue;
    try { Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: win[key] }); } catch { /* propiedad no redefinible */ }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: dom.window.sessionStorage });
  (dom.window as unknown as { innerWidth: number }).innerWidth = width;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}
