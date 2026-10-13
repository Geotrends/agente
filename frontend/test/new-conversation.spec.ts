/** T054 (RF-C4-UI-05, SC-006): seis recorridos y teclado sobre el export real. */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { stubApi } from "./helpers/api";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");
const PREGUNTA = "¿Desea iniciar una conversación nueva? La conversación actual dejará de mostrarse.";

async function twoQueries(page: Page, mode: "Autorizo" | "No autorizo") {
  await page.goto("/observatorio");
  await toggle(page).click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: mode, exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  for (let i = 1; i <= 2; i++) {
    await f.getByLabel("Pregunta").fill(`consulta ${i}`);
    await f.getByRole("button", { name: "Enviar" }).click();
    await expect(f.getByText(`Respuesta ${i}`)).toBeVisible();
  }
  return f;
}

async function openDialog(f: FrameLocator) {
  await f.getByRole("button", { name: "Nueva conversación" }).click();
  const d = f.getByRole("dialog");
  await expect(d).toContainText(PREGUNTA);
  await expect(f.getByRole("button", { name: "Cancelar" })).toBeFocused();
  return d;
}

for (const mode of ["Autorizo", "No autorizo"] as const) {
  for (let n = 1; n <= 2; n++) {
    test(`${mode} #${n}: confirmar reinicia apertura → datos → categoría; primera consulta sin pares`, async ({ page, context }) => {
      const api = await stubApi(context);
      const f = await twoQueries(page, mode);
      await openDialog(f);
      await f.getByRole("button", { name: "Iniciar nueva" }).click();
      await expect(f.getByRole("dialog")).toHaveCount(0);
      await expect(f.getByRole("log")).not.toContainText("consulta 1");
      await expect(f.getByText("Soy Geobot, asistente automatizado del Observatorio.")).toBeVisible();
      await expect(f.getByLabel("Pregunta")).toBeDisabled();
      await f.getByRole("button", { name: mode, exact: true }).click();
      await f.getByRole("button", { name: "Ecosistemas" }).click();
      await f.getByLabel("Pregunta").fill("tras reiniciar");
      await f.getByRole("button", { name: "Enviar" }).click();
      await expect(f.getByText("Respuesta 3")).toBeVisible();
      const ultimo = api.chats.at(-1)!;
      expect(ultimo).not.toHaveProperty("historial");
      expect(ultimo).toHaveProperty("pregunta", "tras reiniciar");
      expect("conversationId" in ultimo).toBe(mode === "Autorizo");
      expect(api.conversations).toBe(mode === "Autorizo" ? 2 : 0);
    });
  }
}

for (const via of ["botón Cancelar", "tecla Escape"] as const) {
  test(`cancelar con ${via}: nada cambia y el foco vuelve a «Nueva conversación»`, async ({ page, context }) => {
    const api = await stubApi(context);
    const f = await twoQueries(page, "Autorizo");
    await openDialog(f);
    if (via === "botón Cancelar") await f.getByRole("button", { name: "Cancelar" }).click();
    else await page.keyboard.press("Escape");
    await expect(f.getByRole("dialog")).toHaveCount(0);
    await expect(f.getByRole("button", { name: "Nueva conversación" })).toBeFocused();
    await expect(f.getByRole("log")).toContainText("Respuesta 2");
    await expect(f.getByLabel("Pregunta")).toBeEnabled();
    expect(api.conversations).toBe(1);
    // El panel sigue visible: Escape en el diálogo no ocultó el panel.
    await expect(page.locator("#geobot-w-box")).toBeVisible();
  });
}

test("teclado: Tab contenido en el diálogo y Enter sobre «Iniciar nueva» confirma", async ({ page, context }) => {
  await stubApi(context);
  const f = await twoQueries(page, "No autorizo");
  await openDialog(f);
  await page.keyboard.press("Tab");
  await expect(f.getByRole("button", { name: "Iniciar nueva" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(f.getByRole("button", { name: "Cancelar" })).toBeFocused(); // vuelve al inicio del diálogo
  await page.keyboard.press("Shift+Tab");
  await expect(f.getByRole("button", { name: "Iniciar nueva" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(f.getByRole("button", { name: "No autorizo", exact: true })).toBeVisible();
});
