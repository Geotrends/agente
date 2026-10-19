import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { account, apiFixture, docs, notice } from "./fixtures";
const routes = ["login", "documents", "proposals", "pending", "links", "contacts", "notifications", "status", "audit", "interactions", "improvements", "metrics/usage", "metrics/documents", "metrics/ratings", "metrics/consumption", "tariffs", "accounts", "password"];
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: apiFixture(new URL(route.request().url())) }));
});
for (const route of routes) test(`${route}: teclado, título y WCAG 2.2`, async ({ page }) => {
  await page.goto(`/admin/${route}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (!["login", "contacts", "password"].includes(route)) await expect(page.locator("table").first()).toBeVisible();
  await expect(page).toHaveTitle(/ · Panel Geobot$/);
  await audit(page);
  for (const width of [320, 390, 800, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
test("el salto se ve con foco; la tabla de estado responde al teclado", async ({ page }) => {
  await page.goto("/admin/status"); await expect(page.locator("table")).toBeVisible();
  await page.getByRole("link", { name: "Saltar al contenido" }).focus();
  expect(await page.getByRole("link", { name: "Saltar al contenido" }).evaluate(e => e.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Enter"); await expect(page.locator("#contenido-admin")).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".admin-columnas-movil summary").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".admin-columnas-movil").first().getByText("Último éxito", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 900 });
  const region = page.getByRole("region", { name: "Estado observado de cada componente" });
  await region.focus(); await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
});
test("avisos conserva páginas y foco durante el sondeo", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/admin/notifications?**", route => {
    const cursor = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({ json: { items: cursor ? [{ ...notice, id: "3" }, { ...notice, id: "4" }] : [notice, { ...notice, id: "2" }], total: 4, noRevisadas: 4, nextCursor: cursor ? null : "next" } });
  });
  await page.goto("/admin/notifications"); await page.getByRole("button", { name: "Cargar más avisos" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  const button = page.locator("tbody tr").last().getByRole("button"); await button.focus();
  await page.clock.runFor(30_100);
  await expect(page.locator("tbody tr")).toHaveCount(4); await expect(button).toBeFocused();
});
test("documentos pagina en servidor, precarga campos y permite borrar fechas", async ({ page }) => {
  let changes: unknown;
  await page.route("**/api/admin/documents/*/metadata", async route => {
    changes = route.request().postDataJSON().changes;
    return route.fulfill({ json: { revision: "2" } });
  });
  await page.goto("/admin/documents"); await expect(page.locator("tbody tr")).toHaveCount(15);
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mostrando 16–30" })).toBeVisible();
  await page.getByRole("button", { name: `Editar ${docs[15].nombre}`, exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.getByLabel("Título", { exact: true })).toHaveValue(docs[15].nombre);
  await dialog.getByLabel("Válido hasta", { exact: true }).fill(""); await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect.poll(() => changes).toEqual({ validUntil: "" });
});
test("diálogo seguro, texto completo y errores recuperables", async ({ page }) => {
  await page.goto("/admin/accounts"); await page.getByRole("button", { name: `Desactivar ${account.email}`, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading")).toBeFocused(); await audit(page);
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: `Desactivar ${account.email}`, exact: true })).toBeFocused();
  await page.goto("/admin/interactions"); await page.getByRole("button", { name: /^Ver interacción completa:/ }).click();
  await expect(page.getByRole("dialog").getByText(/Para solicitar el permiso/)).toBeVisible(); await audit(page);
  await page.route("**/api/admin/contacts", route => route.fulfill({ status: 503, json: { error: { codigo: "CAIDA", mensaje: "Falla" } } }));
  await page.goto("/admin/contacts"); await expect(page.locator("main").getByRole("alert")).toContainText("no está disponible"); await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
});

test("alto contraste y espaciado ampliado mantienen las tablas operables", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 900 });
  for (const route of ["documents", "accounts", "interactions", "status"]) {
    await page.goto(`/admin/${route}`); await expect(page.locator("table").first()).toBeVisible();
    await page.addStyleTag({ content: ".admin-main * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } .admin-main p { margin-bottom: 2em !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await audit(page);
    await page.getByRole("button", { name: /^Menú/ }).click();
    await expect(page.getByRole("navigation", { name: "Panel de administración" })).toBeVisible();
  }
});
