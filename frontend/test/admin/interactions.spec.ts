/** US6 · E2E de interacciones: filtros, texto depurado, exportación y acceso restringido. */
import { expect, test } from "@playwright/test";
import { crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, sembrarInteraccion, TECNICO, unico } from "./helpers/panel";

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

test("el técnico filtra interacciones, ve el texto depurado como tal y exporta el filtro", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  const m = unico("q").split("@")[0].replace(".", "-");
  await sembrarInteraccion(request, { tipo: "respondida", categoria: "Ecosistemas", pregunta: `Pregunta ${m} vigente`, respuesta: "Respuesta vigente" });
  await sembrarInteraccion(request, { tipo: "sin información", categoria: "Bienestar Animal", pregunta: `Pregunta ${m} sin info`, respuesta: "No encontré información", valoracion: "No útil", motivo: "Información incorrecta" });
  await sembrarInteraccion(request, { tipo: "respondida", categoria: "Gestión Ambiental", pregunta: "x", respuesta: "y", hace: "13 months", purgada: true });
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/interactions");
  await expect(page.getByRole("heading", { name: "Interacciones", level: 1 })).toBeVisible();
  // Rango amplio: por defecto solo se muestran los últimos 30 días (el dato depurado tiene 13 meses).
  await page.getByLabel("Desde").fill("2020-01-01");
  await page.getByLabel("Hasta").fill("2030-01-01");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("cell", { name: `Pregunta ${m} vigente` })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Texto depurado por retención" }).first()).toBeVisible();
  // Nueve columnas.
  await expect(page.getByRole("columnheader")).toHaveCount(9);

  await page.getByLabel("Categoría").selectOption("Bienestar Animal");
  await page.getByLabel("Desde").fill("2020-01-01");
  await page.getByLabel("Hasta").fill("2030-01-01");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("cell", { name: `Pregunta ${m} sin info` })).toBeVisible();
  await expect(page.getByRole("cell", { name: `Pregunta ${m} vigente` })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Información incorrecta" })).toBeVisible();

  // Exportación del mismo filtro: descarga un .xlsx.
  const descarga = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar a Excel (.xlsx)" }).click();
  const d = await descarga;
  expect(d.suggestedFilename()).toBe("interacciones.xlsx");
  await expect(page.getByRole("status").filter({ hasText: "Exportación lista" })).toBeVisible();
  // Sin controles de edición o borrado.
  await expect(page.getByRole("button", { name: /eliminar|borrar|editar/i })).toHaveCount(0);
});

test("el Gestor no ve la sección de interacciones y el servicio la rechaza", async ({ page, request }) => {
  const g = await crearCuenta(request, GESTOR);
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await expect(page.getByRole("navigation", { name: "Panel de administración" }).getByRole("link", { name: "Interacciones" })).toHaveCount(0);
  await page.goto("/admin/interactions");
  await expect(page.getByText("Su perfil no tiene acceso a esta función.")).toBeVisible();
  const estado = await page.evaluate(async () => (await fetch("/api/admin/interactions/export", { credentials: "same-origin" })).status);
  expect(estado).toBe(403);
});
