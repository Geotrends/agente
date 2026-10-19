import { expect, test } from "@playwright/test";
import { apiFixture, notice } from "./fixtures";

test("revisar todos confirma, marca también los no cargados y actualiza los contadores", async ({ page }) => {
  let revisados = false;
  let solicitudes = 0;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/admin/notifications/review-all") {
      solicitudes++;
      revisados = true;
      await route.fulfill({ json: { revisados: 51, noRevisadas: 0 } });
    } else if (url.pathname === "/api/admin/notifications") {
      await route.fulfill({ json: { items: revisados ? [] : [notice], total: revisados ? 0 : 51, noRevisadas: revisados ? 0 : 51, nextCursor: revisados ? null : "next" } });
    } else if (url.pathname === "/api/admin/counters") {
      await route.fulfill({ json: { notifications: revisados ? 0 : 51 } });
    } else await route.fulfill({ json: apiFixture(url) });
  });
  await page.goto("/admin/notifications");
  const boton = page.getByRole("button", { name: "Revisar todos los pendientes (51)" });
  await boton.click();
  const dialogo = page.getByRole("dialog", { name: "Revisar todos los avisos pendientes" });
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toBeInViewport();
  await expect(dialogo.getByRole("heading")).toBeFocused();
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).not.toBeVisible();
  expect(solicitudes).toBe(0);
  await boton.click();
  await dialogo.getByRole("button", { name: "Marcar todos como revisados" }).click();
  await expect(dialogo).not.toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Se marcaron 51 avisos como revisados." })).toBeVisible();
  await expect(page.getByText("0 sin revisar.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Avisos/ })).toContainText("(0)");
  await expect(boton).toHaveCount(0);
  expect(solicitudes).toBe(1);
});
