/**
 * Foco dentro del iframe (T025). Desktop: región no modal, Tab puede salir hacia el host. Móvil: el
 * host marca el exterior `inert` y aquí el foco se contiene (Tab en el último elemento vuelve al
 * primero y viceversa). Escape respeta el nivel: primero un diálogo interno, luego ocultar.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),summary';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.closest("[hidden],[inert]") && el.offsetParent !== null || el === document.activeElement);
}

/** Enfoca el inicio accesible del panel (el título/ primer control). */
export function focusStart(root: HTMLElement, attempts = 6): void {
  const target = root.querySelector<HTMLElement>("[data-focus-start]") ?? focusables(root)[0];
  target?.focus();
  // Con el panel recién visible o bajo carga, el primer intento puede ser ignorado: se reintenta
  // unos cuadros más hasta que el foco quede dentro del panel.
  if (attempts > 0 && target && document.activeElement !== target) {
    requestAnimationFrame(() => focusStart(root, attempts - 1));
  }
}

/**
 * Contención de foco para móvil. Devuelve la función que la retira. `onBoundary` informa al host
 * (FOCUS_BOUNDARY) para que mantenga el foco dentro del iframe.
 */
export function trapFocus(root: HTMLElement, onBoundary?: (direction: "forward" | "backward") => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = focusables(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus(); onBoundary?.("forward");
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus(); onBoundary?.("backward");
    }
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
