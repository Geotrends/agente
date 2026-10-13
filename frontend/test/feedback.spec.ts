/** T063: valoración en navegador — diez valoradas (5 útiles, 5 no útiles por motivo), tres anónimas, teclado. */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { stubApi } from "./helpers/api";
import { MOTIVOS } from "../shared/feedbackContracts";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");

async function ready(page: Page, mode: "Autorizo" | "No autorizo") {
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: mode, exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  return f;
}
async function ask(f: FrameLocator, q: string, n: number) {
  await f.getByLabel("Pregunta").fill(q);
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByText(`Respuesta ${n}`)).toBeVisible();
}

test("diez respuestas autorizadas: 5 «Útil» y 5 «No útil», una por motivo; «Gracias» tras cada 201", async ({ page, context }) => {
  const api = await stubApi(context);
  const f = await ready(page, "Autorizo");
  for (let i = 1; i <= 10; i++) await ask(f, `consulta ${i}`, i);
  const grupos = f.getByRole("group", { name: "Valorar esta respuesta" });
  await expect(grupos).toHaveCount(10);
  // Se valora de la primera a la décima; tras confirmar, el grupo se reemplaza por «Gracias».
  for (let i = 0; i < 10; i++) {
    const g = f.getByRole("group", { name: "Valorar esta respuesta" }).first();
    if (i < 5) {
      await g.getByRole("button", { name: "Útil", exact: true }).click();
    } else {
      await g.getByRole("button", { name: "No útil" }).click();
      await g.getByRole("radio", { name: MOTIVOS[i - 5] }).check();
      await g.getByRole("button", { name: "Enviar valoración" }).click();
    }
    await expect(f.getByText("Gracias por su valoración")).toHaveCount(i + 1);
  }
  expect(api.ratings).toHaveLength(10);
  expect(api.ratings.filter(r => r.valoracion === "Útil").every(r => !("motivo" in r))).toBe(true);
  expect(api.ratings.slice(5).map(r => r.motivo)).toEqual([...MOTIVOS]);
  expect(new Set(api.ratings.map(r => r.responseId)).size).toBe(10);
  await expect(f.getByRole("group", { name: "Valorar esta respuesta" })).toHaveCount(0);
});

test("tres respuestas anónimas: sin controles ni elementos ocultos enfocables y cero solicitudes", async ({ page, context }) => {
  const api = await stubApi(context);
  const f = await ready(page, "No autorizo");
  for (let i = 1; i <= 3; i++) await ask(f, `anónima ${i}`, i);
  await expect(f.getByRole("button", { name: /Útil/ })).toHaveCount(0);
  const focusables = await f.locator(".messages").locator("button, input, [tabindex]:not([tabindex='-1'])").count();
  expect(focusables).toBe(0);
  expect(api.ratings).toHaveLength(0);
});

test("teclado: Tab llega a los controles; Espacio/Enter operan; radio con flechas", async ({ page, context }) => {
  const api = await stubApi(context);
  const f = await ready(page, "Autorizo");
  await ask(f, "consulta", 1);
  await f.getByRole("button", { name: "No útil" }).focus();
  await page.keyboard.press("Enter");
  const primero = f.getByRole("radio", { name: MOTIVOS[0] });
  await primero.focus();
  await page.keyboard.press("ArrowDown");
  await expect(f.getByRole("radio", { name: MOTIVOS[1] })).toBeChecked();
  await f.getByRole("button", { name: "Enviar valoración" }).focus();
  await page.keyboard.press("Space");
  await expect(f.getByText("Gracias por su valoración")).toBeVisible();
  expect(api.ratings[0]).toMatchObject({ valoracion: "No útil", motivo: MOTIVOS[1] });
});

