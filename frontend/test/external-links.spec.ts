/** T033 (RF-C4-UI-04): enlaces de respuesta, política y canales abren pestaña nueva sin tocar mapa ni conversación. */
import { expect, test, type Page } from "@playwright/test";
import { stubApi } from "./helpers/api";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");

const FUENTES = Array.from({ length: 10 }, (_, i) => ({
  id: `d${i}`, nombre: `Documento ${i + 1}`, enlace: `https://envigado.gov.co/doc-${i + 1}`, fecha: "2026-03-15",
}));

async function open(page: Page, context: Parameters<typeof stubApi>[0], withSources = true) {
  await stubApi(context, {
    answer: n => ({
      json: {
        modo: "conversación", conversationId: "11111111-1111-4111-8111-111111111111", responseId: `r${n}`, tipo: "respondida",
        respuesta: "Consulte la [norma aplicable](https://envigado.gov.co/norma) y los pasos.",
        fuentes: withSources ? FUENTES : [],
      },
    }),
  });
  await context.route("https://**", r => r.fulfill({ contentType: "text/html", body: "<title>externo</title>" }));
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  await f.getByLabel("Pregunta").fill("¿qué norma aplica?");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByText("Consulte la")).toBeVisible();
  return f;
}

test("diez citas + enlace de la respuesta + política: todos target/rel exactos y nombre con aviso", async ({ page, context }) => {
  const f = await open(page, context);
  await f.locator("details.sources summary").click();
  const links = f.locator(".chat-panel a");
  const n = await links.count();
  expect(n).toBe(11); // enlace de la respuesta + 10 citas (la política ya no está visible tras decidir)
  for (let i = 0; i < n; i++) {
    const a = links.nth(i);
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", "noopener noreferrer");
    await expect(a).toHaveAttribute("href", /^https:\/\//);
    await expect(a).toHaveAttribute("aria-label", /\(se abre en una pestaña nueva\)$/);
    expect(((await a.textContent()) ?? "").includes("↗") || (await a.locator(".external-indicator").count()) > 0).toBe(true);
  }
});

test("ratón: abre pestaña nueva y conserva conversación y mapa", async ({ page, context }) => {
  const f = await open(page, context);
  const camara = await page.locator("#mapa").getAttribute("data-camera");
  const [popup] = await Promise.all([context.waitForEvent("page"), f.getByRole("link", { name: /norma aplicable/ }).click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://envigado.gov.co/norma");
  await page.bringToFront();
  await expect(f.getByRole("log")).toContainText("¿qué norma aplica?");
  expect(await page.locator("#mapa").getAttribute("data-camera")).toBe(camara);
  expect(page.url()).toContain("/observatorio");
});

test("teclado: Enter sobre el enlace abre pestaña nueva", async ({ page, context }) => {
  const f = await open(page, context);
  const link = f.getByRole("link", { name: /norma aplicable/ });
  await link.focus();
  const [popup] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("Enter")]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://envigado.gov.co/norma");
  await page.bringToFront();
  await expect(f.getByRole("log")).toContainText("¿qué norma aplica?");
});

test("tabla ancha a 320 px: el contenedor desplaza, el panel no", async ({ page, context }) => {
  await stubApi(context, {
    answer: () => ({
      json: {
        modo: "anónima", tipo: "respondida", fuentes: [],
        respuesta: "| Código | Nombre largo del documento institucional | Versión | Vigencia | Responsable | Observaciones adicionales |\n|---|---|---|---|---|---|\n| GT-P-01 | Procedimiento de aprovechamiento forestal | 3 | 2026-03-15 | Dirección de Ecosistemas | Documento vigente |",
      },
    }),
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "No autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  await f.getByLabel("Pregunta").fill("tabla");
  await f.getByRole("button", { name: "Enviar" }).click();
  const wrap = f.locator(".table-scroll");
  await expect(wrap).toBeVisible();
  const m = await wrap.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(m.sw).toBeGreaterThan(m.cw);
  const panelOverflow = await f.locator(".chat-panel").evaluate(el => el.scrollWidth > el.clientWidth);
  expect(panelOverflow).toBe(false);
  await expect(f.locator("th[scope=col]").first()).toBeVisible();
});

test("política (apertura) y canales (emergencia): mismos atributos y aviso", async ({ page, context }) => {
  await stubApi(context);
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  const politica = f.getByRole("link", { name: /política de tratamiento de datos/ });
  await expect(politica).toHaveAttribute("target", "_blank");
  await expect(politica).toHaveAttribute("rel", "noopener noreferrer");
  await expect(politica).toHaveAttribute("aria-label", /\(se abre en una pestaña nueva\)$/);
  await f.getByRole("button", { name: "Emergencia o situación en curso" }).click();
  await expect(f.getByRole("heading", { name: "Canales de atención inmediata" })).toBeVisible();
  // Teléfonos como texto (no enlaces tel:); ningún enlace no https.
  const hrefs = await f.locator(".chat-panel a").evaluateAll(as => as.map(a => a.getAttribute("href")));
  for (const h of hrefs) expect(h).toMatch(/^https:\/\//);
});
