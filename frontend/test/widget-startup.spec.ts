/** T029: launcher → puente → flujo único → cliente español; consulta en curso sigue al ocultar. */
import { expect, test, type Page } from "@playwright/test";
import { alternar, stubApi } from "./helpers/api";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");

test("flujo completo desde el launcher: apertura, Autorizo, categoría y dos consultas con el contrato español", async ({ page, context }) => {
  const api = await stubApi(context);
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await expect(f.getByText("Soy Geobot, asistente automatizado del Observatorio.")).toBeVisible();
  expect(api.sessions).toBe(0);
  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await f.getByRole("button", { name: "Bienestar Animal" }).click();
  for (let i = 1; i <= 2; i++) {
    await f.getByLabel("Pregunta").fill(`pregunta ${i}`);
    await f.getByRole("button", { name: "Enviar" }).click();
    await expect(f.getByText(`Respuesta ${i}`)).toBeVisible();
  }
  expect(api.sessions).toBe(1);
  expect(api.conversations).toBe(1);
  expect(Object.keys(api.chats[0]).sort()).toEqual(["categoria", "conversationId", "pregunta"]);
  expect(api.chats[1]).toMatchObject({ historial: [{ pregunta: "pregunta 1", respuesta: "Respuesta 1" }] });
  for (const c of api.chats) for (const k of ["provider", "model", "message", "history"]) expect(c).not.toHaveProperty(k);
});

test("ocultar con una consulta pendiente no la cancela; al mostrar aparece la respuesta única", async ({ page, context }) => {
  const api = await stubApi(context, { answer: () => ({ delayMs: 1500 }) });
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "No autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  await f.getByLabel("Pregunta").fill("pendiente");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByRole("status")).toContainText("Geobot está buscando en la información institucional…");
  await alternar(page); // ocultar durante la espera
  await page.waitForTimeout(1800);
  await alternar(page); // mostrar
  await expect(f.getByText("Respuesta 1")).toBeVisible();
  expect(api.chats).toHaveLength(1);
  expect(api.sessions).toBe(1);
});
