/** T050: errores, plazo de 45 s, contactos y ocultar con consulta pendiente, sobre el export real. */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_ORIGIN, CONFIG, stubApi } from "./helpers/api";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");
const FALLO = "En este momento no puedo responder. Puede intentarlo de nuevo o comunicarse por los canales oficiales.";

async function ready(page: Page, anonymous = true) {
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: anonymous ? "No autorizo" : "Autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  return f;
}

test("IN-04: seis respuestas de error sin datos técnicos; solo VALIDACION sin Reintentar", async ({ page, context }) => {
  const causas = [
    { status: 400, json: { error: { codigo: "VALIDACION", mensaje: "campo", campo: "pregunta" } }, retry: false },
    { status: 400, json: { error: { codigo: "VALIDACION", mensaje: "otro", campo: "historial" } }, retry: false },
    { status: 500, json: { error: { codigo: "ERROR_INTERNO", mensaje: "gpt-oss-20b caído" } }, retry: true },
    { status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE", mensaje: "SELECT 1" } }, retry: true },
    { status: 502, raw: { contentType: "text/html", body: "<html><h1>502 Bad Gateway</h1></html>" }, retry: true },
    { status: 200, json: { modo: "conversación", tipo: "respondida" }, retry: true },
  ];
  let i = -1;
  await stubApi(context, { answer: () => ({ ...causas[Math.min(++i, 5)] }) });
  const f = await ready(page);
  for (let k = 0; k < causas.length; k++) {
    await f.getByLabel("Pregunta").fill(`consulta ${k}`);
    await f.getByRole("button", { name: "Enviar" }).click();
    const fallo = f.getByRole("alert", { name: /No fue posible responder/ });
    await expect(fallo).toContainText(FALLO);
    const texto = (await fallo.textContent()) ?? "";
    for (const t of ["gpt-oss", "SELECT", "VALIDACION", "ERROR_INTERNO", "Bad Gateway", "campo", "historial"]) expect(texto).not.toContain(t);
    await expect(f.getByRole("button", { name: "Reintentar" })).toHaveCount(causas[k].retry ? 1 : 0);
  }
});

test("IN-03: a los 40 s se muestra; a los 50 s el fallo aparece entre 45 y 46 s y la tardía no entra", async ({ page, context }) => {
  await page.clock.install();
  await stubApi(context, { answer: () => ({ hang: true }) });
  const f = await ready(page);
  await f.getByLabel("Pregunta").fill("lenta");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByRole("status")).toContainText("Geobot está buscando");
  await page.clock.fastForward(44_900);
  await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toHaveCount(0);
  await page.clock.fastForward(1_100);
  await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toContainText(FALLO);
  await page.clock.fastForward(10_000);
  await expect(f.getByText(/Respuesta \d/)).toHaveCount(0);
});

test("ocultar con consulta pendiente conserva el intento y la respuesta aparece una sola vez", async ({ page, context }) => {
  const api = await stubApi(context, { answer: () => ({ delayMs: 1500 }) });
  const f = await ready(page);
  await f.getByLabel("Pregunta").fill("pendiente");
  await f.getByRole("button", { name: "Enviar" }).click();
  await toggle(page).click();
  await page.waitForTimeout(1800);
  await toggle(page).click();
  await expect(f.getByText("Respuesta 1")).toHaveCount(1);
  expect(api.chats).toHaveLength(1);
});

