/** US7 · E2E de tableros y tarifas: cuatro tableros con tablas, USD a cuatro decimales y acceso del técnico. */
import { expect, test } from "@playwright/test";
import { crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, sembrarInteraccion, TECNICO } from "./helpers/panel";

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

test("el técnico ve los cuatro tableros con tablas equivalentes y rango validado", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  await sembrarInteraccion(request, { tipo: "respondida", categoria: "Ecosistemas", pregunta: "p", respuesta: "r", valoracion: "No útil", motivo: "Otro" });
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);

  await page.goto("/admin/metrics/usage");
  await expect(page.getByRole("heading", { name: "Uso del servicio", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Consultas por día" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Por categoría (solo conversación)" })).toBeVisible();
  // Rango incompleto → error de campo, no un cero.
  await page.getByLabel("Desde").fill("2026-05-01");
  await page.getByRole("button", { name: "Aplicar rango" }).click();
  await expect(page.getByText("Indique ambas fechas del rango o ninguna.")).toBeVisible();

  await page.goto("/admin/metrics/documents");
  await expect(page.getByRole("heading", { name: "Documentos más citados", level: 1 })).toBeVisible();
  await expect(page.getByText("El modo anónimo no guarda documentos citados")).toBeVisible();

  await page.goto("/admin/metrics/ratings");
  await expect(page.getByRole("table", { name: "Motivos de «No útil»" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Información incorrecta" })).toBeVisible();

  await page.goto("/admin/metrics/consumption");
  await expect(page.getByRole("table", { name: "Consumo por modelo" })).toBeVisible();
  await expect(page.getByText(/costo cero/)).toBeVisible();
});

test("tarifas: guarda USD con cuatro decimales y rechaza cinco decimales, cero y texto con error de campo", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  await request.post("/__test/tariffs");
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/tariffs");
  await expect(page.getByRole("table", { name: "Tarifas vigentes" })).toBeVisible();
  const entrada = page.getByLabel("Precio de entrada de gpt-oss-20b (USD por millón)");
  const guardar = page.getByRole("button", { name: "Guardar tarifa de gpt-oss-20b" });
  for (const malo of ["0", "abc", "0.12345"]) {
    await entrada.fill(malo);
    await guardar.click();
    await expect(page.getByRole("alert").filter({ hasText: /cuatro decimales|mayor que cero/ }).first()).toBeVisible();
  }
  await entrada.fill("0.0825");
  await guardar.click();
  await expect(page.getByRole("status").filter({ hasText: "Tarifa de gpt-oss-20b guardada" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "0.0825", exact: true })).toBeVisible();
});

test("el Gestor no ve tableros ni tarifas: la API responde 403", async ({ page, request }) => {
  const g = await crearCuenta(request, GESTOR);
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  const nav = page.getByRole("navigation", { name: "Panel de administración" });
  for (const nombre of ["Uso", "Documentos citados", "Utilidad", "Consumo y costo", "Tarifas"]) {
    await expect(nav.getByRole("link", { name: nombre, exact: true })).toHaveCount(0);
  }
  await page.goto("/admin/metrics/usage");
  await expect(page.getByText(/Información no disponible/)).toBeVisible();
  const estados = await page.evaluate(async () => Promise.all(["/api/admin/metrics/consumption", "/api/admin/tariffs"].map(async u => (await fetch(u, { credentials: "same-origin" })).status)));
  expect(estados).toEqual([403, 403]);
});
