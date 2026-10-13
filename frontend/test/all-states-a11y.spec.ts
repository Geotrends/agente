/**
 * T074 (RNF-C4-UI-02): axe A/AA en los estados del contrato (contracts/acceptance.md), dentro del
 * iframe y en el host (el escaneo sobre `page` recorre ambos contextos). Estados de valoración:
 * `feedback-a11y.spec.ts`; estados de lectura: `reading-a11y.spec.ts`. La revisión manual (teclado,
 * lectores, zoom 200 %, reflow) consta en `accesibilidad.md` y NO se sustituye por estos reportes.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CHAT_ORIGIN, CONFIG, stubApi } from "./helpers/api";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function axe(page: Page, estado: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.violations.flatMap(v => v.nodes.map(n => `${estado}: ${v.id} ${n.target.join(" > ")} :: ${n.any[0]?.message ?? ""}`))).toEqual([]);
}
const toggle = (page: Page) => page.locator("button.geobot-w-btn");

test("host: botón cerrado y panel abierto", async ({ page, context }) => {
  await stubApi(context);
  await page.goto("/observatorio");
  await axe(page, "botón cerrado");
  await toggle(page).click();
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
  await axe(page, "panel abierto (host+iframe)");
});

test("primera carga y configuración ausente (contactos no cargados)", async ({ page, context }) => {
  await stubApi(context);
  await context.route(`${CHAT_ORIGIN}/api/chat/config`, r => r.fulfill({ status: 503, body: "x" }));
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await expect(f.getByText(/No pudimos cargar los canales de atención/)).toBeVisible();
  await axe(page, "configuración ausente / canales no cargados");
});

test("creando ID, fallo de creación y categorías", async ({ page, context }) => {
  await stubApi(context);
  let n = 0;
  await context.route(`${CHAT_ORIGIN}/api/conversations`, async r => {
    n++;
    if (n === 1) { await new Promise(res => setTimeout(res, 800)); return r.fulfill({ status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE" } } }); }
    return r.fulfill({ status: 201, json: { modo: "conversación", conversationId: "11111111-1111-4111-8111-111111111111" } });
  });
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await axe(page, "creando conversación");
  await expect(f.getByText(/No fue posible iniciar la conversación/)).toBeVisible();
  await axe(page, "fallo al crear la conversación");
  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await expect(f.getByRole("button", { name: "Ecosistemas" })).toBeVisible();
  await axe(page, "categorías y cuatro opciones");
});

test("emergencia con y sin contactos; lista vacía; anónimo", async ({ page, context }) => {
  await stubApi(context);
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "Emergencia o situación en curso" }).click();
  await expect(f.getByRole("heading", { name: "Canales de atención inmediata" })).toBeVisible();
  await axe(page, "emergencia con contactos");
  await f.getByRole("button", { name: "Continuar con la orientación" }).click();
  await f.getByRole("button", { name: "No autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  await axe(page, "lista vacía / anónimo");

  // Sin canales inmediatos registrados.
  const sinCanales = await context.newPage();
  await context.route(`${CHAT_ORIGIN}/api/chat/config`, r => r.fulfill({ json: { ...CONFIG, contactos: { ...CONFIG.contactos, inmediatos: [] } } }));
  await sinCanales.goto("/observatorio");
  await sinCanales.locator("button.geobot-w-btn").click();
  const g = sinCanales.frameLocator("iframe");
  await g.getByRole("button", { name: "Emergencia o situación en curso" }).click();
  await expect(g.getByText(/No pudimos cargar los canales de atención/)).toBeVisible();
  await axe(sinCanales, "emergencia sin contactos");
});

test("esperando, éxito, sin ID y fallos (recuperable, no recuperable, agotado)", async ({ page, context }) => {
  let n = 0;
  await stubApi(context, {
    answer: () => {
      n++;
      if (n === 1) return { delayMs: 900 };
      if (n === 2) return { json: { modo: "anónima", tipo: "respondida", respuesta: "## Resumen\n\n1. Uno\n2. Dos\n\n| A | B |\n|---|---|\n| 1 | 2 |", fuentes: [] } };
      if (n === 3) return { status: 400, json: { error: { codigo: "VALIDACION" } } };
      return { status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE" } } };
    },
  });
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "No autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  const enviar = async (q: string) => { await f.getByLabel("Pregunta").fill(q); await f.getByRole("button", { name: "Enviar" }).click(); };

  await enviar("espera");
  await expect(f.getByRole("status")).toContainText("Geobot está buscando");
  await axe(page, "esperando");
  await expect(f.getByText("Respuesta 1")).toBeVisible();
  await axe(page, "éxito en prosa / respuesta sin ID");

  await enviar("estructurada");
  await expect(f.locator("table")).toBeVisible();
  await axe(page, "éxito con lista y tabla");

  await enviar("validacion");
  await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toBeVisible();
  await expect(f.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
  await axe(page, "fallo no recuperable");

  await enviar("recuperable");
  await expect(f.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await axe(page, "fallo recuperable");
  await f.getByRole("button", { name: "Reintentar" }).click();
  await expect(f.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await f.getByRole("button", { name: "Reintentar" }).click();
  await expect(f.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
  await axe(page, "contador de reintentos agotado");
});

test("diálogo de nueva conversación", async ({ page, context }) => {
  await stubApi(context);
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  await expect(f.getByRole("dialog")).toBeVisible();
  await axe(page, "diálogo de reinicio");
});
