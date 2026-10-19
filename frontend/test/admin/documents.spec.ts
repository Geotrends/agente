/** US2 · E2E de documentos: carga con ambos perfiles, matriz, progreso 202→Terminada y retiro con confirmación. */
import { expect, test } from "@playwright/test";
import { crearPdf, RELLENO } from "../../../backend/test/admin-integracion/fixtures";
import { correrWorker, crearCuenta, GESTOR, iniciarSesion, reiniciarBloqueos, TECNICO, unico } from "./helpers/panel";

test.beforeEach(async ({ request }) => { await reiniciarBloqueos(request); });

const pdf = (dato: string) => ({ name: "documento.pdf", mimeType: "application/pdf", buffer: crearPdf([RELLENO, dato]) });

async function cargar(page: import("@playwright/test").Page, titulo: string, dato: string, extra: Record<string, string> = {}) {
  await page.getByRole("tab", { name: "Cargar un documento" }).click();
  await page.getByLabel("Archivo (PDF, DOCX o XLSX)").setInputFiles(pdf(dato));
  await page.getByLabel("Título").fill(titulo);
  await page.getByLabel("Dirección").selectOption("Ecosistemas");
  await page.getByLabel("Enlace público (https)").fill(`https://ambientometroenvigado.com/${unico("doc")}`);
  for (const [etiqueta, valor] of Object.entries(extra)) await page.getByLabel(etiqueta).fill(valor);
  await page.getByRole("button", { name: "Cargar documento" }).click();
}

test("el Gestor carga un documento, ve N/A y filtra sus cargas; no tiene acciones técnicas", async ({ page, request }) => {
  const g = await crearCuenta(request, GESTOR);
  await iniciarSesion(page, g.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  await cargar(page, "Guía del gestor", "Dato GESTOR1");
  await expect(page.getByRole("status").filter({ hasText: "Pendiente de aprobación" })).toBeVisible();
  const fila = page.getByRole("row", { name: /Guía del gestor/ });
  await expect(fila).toContainText("Por aprobar");
  await expect(fila).toContainText("N/A");
  await expect(fila).toContainText("Manual");

  // Error por campo: sin título.
  await page.getByRole("tab", { name: "Cargar un documento" }).click();
  await page.getByLabel("Archivo (PDF, DOCX o XLSX)").setInputFiles(pdf("otro"));
  await page.getByLabel("Título").fill("");
  await page.getByLabel("Dirección").selectOption("Ecosistemas");
  await page.getByLabel("Enlace público (https)").fill("https://ambientometroenvigado.com/x");
  await page.getByRole("button", { name: "Cargar documento" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "obligatorio" })).toBeVisible();

  // Filtro propio y ausencia de controles privilegiados.
  await page.getByRole("tab", { name: /^Matriz documental/ }).click();
  await page.getByLabel("Solo mis cargas").check();
  await expect(page.getByRole("row", { name: /Guía del gestor/ })).toBeVisible();
  for (const nombre of ["Publicar", "Rechazar", "Retirar", "Editar", "Reindexar"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${nombre}`) })).toHaveCount(0);
  }
  await expect(page.getByRole("tab", { name: "Reindexación" })).toHaveCount(0);
  // Llamada directa a una función técnica: denegada por el servicio.
  const estado = await page.evaluate(async () => (await fetch("/api/admin/document-operations/00000000-0000-4000-8000-000000000000", { credentials: "same-origin" })).status);
  expect(estado).toBe(403);
});

test("el técnico publica (202 → En curso → Terminada) y retira con motivo; cancelar no cambia nada", async ({ page, request }) => {
  test.setTimeout(240_000); // la primera indexación carga el modelo de embeddings local
  const t = await crearCuenta(request, TECNICO);
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  const titulo = `Convenio ${unico("c")}`;
  await cargar(page, titulo, "Clave E2EUNICA9981");
  await expect(page.getByRole("row", { name: new RegExp(titulo) })).toBeVisible();
  await correrWorker(request); // procesa la carga (conversión local)
  await page.reload();

  await page.getByRole("button", { name: `Publicar ${titulo}` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Publicación" }).first()).toContainText("En curso");
  await correrWorker(request);
  await page.getByRole("button", { name: "Actualizar estado de la operación" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Terminada" }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("row", { name: new RegExp(titulo) })).toContainText("Publicado");

  // Retiro: cancelar no cambia nada; sin motivo se rechaza; con motivo queda En curso y luego desaparece.
  await page.getByRole("button", { name: `Retirar ${titulo}` }).click();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("row", { name: new RegExp(titulo) })).toContainText("Publicado");
  await page.getByRole("button", { name: `Retirar ${titulo}` }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("motivo");
  await page.getByLabel("Motivo (obligatorio)").fill("Documento obsoleto");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await correrWorker(request);
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(titulo) })).toHaveCount(0);
});