test("IN-06: sin contactos al abrir se repite al elegir emergencia; con snapshot el fallo no pide de nuevo", async ({ page, context }) => {
  let configCalls = 0;
  // Playwright aplica primero la ruta registrada al final: el comodín va antes que la de configuración.
  await context.route(`${CHAT_ORIGIN}/api/**`, r => r.fulfill({ status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE" } } }));
  await context.route(`${CHAT_ORIGIN}/api/chat/config`, r => (++configCalls === 1 ? r.fulfill({ status: 503, body: "x" }) : r.fulfill({ json: CONFIG })));
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await expect(f.getByText("No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado.")).toBeVisible();
  await f.getByRole("button", { name: "Intentar de nuevo" }).click();
  await expect(f.getByRole("button", { name: "Emergencia o situación en curso" })).toBeVisible();
  await f.getByRole("button", { name: "Emergencia o situación en curso" }).click();
  await expect(f.getByRole("region", { name: "Canales de atención inmediata" })).toContainText("123");
  expect(configCalls).toBe(2);
});

// ── SPEC005 · C403 / C406 (T043) ─────────────────────────────────────────────────────────────

test("C403 · reinicio con consulta en vuelo: el resultado tardío no llega a la conversación nueva y el reloj no se hereda", async ({ page, context }) => {
  await page.clock.install();
  const api = await stubApi(context, { answer: n => (n === 1 ? { delayMs: 8_000 } : {}) });
  const f = await ready(page);
  await f.getByLabel("Pregunta").fill("consulta que se va a reiniciar");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByRole("status")).toContainText("Geobot está buscando");
  await page.clock.fastForward(1_000);
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  await f.getByRole("button", { name: "Iniciar nueva" }).click();
  await page.clock.fastForward(10_000);
  // La respuesta tardía de la conversación anterior jamás aparece; la sesión nueva está limpia.
  await expect(f.getByText("Respuesta 1")).toHaveCount(0);
  await expect(f.getByText("consulta que se va a reiniciar")).toHaveCount(0);
  await expect(f.getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
  // Una consulta nueva tiene su propio plazo de 45 s y se responde normalmente.
  await f.getByRole("button", { name: "No autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  await f.getByLabel("Pregunta").fill("consulta nueva");
  await f.getByRole("button", { name: "Enviar" }).click();
  await page.clock.fastForward(100);
  await expect(f.getByText("Respuesta 2")).toBeVisible();
  expect(api.chats).toHaveLength(2);
});

test("C406 · cuatro fallos de contactos con su recuperación: reintento manual, emergencia, nueva conversación y fallo de consulta", async ({ page, context }) => {
  const modo = { falla: true };
  const llamadas = { config: 0 };
  await stubApi(context);
  // La ruta de página tiene prioridad sobre la de `stubApi`.
  await page.route(`${CHAT_ORIGIN}/api/chat/config`, r => {
    llamadas.config++;
    return modo.falla ? r.fulfill({ status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE", mensaje: "x" }, canales: [] } }) : r.fulfill({ json: CONFIG });
  });
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  const FIJO = "No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado.";

  // 1 · apertura sin contactos: texto fijo, sin teléfonos de reserva; recupera con «Intentar de nuevo» (≤ 5 s).
  await expect(f.getByText(FIJO)).toBeVisible({ timeout: 5_000 });
  expect(await f.locator("body").innerText()).not.toMatch(/\+57|123|@/);
  modo.falla = false;
  await f.getByRole("button", { name: "Intentar de nuevo" }).click();
  await expect(f.getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
  const trasPrimera = llamadas.config;

  // 2 · un fallo de consulta CON snapshot no pide los contactos otra vez (ya están).
  await f.getByRole("button", { name: "No autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  await page.route(`${CHAT_ORIGIN}/api/chat`, r => r.fulfill({ status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE", mensaje: "x" }, canales: [] } }));
  await f.getByLabel("Pregunta").fill("falla con contactos");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toContainText("WhatsApp");
  expect(llamadas.config).toBe(trasPrimera);

  // 3 · nueva conversación con los contactos caídos: se conserva el snapshot íntegro ya validado.
  modo.falla = true;
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  await f.getByRole("button", { name: "Iniciar nueva" }).click();
  await expect(f.getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
  await expect(f.getByText(FIJO)).toHaveCount(0);

  // 4 · recarga del iframe con los contactos caídos: vuelve el texto fijo; al recuperarse, la
  // emergencia muestra los canales inmediatos del snapshot, sin modelo.
  await page.reload();
  await toggle(page).click();
  const g = page.frameLocator("iframe");
  await expect(g.getByText(FIJO)).toBeVisible({ timeout: 5_000 });
  modo.falla = false;
  await g.getByRole("button", { name: "Intentar de nuevo" }).click();
  await g.getByRole("button", { name: "Emergencia o situación en curso" }).click();
  await expect(g.getByRole("region", { name: "Canales de atención inmediata" })).toContainText("123");
});
