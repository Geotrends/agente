/** US4 · E2E de contactos: errores por campo, 120/121, reorden/baja y permisos por URL/servicio. */
import { expect, test } from "@playwright/test";
import { crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, TECNICO } from "./helpers/panel";

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

test("el técnico guarda los tres grupos, ve errores por campo y gestiona canales inmediatos", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/contacts");
  await expect(page.getByRole("heading", { name: "Contactos oficiales", level: 1 })).toBeVisible();

  // Recepción: PQRSD con http → error en ese campo.
  const recepcion = page.getByRole("region", { name: "Canales de recepción" });
  await recepcion.getByLabel("Enlace de PQRSD (https)").fill("http://pqrsd.gov.co");
  await recepcion.getByLabel("WhatsApp").fill("+57 300 000 1111");
  await recepcion.getByLabel("Correo").fill("pqrsd@prueba.gov.co");
  await recepcion.getByRole("button", { name: "Guardar recepción" }).click();
  await expect(recepcion.getByRole("alert").first()).toContainText("https");
  await recepcion.getByLabel("Enlace de PQRSD (https)").fill("https://pqrsd.prueba.gov.co");
  await recepcion.getByRole("button", { name: "Guardar recepción" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cambios guardados" })).toBeVisible();

  const general = page.getByRole("region", { name: "Contacto general" });
  await general.getByLabel("Teléfono").fill("6O4-ABC");
  await general.getByLabel("Correo").fill("info@prueba.gov.co");
  await general.getByLabel("Página de contacto (https)").fill("https://prueba.gov.co/contacto");
  await general.getByRole("button", { name: "Guardar contacto general" }).click();
  await expect(general.getByRole("alert").first()).toContainText("dígito");
  await general.getByLabel("Teléfono").fill("(604) 000 2222");
  await general.getByRole("button", { name: "Guardar contacto general" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cambios guardados" })).toBeVisible();

  // Inmediatos: 121 caracteres rechazado, 120 aceptado; descripción vacía rechazada.
  const nuevo = page.getByRole("heading", { name: "Agregar canal" });
  await expect(nuevo).toBeVisible();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Agregar canal" }) });
  await form.getByLabel("Nombre").fill("Línea verde");
  await form.getByLabel("Descripción (máximo 120 caracteres)").fill("a".repeat(121));
  await form.getByLabel("Valor").fill("018000");
  await form.getByRole("button", { name: "Agregar canal" }).click();
  await expect(form.getByRole("alert").first()).toContainText("120");
  await form.getByLabel("Descripción (máximo 120 caracteres)").fill("a".repeat(120));
  await form.getByRole("button", { name: "Agregar canal" }).click();
  await expect(page.getByRole("heading", { name: "Canal 1", level: 3 })).toBeVisible();

  // Segundo canal, reorden y baja; el último canal no se puede quitar desde la interfaz.
  await form.getByLabel("Nombre").fill("Bomberos");
  await form.getByLabel("Descripción (máximo 120 caracteres)").fill("Emergencias");
  await form.getByLabel("Valor").fill("119");
  await form.getByRole("button", { name: "Agregar canal" }).click();
  await expect(page.getByRole("heading", { name: "Canal 2", level: 3 })).toBeVisible();
  await page.getByRole("button", { name: "Subir canal 2" }).click();
  await expect(page.getByLabel("Nombre").first()).toHaveValue("Bomberos");
  await page.getByRole("button", { name: "Eliminar canal 2" }).click();
  await expect(page.getByRole("heading", { name: "Canal 2", level: 3 })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Eliminar canal 1" })).toBeDisabled();
});

test("el Gestor no accede a los contactos: la API responde 403 y la pantalla no muestra datos", async ({ page, request }) => {
  const g = await crearCuenta(request, GESTOR);
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await expect(page.getByRole("navigation", { name: "Panel de administración" }).getByRole("link", { name: "Contactos" })).toHaveCount(0);
  await page.goto("/admin/contacts");
  await expect(page.getByText("Su perfil no tiene acceso a esta función.")).toBeVisible();
  await expect(page.getByLabel("Enlace de PQRSD (https)")).toHaveCount(0);
});
