/** US3 · E2E de propuestas y enlaces: propias, motivos, retiro de pendiente y cambios solo del técnico. */
import { expect, test } from "@playwright/test";
import { crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, TECNICO, unico } from "./helpers/panel";

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

async function proponer(page: import("@playwright/test").Page, url: string, justificacion = "Contenido relevante") {
  await page.getByLabel("Tipo de solicitud").selectOption("add");
  await page.getByLabel("URL completa (https)").fill(url);
  await page.getByLabel("Dirección responsable").selectOption("Ecosistemas");
  await page.getByLabel("Justificación").fill(justificacion);
  await page.getByRole("button", { name: "Registrar propuesta" }).click();
}

test("el Gestor registra, ve solo las suyas con el motivo del rechazo y retira una pendiente", async ({ page, browser, request }) => {
  const g = await crearCuenta(request, GESTOR);
  const t = await crearCuenta(request, TECNICO);
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/proposals");
  const url = `https://ambientometroenvigado.com/${unico("p")}`;
  await proponer(page, url);
  await expect(page.getByRole("status").filter({ hasText: "Pendiente de validación" })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(url.replace(/[.?]/g, "\\$&")) })).toContainText("Pendiente de validación");

  // Error por campo: URL con http.
  await proponer(page, "http://ambientometroenvigado.com/x");
  await expect(page.getByRole("alert").filter({ hasText: "https" })).toBeVisible();

  // El técnico rechaza con motivo desde otra sesión.
  const ctx = await browser.newContext();
  const tp = await ctx.newPage();
  await iniciarSesion(tp, t.email);
  await expect(tp).toHaveURL(/\/admin\/documents$/);
  await tp.goto("/admin/proposals");
  await tp.getByRole("button", { name: `Rechazar ${url}` }).click();
  await tp.getByRole("button", { name: "Confirmar rechazo" }).click();
  await expect(tp.getByRole("dialog").getByRole("alert")).toContainText("motivo");
  await tp.getByLabel("Motivo (obligatorio)").fill("No pertenece al alcance de la base");
  await tp.getByRole("button", { name: "Confirmar rechazo" }).click();
  await ctx.close();

  await page.reload();
  const fila = page.getByRole("row", { name: new RegExp(url.replace(/[.?]/g, "\\$&")) });
  await expect(fila).toContainText("Rechazada");
  await expect(fila).toContainText("No pertenece al alcance de la base");

  // Retirar una pendiente propia.
  const url2 = `https://ambientometroenvigado.com/${unico("q")}`;
  await proponer(page, url2);
  await page.getByRole("button", { name: `Retirar propuesta ${url2}` }).click();
  await expect(page.getByRole("row", { name: new RegExp(url2.replace(/[.?]/g, "\\$&")) })).toContainText("Retirada");
  // El Gestor no ve la pantalla de enlaces: acceso directo denegado por el servicio.
  await page.goto("/admin/links");
  await expect(page.getByText("Su perfil no tiene acceso a esta función.")).toBeVisible();
});

test("el técnico agrega y quita enlaces con justificación; quitar muestra los documentos afectados", async ({ page, request }) => {
  const t = await crearCuenta(request, TECNICO);
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/links");
  const url = `https://ambientometroenvigado.com/${unico("e")}`;
  await page.getByLabel("URL completa (https)").fill(url);
  await page.getByLabel("Dirección responsable").selectOption("Ecosistemas");
  await page.getByLabel("Justificación").fill("Sección nueva del observatorio");
  await page.getByRole("button", { name: "Agregar enlace" }).click();
  await expect(page.getByRole("row", { name: new RegExp(url.replace(/[.?]/g, "\\$&")) })).toBeVisible();

  // Host no permitido: error en el campo.
  await page.getByLabel("URL completa (https)").fill("https://www.minambiente.gov.co/x");
  await page.getByLabel("Dirección responsable").selectOption("Ecosistemas");
  await page.getByLabel("Justificación").fill("x");
  await page.getByRole("button", { name: "Agregar enlace" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "lista de hosts permitidos" })).toBeVisible();

  // Quitar: cancelar no cambia; con justificación se quita (sin documentos → mensaje sin aviso).
  await page.getByRole("button", { name: `Quitar ${url}` }).click();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("row", { name: new RegExp(url.replace(/[.?]/g, "\\$&")) })).toBeVisible();
  await page.getByRole("button", { name: `Quitar ${url}` }).click();
  await page.getByLabel("Justificación (obligatoria)").fill("Ya no es necesario");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "No había documentos publicados" })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(url.replace(/[.?]/g, "\\$&")) })).toHaveCount(0);
});
