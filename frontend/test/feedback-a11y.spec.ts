/** T071 (RNF-C4-UI-02): axe A/AA en todos los estados de valoración, dentro del iframe y en el host. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { stubApi } from "./helpers/api";

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.flatMap(v => v.nodes.map(n => `${label}: ${v.id} ${n.target.join(" > ")} :: ${n.any[0]?.message ?? ""}`))).toEqual([]);
}

test("estados de valoración: disponible, motivo, enviando, confirmada y fallida", async ({ page, context }) => {
  await stubApi(context, {
    rating: (n, body) => (n === 1 ? { status: 201, delayMs: 700 } : body.valoracion === "Útil" ? { status: 503 } : { status: 201 }),
  });
  await page.goto("/observatorio");
  await page.locator("button.geobot-w-btn").click();
  const f = page.frameLocator("iframe");
  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  for (const q of ["uno", "dos"]) {
    await f.getByLabel("Pregunta").fill(q);
    await f.getByRole("button", { name: "Enviar" }).click();
  }
  await expect(f.getByText("Respuesta 2")).toBeVisible();
  await axe(page, "valoración disponible (respuestas con controles)");

  const g = f.getByRole("group", { name: "Valorar esta respuesta" }).first();
  await g.getByRole("button", { name: "No útil" }).click();
  await axe(page, "selección de motivo");

  await g.getByRole("radio", { name: "Otro" }).check();
  await g.getByRole("button", { name: "Enviar valoración" }).click();
  await axe(page, "enviando");
  await expect(f.getByText("Gracias por su valoración")).toBeVisible();
  await axe(page, "confirmada");

  await f.getByRole("group", { name: "Valorar esta respuesta" }).first().getByRole("button", { name: "Útil", exact: true }).click();
  await expect(f.getByText(/No se pudo registrar su valoración/)).toBeVisible();
  await axe(page, "fallida");
});
