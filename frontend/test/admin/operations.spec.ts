/** US5 · E2E de operación: avisos propios/de sistema, revisión, contadores en el cascarón, pendientes y auditoría. */
import { expect, test } from "@playwright/test";
import { crearAviso, crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, TECNICO, unico } from "./helpers/panel";

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

test("el técnico revisa avisos del sistema; el contador del menú baja y los revisados siguen en la lista", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  const marca = unico("sis").split("@")[0].replace(".", "-");
  await crearAviso(request, { tipo: "verificacion_fallida", objeto: `https://x.gov.co/${marca}-1`, descripcion: `Falla uno ${marca}` });
  await crearAviso(request, { tipo: "verificacion_fallida", objeto: `https://x.gov.co/${marca}-2`, descripcion: `Falla dos ${marca}` });
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/notifications");
  await expect(page.getByRole("row", { name: new RegExp(`Falla uno ${marca}`) })).toBeVisible();
  const enlace = page.getByRole("navigation", { name: "Panel de administración" }).getByRole("link", { name: /^Avisos/ });
  await expect(enlace).toContainText(/\(\d+\)/);
  const antes = Number(/\((\d+)\)/.exec(await enlace.innerText())![1]);
  await page.getByRole("row", { name: new RegExp(`Falla uno ${marca}`) }).getByRole("button").click();
  await expect(page.getByRole("status").filter({ hasText: "marcado como revisado" })).toBeVisible();
  // La fila revisada se conserva en la lista (con su estado) hasta la próxima actualización.
  await expect(page.getByRole("row", { name: new RegExp(`Falla uno ${marca}`) })).toContainText("Revisado");
  await page.getByLabel("Mostrar también los revisados").check();
  await expect(page.getByRole("row", { name: new RegExp(`Falla uno ${marca}`) })).toContainText("Revisado");
  // El contador del menú se actualiza con la actividad (≤30 s): se fuerza con navegación.
  await page.goto("/admin/status");
  await expect(enlace).toContainText(`(${antes - 1})`);
});

test("el Gestor ve únicamente los avisos de carga propios, no los del sistema, y no accede a auditoría ni pendientes", async ({ page, request }) => {
  const g = await crearCuenta(request, GESTOR);
  const marca = unico("car").split("@")[0].replace(".", "-");
  await crearAviso(request, { tipo: "descarte_ocr", objeto: `doc-${marca}`, descripcion: `doc-${marca} no se cargó: OCR bajo`, propietario: g.id });
  await crearAviso(request, { tipo: "verificacion_fallida", objeto: `https://x.gov.co/${marca}`, descripcion: `Falla del sistema ${marca}` });
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/notifications");
  await expect(page.getByRole("row", { name: new RegExp(`doc-${marca}`) })).toBeVisible();
  await expect(page.getByText(`Falla del sistema ${marca}`)).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Panel de administración" });
  await expect(nav.getByRole("link", { name: "Auditoría" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Pendientes", exact: true })).toHaveCount(0);
  await page.goto("/admin/audit");
  await expect(page.getByText("Su perfil no tiene acceso a esta función.")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("el técnico consulta la auditoría con filtros y la bandeja de pendientes", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Auditoría", level: 1 })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("Acción", { exact: true }).selectOption("sesion.inicio");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("cell", { name: "Iniciar sesión", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Crear cuenta", exact: true })).toHaveCount(0);
  // Solo lectura: no hay controles de edición o borrado.
  await expect(page.getByRole("button", { name: /eliminar|borrar|editar/i })).toHaveCount(0);
  await page.goto("/admin/pending");
  await expect(page.getByRole("heading", { name: "Pendientes por validar", level: 1 })).toBeVisible();
});
