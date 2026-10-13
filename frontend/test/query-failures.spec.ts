/** T043 (RF-C4-UI-07/08): espera y fallo en navegador sobre el export real. */
import { expect, test, type Page } from "@playwright/test";
import { CONFIG, stubApi } from "./helpers/api";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");
const FALLO = "En este momento no puedo responder. Puede intentarlo de nuevo o comunicarse por los canales oficiales.";

async function ready(page: Page) {
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "No autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  return f;
}

test("espera: indicador literal ≤500 ms sin mover el foco; campo y envío bloqueados; se rehabilitan", async ({ page, context }) => {
  await stubApi(context, { answer: () => ({ delayMs: 1200 }) });
  const f = await ready(page);
  const campo = f.getByLabel("Pregunta");
  await campo.fill("consulta");
  await f.getByRole("button", { name: "Enviar" }).click();
  const t0 = Date.now();
  await expect(f.getByRole("status")).toContainText("Geobot está buscando en la información institucional…", { timeout: 500 });
  expect(Date.now() - t0).toBeLessThan(900);
  await expect(campo).toBeDisabled();
  await expect(f.getByRole("button", { name: "Enviar" })).toBeDisabled();
  // El foco no se movió al anunciar el estado.
  const activo = await f.locator(":focus").count();
  expect(activo === 0 || (await f.locator(":focus").evaluate(el => el.tagName)) !== "DIV").toBe(true);
  await expect(f.getByText("Respuesta 1")).toBeVisible();
  await expect(campo).toBeEnabled();
  await expect(f.getByRole("status")).toHaveText("");
});

test("seis salidas: mensaje literal, tres canales exactos y valoración ausente", async ({ page, context }) => {
  let n = 0;
  await stubApi(context, {
    answer: () => {
      n++;
      return n <= 6
        ? { status: n % 2 ? 503 : 500, json: { error: { codigo: n % 2 ? "SERVICIO_NO_DISPONIBLE" : "ERROR_INTERNO", mensaje: "interno" } } }
        : {};
    },
  });
  const f = await ready(page);
  const campo = f.getByLabel("Pregunta");
  for (let i = 0; i < 6; i++) {
    await campo.fill(`consulta ${i}`);
    await f.getByRole("button", { name: "Enviar" }).click();
    const fallo = f.getByRole("alert", { name: /No fue posible responder/ });
    await expect(fallo).toContainText(FALLO);
    await expect(fallo).toContainText(CONFIG.contactos.recepcion.pqrsd);
    await expect(fallo).toContainText(CONFIG.contactos.recepcion.whatsapp);
    await expect(fallo).toContainText(CONFIG.contactos.recepcion.email);
    await expect(f.getByRole("button", { name: /Útil/ })).toHaveCount(0);
    await expect(campo).toBeEnabled(); // habilitado para una nueva consulta
  }
});

test("reintentar reenvía el payload original; tras dos fallos desaparece el control; recupera con éxito", async ({ page, context }) => {
  const api = await stubApi(context, {
    answer: n => (n <= 3 ? { status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE" } } } : {}),
  });
  const f = await ready(page);
  await f.getByLabel("Pregunta").fill("misma consulta");
  await f.getByRole("button", { name: "Enviar" }).click();
  const boton = f.getByRole("button", { name: "Reintentar" });
  await expect(boton).toBeVisible();
  await boton.click();
  await expect(boton).toBeVisible();
  await boton.click();
  await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toContainText(FALLO);
  await expect(boton).toHaveCount(0); // dos reintentos fallidos: sin control, con mensaje y canales
  await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toContainText(CONFIG.contactos.recepcion.whatsapp);
  expect(api.chats).toHaveLength(3);
  expect(api.chats[1]).toEqual(api.chats[0]);
  expect(api.chats[2]).toEqual(api.chats[0]);
  // Recuperación: una nueva consulta independiente inicia otro presupuesto y responde.
  await f.getByLabel("Pregunta").fill("nueva");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByText("Respuesta 4")).toBeVisible();
  await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toHaveCount(0);
});
