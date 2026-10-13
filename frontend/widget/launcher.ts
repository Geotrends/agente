/**
 * Launcher del widget Geobot (RF-C4-UI-01/02, RNF-C4-UI-01). Artefacto independiente de ≤10 000 bytes:
 * sin React ni código de la app. Antes del primer clic solo existe este script y un botón nativo; no hay
 * red hacia Geobot. El iframe se crea una única vez en el primer clic y después solo se oculta/muestra.
 *
 * Instalación (data-attributes del <script>):
 *   data-geobot-origin   origen HTTPS del iframe (obligatorio), p. ej. https://geobot.ejemplo.gov.co
 *   data-gutter-right    separación derecha extra en px (controles del mapa), por defecto 16
 *   data-gutter-bottom   separación inferior extra en px, por defecto 16
 */
import { envelope, parseFromIframe, type ToIframe } from "./protocol";

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script || (window as unknown as { __geobotLauncher?: boolean }).__geobotLauncher) return;
  const origin = (script.dataset.geobotOrigin ?? "").replace(/\/+$/, "");
  // Solo HTTPS (o localhost en pruebas): un origen inválido deja el botón sin instalar.
  if (!/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/localhost(:\d+)?$/.test(origin)) return;
  (window as unknown as { __geobotLauncher?: boolean }).__geobotLauncher = true;

  const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  const gutterRight = num(script.dataset.gutterRight, 16);
  const gutterBottom = num(script.dataset.gutterBottom, 16);
  const BREAKPOINT = 768;
  const P = "geobot-w"; // prefijo de estilos: no hay CSS global sobre el portal

  const style = document.createElement("style");
  style.textContent =
    `.${P}-btn{position:fixed;z-index:2147483000;right:${gutterRight}px;bottom:${gutterBottom}px;` +
    `min-width:56px;min-height:56px;padding:0 18px;border:0;border-radius:28px;background:#076653;color:#fff;` +
    `font:600 15px "Segoe UI",sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(12,52,44,.35)}` +
    `.${P}-btn:focus-visible{outline:3px solid #0c342c;outline-offset:3px}` +
    `.${P}-box{position:fixed;z-index:2147483001;background:#fff;overflow:hidden;box-shadow:0 8px 30px rgba(12,52,44,.35)}` +
    `.${P}-box[hidden]{display:none}.${P}-box iframe{width:100%;height:100%;border:0;display:block}`;
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.type = "button";
  button.className = `${P}-btn`;
  button.textContent = "Geobot";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", `${P}-box`);
  button.setAttribute("aria-label", "Abrir conversación con Geobot");
  document.body.appendChild(button);

  let box: HTMLDivElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  let ready = false;
  let open = false;
  let inertSnapshot: Array<{ el: Element; had: boolean }> = [];

  const send = (m: ToIframe) => { if (frame?.contentWindow && ready) frame.contentWindow.postMessage(envelope(m), origin); };
  const isMobile = () => (window.visualViewport?.width ?? window.innerWidth) < BREAKPOINT;

  /** Geometría contractual: <768 pantalla completa; ≥768 400 px × min(640 px, 85 % del alto). */
  function layout() {
    if (!box) return;
    const vv = window.visualViewport;
    const w = vv?.width ?? window.innerWidth;
    const h = vv?.height ?? window.innerHeight;
    const top = vv?.offsetTop ?? 0;
    const left = vv?.offsetLeft ?? 0;
    const s = box.style;
    if (w < BREAKPOINT) {
      s.left = `${left}px`; s.top = `${top}px`; s.width = `${w}px`; s.height = `${h}px`; s.right = "auto"; s.bottom = "auto";
      s.borderRadius = "0";
    } else {
      const bh = Math.min(640, Math.floor(h * 0.85));
      s.width = "400px"; s.height = `${bh}px`; s.left = "auto"; s.top = "auto";
      s.right = `${gutterRight}px`; s.bottom = `${gutterBottom + 64}px`; s.borderRadius = "12px";
    }
    send({ type: "VIEWPORT", payload: { width: Math.max(1, w), height: Math.max(1, h), offsetTop: Math.max(0, top), offsetLeft: Math.max(0, left) } });
  }

  function setModal(on: boolean) {
    if (!box) return;
    if (on && isMobile()) {
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Conversación con Geobot");
      inertSnapshot = [];
      for (const el of Array.from(document.body.children)) {
        if (el === box) continue;
        inertSnapshot.push({ el, had: el.hasAttribute("inert") });
        el.setAttribute("inert", "");
      }
    } else {
      box.removeAttribute("role");
      box.removeAttribute("aria-modal");
      // Restaura exactamente el estado previo (no desactiva lo que ya estaba inerte).
      for (const { el, had } of inertSnapshot) if (!had) el.removeAttribute("inert");
      inertSnapshot = [];
    }
  }

  function show() {
    if (!box) {
      box = document.createElement("div");
      box.id = `${P}-box`;
      box.className = `${P}-box`;
      frame = document.createElement("iframe");
      frame.title = "Conversación con Geobot";
      frame.src = `${origin}/chat`;
      box.appendChild(frame);
      document.body.appendChild(box);
    }
    open = true;
    box.hidden = false;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", "Ocultar conversación con Geobot");
    layout();
    setModal(true);
    send({ type: "VISIBILITY", payload: { visible: true } });
    send({ type: "FOCUS_START", payload: {} });
    if (!ready) frame?.addEventListener("load", () => frame?.focus(), { once: true });
  }

  function hide(restoreFocus: boolean) {
    if (!box) return;
    open = false;
    setModal(false);
    box.hidden = true; // fuera del árbol accesible y del orden de foco; el iframe no se desmonta
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Abrir conversación con Geobot");
    send({ type: "VISIBILITY", payload: { visible: false } });
    if (restoreFocus) button.focus();
  }

  button.addEventListener("click", () => (open ? hide(false) : show()));

  window.addEventListener("message", (e: MessageEvent) => {
    if (!frame || e.origin !== origin || e.source !== frame.contentWindow) return;
    const m = parseFromIframe(e.data);
    if (!m) return;
    if (m.type === "READY") {
      ready = true;
      layout();
      send({ type: "VISIBILITY", payload: { visible: open } });
      if (open) send({ type: "FOCUS_START", payload: {} });
    } else if (m.type === "CLOSE") {
      hide(true);
    } else if (m.type === "FOCUS_BOUNDARY" && open) {
      frame.focus();
    }
  });

  window.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("scroll", layout);
  document.addEventListener("keydown", e => {
    // Escape oculta el panel; el diálogo de confirmación (dentro del iframe) maneja el suyo primero.
    if (e.key === "Escape" && open && isMobile()) hide(true);
  });
})();