test("pérdida de acuse: sin «Gracias», respuesta intacta, reintento solo de la misma selección", async ({ page, context }) => {
  const api = await stubApi(context, { rating: n => (n === 1 ? { status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE" } } } : { status: 201 }) });
  const f = await ready(page, "Autorizo");
  await ask(f, "consulta", 1);
  await f.getByRole("button", { name: "Útil", exact: true }).click();
  await expect(f.getByText(/No se pudo registrar su valoración/)).toBeVisible();
  await expect(f.getByText("Gracias por su valoración")).toHaveCount(0);
  await expect(f.getByRole("log")).toContainText("Respuesta 1");
  await expect(f.getByRole("button", { name: "No útil" })).toBeDisabled();
  await f.getByRole("button", { name: "Reintentar valoración" }).click();
  await expect(f.getByText("Gracias por su valoración")).toBeVisible();
  expect(api.ratings).toHaveLength(2);
  expect(api.chats).toHaveLength(1);
});

test("nueva conversación con valoración pendiente: el resultado tardío no aparece en la sesión nueva", async ({ page, context }) => {
  await stubApi(context, { rating: () => ({ status: 201, delayMs: 1200 }) });
  const f = await ready(page, "Autorizo");
  await ask(f, "consulta", 1);
  await f.getByRole("button", { name: "Útil", exact: true }).click();
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  await f.getByRole("button", { name: "Iniciar nueva" }).click();
  await page.waitForTimeout(1600);
  await expect(f.getByText("Gracias por su valoración")).toHaveCount(0);
  await expect(f.getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
});

// ── SPEC005 · C405 / C309 (T024) ─────────────────────────────────────────────────────────────

test("C405: seis respuestas (2 con ID, 2 autorizadas sin ID, 2 anónimas): solo 2 con controles y ninguno oculto enfocable", async ({ page, context }) => {
  // Autorizado: las respuestas 3 y 4 salen sin responseId (el registro no se confirmó).
  const api = await stubApi(context, {
    answer: n => (n === 3 || n === 4
      ? { json: { modo: "conversación", conversationId: "11111111-1111-4111-8111-111111111111", tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] } }
      : {}),
  });
  let f = await ready(page, "Autorizo");
  for (let i = 1; i <= 4; i++) await ask(f, `autorizada ${i}`, i);
  await expect(f.getByRole("group", { name: "Valorar esta respuesta" })).toHaveCount(2);
  // Las dos sin ID no dejan botones, radios ni elementos enfocables ocultos.
  for (const n of [3, 4]) {
    const articulo = f.locator("article.message.assistant", { hasText: `Respuesta ${n}` });
    expect(await articulo.locator("button, input, [tabindex]:not([tabindex='-1'])").count()).toBe(0);
  }
  expect(api.ratings).toHaveLength(0);

  // Dos anónimas en una conversación nueva: cero controles.
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  await f.getByRole("button", { name: "Iniciar nueva" }).click();
  await f.getByRole("button", { name: "No autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  for (let i = 5; i <= 6; i++) await ask(f, `anónima ${i}`, i);
  await expect(f.getByRole("group", { name: "Valorar esta respuesta" })).toHaveCount(0);
  expect(await f.locator(".messages").locator("button, input, [tabindex]:not([tabindex='-1'])").count()).toBe(0);
  f = page.frameLocator("iframe");
  expect(api.ratings).toHaveLength(0);
});

test("C309: confirmación perdida (red) y luego rechazo por duplicado: sin «Gracias» falso y sin solicitudes automáticas", async ({ page, context }) => {
  await stubApi(context);
  const log: Array<unknown> = [];
  // La ruta de página tiene prioridad sobre la de contexto de `stubApi`.
  await page.route("**/api/ratings", r => { log.push(r.request().postDataJSON()); return r.abort("connectionreset"); });
  const f = await ready(page, "Autorizo");
  await ask(f, "consulta", 1);
  await f.getByRole("button", { name: "Útil", exact: true }).click();
  await expect(f.getByText(/No se pudo registrar su valoración/)).toBeVisible();
  await page.waitForTimeout(800);
  expect(log.length).toBeLessThanOrEqual(1);
  await expect(f.getByText("Gracias por su valoración")).toHaveCount(0);
  // El servidor ya la había guardado: el reintento manual recibe 400 uniforme y tampoco es éxito.
  await page.route("**/api/ratings", r => r.fulfill({ status: 400, json: { error: { codigo: "VALIDACION", mensaje: "No se pudo registrar la valoración." }, canales: [] } }));
  await f.getByRole("button", { name: "Reintentar valoración" }).click();
  await expect(f.getByText("Gracias por su valoración")).toHaveCount(0);
  await expect(f.getByRole("log")).toContainText("Respuesta 1");
});
