/** T059: carreras de respuesta/configuración/abort/diálogo, axe del diálogo y storage vacío. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { alternar, CHAT_ORIGIN, CONFIG, stubApi } from "./helpers/api";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");

async function ready(page: Page, mode: "Autorizo" | "No autorizo" = "No autorizo") {
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: mode, exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  return f;
}

test("respuesta que llega con el diálogo abierto se conserva al cancelar", async ({ page, context }) => {
  await stubApi(context, { answer: () => ({ delayMs: 1500 }) });
  const f = await ready(page);
  await f.getByLabel("Pregunta").fill("pendiente");
  await f.getByRole("button", { name: "Enviar" }).click();
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  await page.waitForTimeout(1800); // la respuesta llega con el diálogo abierto
  await f.getByRole("button", { name: "Cancelar" }).click();
  await expect(f.getByText("Respuesta 1")).toBeVisible();
});

test("respuesta tardía tras confirmar no aparece en la conversación nueva", async ({ page, context }) => {
  const api = await stubApi(context, { answer: () => ({ delayMs: 1500 }) });
  const f = await ready(page);
  await f.getByLabel("Pregunta").fill("vieja");
  await f.getByRole("button", { name: "Enviar" }).click();
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  await f.getByRole("button", { name: "Iniciar nueva" }).click();
  await page.waitForTimeout(1900);
  await expect(f.getByText("Respuesta 1")).toHaveCount(0);
  await expect(f.getByRole("log")).not.toContainText("vieja");
  expect(api.chats).toHaveLength(1);
});

test("reiniciar mientras la configuración está en vuelo: la respuesta vieja no repuebla la sesión", async ({ page, context }) => {
  await stubApi(context);
  let n = 0;
  // La segunda lectura de configuración (tras reiniciar) demora; llega con la versión nueva de la política.
  await context.route(`${CHAT_ORIGIN}/api/chat/config`, async r => {
    n++;
    if (n === 2) await new Promise(res => setTimeout(res, 800));
    await r.fulfill({ json: { ...CONFIG, politica: { ...CONFIG.politica, version: n === 1 ? "2026-10" : "2026-11" } } });
  });
  const f = await ready(page);
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  await f.getByRole("button", { name: "Iniciar nueva" }).click();
  await expect(f.getByRole("button", { name: "No autorizo", exact: true })).toBeDisabled();
  await expect(f.getByRole("button", { name: "No autorizo", exact: true })).toBeEnabled({ timeout: 3000 });
});

test("ocultar y mostrar no reinicia: la conversación sigue y no hay diálogo", async ({ page, context }) => {
  await stubApi(context);
  const f = await ready(page);
  await f.getByLabel("Pregunta").fill("a");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByText("Respuesta 1")).toBeVisible();
  await alternar(page);
  await alternar(page);
  await expect(f.getByRole("dialog")).toHaveCount(0);
  await expect(f.getByRole("log")).toContainText("Respuesta 1");
});

test("axe del diálogo y storage/URL sin textos ni IDs tras reiniciar", async ({ page, context }) => {
  await stubApi(context);
  const f = await ready(page, "Autorizo");
  await f.getByLabel("Pregunta").fill("texto privado del ciudadano");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByText("Respuesta 1")).toBeVisible();
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" > ")}`))).toEqual([]);
  await f.getByRole("button", { name: "Iniciar nueva" }).click();
  const dump = await f.locator("body").evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, u: location.href }));
  for (const secreto of ["texto privado", "11111111-1111", "tok-tecnico"]) expect(dump).not.toContain(secreto);
});
