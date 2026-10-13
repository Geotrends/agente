/** T038 (RNF-C4-UI-02): axe A/AA en los estados de lectura. La revisión manual consta en us2-manual.md. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { stubApi } from "./helpers/api";

const RESPUESTA = [
  "### Requisitos",
  "",
  "1. Diligencie el formulario **GT-F-01**.",
  "2. Radique en la [ventanilla virtual](https://tramites.envigado.gov.co/ventanilla).",
  "",
  "| Trámite | Plazo |",
  "|---|---|",
  "| Permiso | 30 días |",
  "| Visita | 15 días |",
].join("\n");

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.flatMap(v => v.nodes.map(n => `${label}: ${v.id} ${n.target.join(" > ")} :: ${n.any[0]?.message ?? n.failureSummary}`))).toEqual([]);
}

test("estados de lectura sin incumplimientos A/AA", async ({ page, context }) => {
  await stubApi(context, {
    answer: () => ({
      json: {
        modo: "conversación", conversationId: "11111111-1111-4111-8111-111111111111", responseId: "r1", tipo: "respondida",
        respuesta: RESPUESTA,
        fuentes: [{ id: "d1", nombre: "Resolución 123", enlace: "https://envigado.gov.co/res-123", fecha: "2026-03-15" }],
      },
    }),
  });
  await page.goto("/observatorio");
  await page.locator("button.geobot-w-btn").click();
  const f = page.frameLocator("iframe");
  await expect(f.getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
  await axe(page, "apertura/consentimiento");

  await f.getByRole("button", { name: "Emergencia o situación en curso" }).click();
  await expect(f.getByRole("heading", { name: "Canales de atención inmediata" })).toBeVisible();
  await axe(page, "emergencia");
  await f.getByRole("button", { name: "Continuar con la orientación" }).click();

  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await expect(f.getByRole("button", { name: "Ecosistemas" })).toBeVisible();
  await axe(page, "categoría");

  await f.getByRole("button", { name: "No estoy seguro" }).click();
  await f.getByLabel("Pregunta").fill("¿Qué requisitos tiene?");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.locator("table")).toBeVisible();
  await f.locator("details.sources summary").click();
  await axe(page, "respuesta con lista, tabla, enlaces y fuentes");
});
