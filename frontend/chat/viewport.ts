/**
 * Geometría dentro del iframe (T024). El HOST mide con su `visualViewport` y envía VIEWPORT; aquí
 * solo se aplica a variables CSS para el layout flexible. Si el host aún no envió nada se usa el
 * tamaño propio como respaldo. Nunca viaja texto de consulta.
 */
export const BREAKPOINT_PX = 768;

export type PanelViewport = { width: number; height: number; offsetTop: number; offsetLeft: number };

/** <768 pantalla completa; ≥768 400 px × min(640 px, 85 % del alto). */
export function panelSize(hostWidth: number, hostHeight: number): { fullscreen: boolean; width: number; height: number } {
  if (hostWidth < BREAKPOINT_PX) return { fullscreen: true, width: hostWidth, height: hostHeight };
  return { fullscreen: false, width: 400, height: Math.min(640, Math.floor(hostHeight * 0.85)) };
}

export const isMobileViewport = (v: PanelViewport) => v.width < BREAKPOINT_PX;

export function applyViewport(root: HTMLElement, v: PanelViewport): void {
  root.style.setProperty("--panel-height", `${Math.floor(v.height)}px`);
  root.style.setProperty("--panel-width", `${Math.floor(v.width)}px`);
  root.dataset.mobile = isMobileViewport(v) ? "true" : "false";
}
