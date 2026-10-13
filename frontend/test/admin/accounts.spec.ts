/** US1 · E2E del panel (RNF-C3-AD-01/05, AD-05..11): sesión, cambio obligatorio, permisos y temporizadores. */
import { expect, test } from "@playwright/test";
import { crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, TECNICO, unico } from "./helpers/panel";

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

test("el técnico crea una cuenta, ve errores por campo y confirma o cancela la desactivación", async ({ page, request }) => {
  const tec = await crearCuenta(request, TECNICO);
  await iniciarSesion(page, tec.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { name: "Cuentas", level: 1 })).toBeVisible();

  // Error por campo: contraseña corta.
  const nuevo = unico("nueva");
  await page.getByLabel("Nombre").fill("Persona Nueva");
  await page.getByLabel("Correo electrónico").fill(nuevo);
  await page.getByLabel("Contraseña inicial").fill("corta");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "12" })).toBeVisible();

  await page.getByLabel("Contraseña inicial").fill("clave-inicial-larga");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Cuenta creada para ${nuevo}` })).toBeVisible();
  await expect(page.getByRole("cell", { name: nuevo, exact: true })).toBeVisible();

  // Correo repetido: error en el campo.
  await page.getByLabel("Nombre").fill("Otra");
  await page.getByLabel("Correo electrónico").fill(nuevo);
  await page.getByLabel("Contraseña inicial").fill("clave-inicial-larga");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ya existe una cuenta" })).toBeVisible();

  // Cancelar la desactivación no cambia nada.
  await page.getByRole("button", { name: `Desactivar ${nuevo}` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("row", { name: new RegExp(nuevo) })).toContainText("Activa");

  // Confirmar la desactivación.
  await page.getByRole("button", { name: `Desactivar ${nuevo}` }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("row", { name: new RegExp(nuevo) })).toContainText("Desactivada");
});

test("el último técnico no puede desactivarse ni cambiarse a Gestor: el motivo se muestra y no cambia nada", async ({ page, request }) => {
  const tec = await crearCuenta(request, TECNICO);
  await request.post("/__test/only-technical", { data: { id: tec.id } });
  await iniciarSesion(page, tec.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: `Desactivar ${tec.email}` }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("al menos un administrador técnico");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: `Cambiar perfil de ${tec.email}` }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("al menos un administrador técnico");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("row", { name: new RegExp(tec.email) })).toContainText("Activa");
});

test("cuenta con contraseña temporal: solo puede cambiarla; la URL directa a otra pantalla vuelve a la de cambio", async ({ page, request }) => {
  const u = await crearCuenta(request, TECNICO, { mustChange: true, password: "temporal-larga-123" });
  await iniciarSesion(page, u.email, "temporal-larga-123");
  await expect(page).toHaveURL(/\/admin\/password$/);
  await expect(page.getByText("Su contraseña es temporal")).toBeVisible();

  // Navegación directa a otra pantalla: nunca muestra contenido protegido.
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/admin\/password$/);
  await expect(page.getByRole("heading", { name: "Cuentas", level: 1 })).toHaveCount(0);

  // Contraseña igual a la temporal o corta: rechazada.
  await page.getByLabel("Contraseña actual").fill("temporal-larga-123");
  await page.getByLabel("Nueva contraseña", { exact: false }).first().fill("temporal-larga-123");
  await page.getByLabel("Confirmar nueva contraseña").fill("temporal-larga-123");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();

  await page.getByLabel("Nueva contraseña", { exact: false }).first().fill("definitiva-larga-456");
  await page.getByLabel("Confirmar nueva contraseña").fill("definitiva-larga-456");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page).toHaveURL(/\/admin\/documents$/);
});

test("el Gestor no ve enlaces técnicos y la URL directa de cuentas no revela datos", async ({ page, request }) => {
  const g = await crearCuenta(request, GESTOR);
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  const nav = page.getByRole("navigation", { name: "Panel de administración" });
  await expect(nav.getByRole("link", { name: "Cuentas" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Auditoría" })).toHaveCount(0);
  await page.goto("/admin/accounts");
  await expect(page.getByText("Su perfil no tiene acceso a esta función.")).toBeVisible();
  await expect(page.getByRole("cell")).toHaveCount(0);
});

test("sin sesión, las pantallas protegidas llevan al inicio de sesión sin mostrar contenido", async ({ page }) => {
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Cuentas", level: 1 })).toHaveCount(0);
});

test("la pantalla abierta e ignorada deja de consultar y cierra la sesión a los 30 minutos sin interacción", async ({ page, request }) => {
  const tec = await crearCuenta(request, TECNICO);
  await page.clock.install();
  let contadores = 0;
  page.on("request", r => { if (r.url().includes("/api/admin/counters")) contadores++; });
  await iniciarSesion(page, tec.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await page.clock.runFor(1000);
  const iniciales = contadores;
  expect(iniciales).toBeGreaterThanOrEqual(1);

  // Pasan 10 minutos sin interacción humana: tras el primer minuto no hay más consultas.
  await page.clock.runFor(60_000);
  const trasUnMinuto = contadores;
  await page.clock.runFor(9 * 60_000);
  expect(contadores).toBe(trasUnMinuto);

  // Tras 30 minutos de inactividad humana, la interfaz cierra la sesión.
  await page.clock.runFor(21 * 60_000 + 40_000);
  await expect(page).toHaveURL(/\/admin\/login\?expirada=1$/);
  await expect(page.getByText("Su sesión se cerró por inactividad")).toBeVisible();
});
