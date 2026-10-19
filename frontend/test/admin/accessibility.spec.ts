/**
 * RNF-C3-AD-09 · Accesibilidad automatizada del panel: axe-core con etiquetas WCAG 2.x A y AA sobre
 * las 18 pantallas y sus estados (carga, error/403, diálogo abierto). La automatización NO sustituye
 * la revisión manual con teclado y lector de pantalla (T094), que sigue pendiente.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { crearAviso, crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, sembrarInteraccion, TECNICO, unico } from "./helpers/panel";

const RUTAS = [
  "/admin/documents", "/admin/proposals", "/admin/pending", "/admin/links", "/admin/contacts", "/admin/notifications",
  "/admin/status", "/admin/audit", "/admin/interactions", "/admin/improvements", "/admin/metrics/usage",
  "/admin/metrics/documents", "/admin/metrics/ratings", "/admin/metrics/consumption", "/admin/tariffs", "/admin/accounts",
  "/admin/password",
] as const;

async function auditar(page: Page, etiqueta: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const resumen = r.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.map(n => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  expect(resumen, `${etiqueta}: incumplimientos A/AA`).toEqual([]);
}

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

test("@a11y inicio de sesión: estado inicial y de error", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Panel de Geobot" })).toBeVisible();
  await auditar(page, "login");
  await page.getByLabel("Correo electrónico").fill("nadie@prueba.gov.co");
  await page.getByLabel("Contraseña").fill("incorrecta-123456");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
  await auditar(page, "login con error");
});

test("@a11y las 17 pantallas autenticadas del técnico cumplen A/AA", async ({ page, request }) => {
  test.setTimeout(240_000);
  const t = await crearCuenta(request, TECNICO);
  await request.post("/__test/tariffs");
  const m = unico("a").split("@")[0].replace(".", "-");
  await crearAviso(request, { tipo: "verificacion_fallida", objeto: `https://x.gov.co/${m}`, descripcion: `Falla ${m}` });
  await sembrarInteraccion(request, { tipo: "sin información", categoria: "Ecosistemas", pregunta: `Pregunta ${m}`, respuesta: "r", valoracion: "No útil", motivo: "Otro" });
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  for (const ruta of RUTAS) {
    await page.goto(ruta);
    await expect(page.getByRole("main").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await auditar(page, ruta);
  }
});

test("@a11y diálogos y estados de error: confirmaciones, 403 del Gestor y errores por campo", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  // Diálogo de confirmación de cuentas.
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: `Desactivar ${t.email}` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await auditar(page, "cuentas con diálogo");
  await page.getByRole("button", { name: "Cancelar" }).click();
  // Errores por campo en el formulario de carga.
  await page.goto("/admin/documents");
  await page.getByRole("tab", { name: "Cargar un documento" }).click();
  await page.getByRole("button", { name: "Cargar documento" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await auditar(page, "documentos con error de campo");
  // Estado 403 del Gestor.
  const g = await crearCuenta(request, GESTOR);
  await page.goto("/admin/login");
  await page.evaluate(() => fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" }));
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/accounts");
  await expect(page.getByText("Su perfil no tiene acceso a esta función.")).toBeVisible();
  await auditar(page, "403 del Gestor");
});
