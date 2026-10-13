/** T019: red antes del clic, un solo iframe, continuidad tras ocultar/mostrar y mapa intacto (RNF-C4-UI-01). */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_ORIGIN, stubApi } from "./helpers/api";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");
const frame = (page: Page) => page.frameLocator('iframe[title="Conversación con Geobot"]');

test("antes del clic: cero solicitudes al dominio de Geobot; un iframe tras el primer clic", async ({ page, context }) => {
  await stubApi(context);
  const toChat: string[] = [];
  page.on("request", r => { if (r.url().startsWith(CHAT_ORIGIN)) toChat.push(r.url()); });
  for (let i = 0; i < 3; i++) {
    toChat.length = 0;
    await page.goto("/observatorio", { waitUntil: "networkidle" });
    await expect(toggle(page)).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(toChat, "sin tráfico a Geobot antes del clic").toEqual([]);
  }
  await toggle(page).click();
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(frame(page).getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
  expect(toChat.some(u => u.endsWith("/chat"))).toBe(true);
});

test("dos consultas y cinco ciclos ocultar/mostrar conservan la conversación sin recargar el iframe", async ({ page, context }) => {
  const api = await stubApi(context);
  await page.goto("/observatorio");
  const camaraAntes = await page.locator("#mapa").getAttribute("data-camera");
  await toggle(page).click();
  const f = frame(page);
  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  for (const q of ["primera pregunta", "segunda pregunta"]) {
    await f.getByLabel("Pregunta").fill(q);
    await f.getByRole("button", { name: "Enviar" }).click();
    await expect(f.getByText(`Respuesta ${q.startsWith("primera") ? 1 : 2}`)).toBeVisible();
  }
  const chatRequestsBefore: string[] = [];
  page.on("request", r => { if (r.url().startsWith(CHAT_ORIGIN) && !r.url().includes("/api/")) chatRequestsBefore.push(r.url()); });
  for (let i = 0; i < 5; i++) {
    await toggle(page).click(); // ocultar
    await expect(page.locator("#geobot-w-box")).toBeHidden();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await toggle(page).click(); // mostrar
    await expect(page.locator("#geobot-w-box")).toBeVisible();
  }
  const log = f.getByRole("log");
  await expect(log).toContainText("primera pregunta");
  await expect(log).toContainText("Respuesta 1");
  await expect(log).toContainText("segunda pregunta");
  await expect(log).toContainText("Respuesta 2");
  expect(chatRequestsBefore, "el iframe no se recarga al mostrar").toEqual([]);
  expect(api.conversations).toBe(1);
  expect(api.chats).toHaveLength(2);
  expect(await page.locator("#mapa").getAttribute("data-camera")).toBe(camaraAntes);
  await expect(page.locator("iframe")).toHaveCount(1);
});

test("oculto: el panel no es enfocable ni está en el árbol accesible, y el botón sigue visible", async ({ page, context }) => {
  await stubApi(context);
  await page.goto("/observatorio");
  await toggle(page).click();
  await expect(frame(page).getByRole("heading", { name: "Geobot", exact: true })).toBeVisible();
  await toggle(page).click();
  await expect(page.locator("#geobot-w-box")).toBeHidden();
  await expect(toggle(page)).toBeVisible();
  await expect(toggle(page)).toBeInViewport();
});
