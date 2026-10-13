import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const CLAVE = "contraseña-segura-123";
export const TECNICO = "administrador técnico";
export const GESTOR = "Gestor documental";

let contador = 0;
export const unico = (prefijo: string): string => `${prefijo}.${Date.now().toString(36)}${contador++}@prueba.gov.co`;

export async function crearCuenta(
  request: APIRequestContext, perfil: string, opts: { email?: string; password?: string; mustChange?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const email = opts.email ?? unico(perfil === TECNICO ? "tec" : "ges");
  const r = await request.post("/__test/account", { data: { email, perfil, password: opts.password ?? CLAVE, mustChange: opts.mustChange ?? false } });
  expect(r.ok()).toBeTruthy();
  return { id: (await r.json()).id as string, email };
}

export async function iniciarSesion(page: Page, email: string, password = CLAVE): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

export async function reiniciarBloqueos(request: APIRequestContext): Promise<void> {
  await request.post("/__test/reset");
}

/** Ejecuta un ciclo del worker documental del servidor de pruebas. */
export async function correrWorker(request: APIRequestContext): Promise<void> {
  const r = await request.post("/__test/worker", { timeout: 180_000 });
  expect(r.ok()).toBeTruthy();
}

/** Crea un aviso (de sistema o de carga con propietario) en el servidor de pruebas. */
export async function crearAviso(
  request: APIRequestContext, data: { tipo: string; objeto: string; descripcion: string; propietario?: string },
): Promise<void> {
  const r = await request.post("/__test/notify", { data });
  expect(r.ok()).toBeTruthy();
}

export type InteraccionSemilla = {
  tipo: string; categoria: string; pregunta: string; respuesta: string; hace?: string; valoracion?: string; motivo?: string; purgada?: boolean;
};
export async function sembrarInteraccion(request: APIRequestContext, data: InteraccionSemilla): Promise<void> {
  const r = await request.post("/__test/interaction", { data });
  expect(r.ok()).toBeTruthy();
}
