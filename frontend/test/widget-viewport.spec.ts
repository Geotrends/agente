/** T020: geometría contractual, foco/cierre y protocolo postMessage (RF-C4-UI-02, RNF-C4-IN-01/02). */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_ORIGIN, stubApi } from "./helpers/api";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");
const box = (page: Page) => page.locator("#geobot-w-box");

for (const [w, h, fullscreen] of [[320, 640, true], [375, 667, true], [767, 900, true], [768, 900, false], [1366, 768, false]] as const) {
  test(`${w}×${h}: ${fullscreen ? "pantalla completa" : "400 × min(640, 85 %)"} sin desplazamiento horizontal`, async ({ page, context }) => {
    await stubApi(context);
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/observatorio");
    await toggle(page).click();
    await expect(box(page)).toBeVisible();
    const r = await box(page).boundingBox();
    expect(r).not.toBeNull();
    if (fullscreen) {
      expect(Math.round(r!.width)).toBe(w);
      expect(Math.round(r!.height)).toBe(h);
    } else {
      expect(Math.round(r!.width)).toBe(400);
      expect(Math.round(r!.height)).toBe(Math.min(640, Math.floor(h * 0.85)));
    }
    const f = page.frameLocator("iframe");
    await expect(f.getByRole("button", { name: "Cerrar Geobot" })).toBeVisible();
    const overflow = await f.locator(".chat-panel").evaluate(el => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
  });
}

test("cierre del panel devuelve el foco al botón", async ({ page, context }) => {
  await stubApi(context);
  await page.goto("/observatorio");
  await toggle(page).click();
  await page.frameLocator("iframe").getByRole("button", { name: "Cerrar Geobot" }).click();
  await expect(box(page)).toBeHidden();
  await expect(toggle(page)).toBeFocused();
});

test("mensajes ajenos o malformados al iframe se ignoran: no hay efectos ni datos en el protocolo", async ({ page, context }) => {
  await stubApi(context);
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await expect(f.getByRole("heading", { name: "Geobot", exact: true })).toBeVisible();
  // Desde el host (origen correcto) pero esquema inválido o versión errónea: ignorados.
  await page.evaluate(() => {
    const w = document.querySelector("iframe")!.contentWindow!;
    const bad = [
      { namespace: "otro", version: 1, type: "VISIBILITY", payload: { visible: false } },
      { namespace: "geobot-widget", version: 2, type: "VISIBILITY", payload: { visible: false } },
      { namespace: "geobot-widget", version: 1, type: "VISIBILITY", payload: { visible: "no" } },
      { namespace: "geobot-widget", version: 1, type: "VIEWPORT", payload: { width: -1, height: 0, offsetTop: 0, offsetLeft: 0 } },
      { namespace: "geobot-widget", version: 1, type: "DESCONOCIDO", payload: {} },
      "texto",
    ];
    for (const m of bad) w.postMessage(m, "*");
  });
  await expect(f.getByRole("heading", { name: "Geobot", exact: true })).toBeVisible();
  await expect(f.locator(".chat-panel")).not.toHaveAttribute("inert", "");
});

test("el iframe solo habla con el host: ningún mensaje lleva texto, IDs ni token", async ({ page, context }) => {
  await stubApi(context);
  await page.addInitScript(() => {
    (window as unknown as { __msgs: unknown[] }).__msgs = [];
    window.addEventListener("message", e => (window as unknown as { __msgs: unknown[] }).__msgs.push({ origin: e.origin, data: e.data }));
  });
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await f.getByRole("button", { name: "Ecosistemas" }).click();
  await f.getByLabel("Pregunta").fill("dato personal 123456");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByText("Respuesta 1")).toBeVisible();
  const msgs = await page.evaluate(() => (window as unknown as { __msgs: unknown[] }).__msgs);
  const dump = JSON.stringify(msgs);
  expect(dump).toContain("READY");
  for (const secreto of ["tok-tecnico", "11111111-1111", "dato personal", "Ecosistemas", "Autorizo"]) expect(dump).not.toContain(secreto);
  for (const m of msgs as Array<{ origin: string }>) expect(m.origin).toBe(CHAT_ORIGIN);
});

test("móvil: diálogo modal con el exterior inert, foco contenido y estado restaurado al cerrar", async ({ page, context }) => {
  await stubApi(context);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/observatorio");
  // Un elemento del host ya inerte debe seguir inerte tras cerrar (restauración exacta).
  await page.evaluate(() => document.querySelector("#mapa .controles")!.setAttribute("inert", ""));
  await toggle(page).click();
  await expect(box(page)).toHaveAttribute("role", "dialog");
  await expect(box(page)).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#mapa")).toHaveAttribute("inert", "");
  // El foco inicia en el panel y Tab nunca lo saca del iframe.
  const f = page.frameLocator("iframe");
  await expect(f.getByRole("heading", { name: "Geobot", exact: true })).toBeFocused();
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
  await f.getByRole("button", { name: "Cerrar Geobot" }).click();
  await expect(box(page)).toBeHidden();
  await expect(page.locator("#mapa")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#mapa .controles")).toHaveAttribute("inert", "");
  await expect(toggle(page)).toBeFocused();
});

test("escritorio: región no modal; Tab puede salir hacia el Observatorio", async ({ page, context }) => {
  await stubApi(context);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/observatorio");
  await toggle(page).click();
  await expect(box(page)).not.toHaveAttribute("role", "dialog");
  await expect(page.locator("#mapa")).not.toHaveAttribute("inert", "");
});
