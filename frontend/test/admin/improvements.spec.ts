/** US6 · E2E de casos de mejora: estados estrictos, REAL antes de En ajuste, nota al cierre y acceso. */
import { expect, test } from "@playwright/test";
import { crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, sembrarInteraccion, TECNICO, unico } from "./helpers/panel";

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

test("el técnico avanza un caso: tipo de fallo para En ajuste y nota para Cerrada; no hay saltos", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  const m = unico("c").split("@")[0].replace(".", "-");
  await sembrarInteraccion(request, { tipo: "sin información", categoria: "Ecosistemas", pregunta: `Caso ${m}`, respuesta: "No encontré información", hace: "2 hours" });
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/improvements");
  await expect(page.getByRole("heading", { name: "Casos de mejora", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Gestionar caso del .* \(Registrada\)/ }).first().click();
  await expect(page.getByRole("dialog")).toContainText("Siguiente estado permitido: En análisis");
  await page.getByRole("button", { name: "Pasar a «En análisis»" }).click();
  await expect(page.getByRole("dialog")).toContainText("Siguiente estado permitido: En ajuste");
  // Sin tipo de fallo no se puede pasar a En ajuste.
  await page.getByRole("button", { name: "Pasar a «En ajuste»" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("tipo de fallo");
  await page.getByLabel("Tipo de fallo (obligatorio)").selectOption("Datos");
  await page.getByRole("button", { name: "Pasar a «En ajuste»" }).click();
  await expect(page.getByRole("dialog")).toContainText("Siguiente estado permitido: Ajustada");
  await expect(page.getByRole("dialog")).toContainText("En análisis → En ajuste");
});

test("el Gestor no ve la sección de mejoras ni su contador", async ({ page, request }) => {
  const g = await crearCuenta(request, GESTOR);
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await expect(page.getByRole("navigation", { name: "Panel de administración" }).getByRole("link", { name: /^Mejoras/ })).toHaveCount(0);
  await page.goto("/admin/improvements");
  await expect(page.getByText("Su perfil no tiene acceso a esta función.")).toBeVisible();
});
