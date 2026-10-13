/**
 * Recorridos de privacidad en navegador (RNF-C4-IN-01, preparados en T017, ejecutados en T029/T030):
 * ni el token, ni el UUID, ni el texto del ciudadano llegan a storage, cookies ni URL del iframe.
 * Sirve el export real de `/chat` y simula la API con `page.route`.
 */
import { expect, test, type Page } from "@playwright/test";

const CHAT_ORIGIN = `http://localhost:${process.env.E2E_CHAT_PORT ?? 4311}`;
const UUID = "11111111-1111-4111-8111-111111111111";
const CONFIG = {
  apertura: "Soy Geobot, asistente automatizado.",
  politica: { version: "2026-10", url: "https://ejemplo.gov.co/politica" },
  opciones: [{ valor: "autorizo", etiqueta: "Autorizo" }, { valor: "no_autorizo", etiqueta: "No autorizo" }],
  contactos: {
    revision: 1,
    recepcion: { pqrsd: "https://pqrsd.gov.co", whatsapp: "+57 300 111 2233", email: "p@gov.co" },
    general: { phone: "1", email: "i@gov.co", url: "https://gov.co/c" },
    inmediatos: [],
  },
};

async function stubApi(page: Page) {
  await page.route("**/api/chat/config", r => r.fulfill({ json: CONFIG }));
  await page.route("**/api/session", r => r.fulfill({ json: { token: "tok-tecnico", expiresIn: 3600 } }));
  await page.route("**/api/conversations", r => r.fulfill({ status: 201, json: { modo: "conversación", conversationId: UUID } }));
  await page.route("**/api/chat", r => r.fulfill({
    json: r.request().postDataJSON()?.conversationId
      ? { modo: "conversación", conversationId: UUID, responseId: "r1", tipo: "respondida", respuesta: "Respuesta 1", fuentes: [] }
      : { modo: "anónima", tipo: "respondida", respuesta: "Respuesta 1", fuentes: [] },
  }));
}

for (const modo of ["Autorizo", "No autorizo"] as const) {
  test(`storage vacío tras una consulta (${modo})`, async ({ page }) => {
    await stubApi(page);
    await page.goto(`${CHAT_ORIGIN}/chat`);
    await page.getByRole("button", { name: modo, exact: true }).click();
    await page.getByRole("button", { name: "No estoy seguro" }).click();
    await page.getByLabel("Pregunta").fill("pregunta confidencial");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Respuesta 1")).toBeVisible();
    const dump = await page.evaluate(() =>
      JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, u: location.href }));
    for (const secreto of ["tok-tecnico", UUID, "confidencial"]) expect(dump).not.toContain(secreto);
    const dbs = await page.evaluate(async () => (await indexedDB.databases?.())?.length ?? 0);
    expect(dbs).toBe(0);
  });
}

test("recargar destruye la conversación y vuelve a pedir la decisión", async ({ page }) => {
  await stubApi(page);
  await page.goto(`${CHAT_ORIGIN}/chat`);
  await page.getByRole("button", { name: "No autorizo", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
  await expect(page.getByLabel("Pregunta")).toBeDisabled();
});

// ── SPEC005 · N401 (T039) ────────────────────────────────────────────────────────────────────
// Tres recorridos completos sobre el host real del fixture + iframe: 0 texto e IDs en
// localStorage/sessionStorage/IndexedDB/cookies/URL tanto del iframe como del host, 5 ciclos de
// ocultar/mostrar conservan la conversación, y recargar la pierde.

const TEXTOS = ["texto confidencial del ciudadano", "otra consulta reservada", "tercera pregunta privada"];

async function dumpOf(frame: import("@playwright/test").Frame) {
  return frame.evaluate(async () => ({
    dump: JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, u: location.href }),
    dbs: (await indexedDB.databases?.())?.length ?? 0,
  }));
}

for (const modo of ["Autorizo", "No autorizo"] as const) {
  test(`N401 · ${modo}: tres recorridos con 5 ocultaciones; el estado persiste mientras no se recargue y no toca almacenamiento`, async ({ page, context }) => {
    await context.route(`${CHAT_ORIGIN}/api/chat/config`, r => r.fulfill({ json: CONFIG }));
    await context.route(`${CHAT_ORIGIN}/api/session`, r => r.fulfill({ json: { token: "tok-tecnico-secreto", expiresIn: 3600 } }));
    await context.route(`${CHAT_ORIGIN}/api/conversations`, r => r.fulfill({ status: 201, json: { modo: "conversación", conversationId: UUID } }));
    await context.route(`${CHAT_ORIGIN}/api/chat`, r => {
      const b = r.request().postDataJSON() as { conversationId?: string };
      return r.fulfill({ json: b.conversationId
        ? { modo: "conversación", conversationId: UUID, responseId: "22222222-2222-4222-8222-222222222222", tipo: "respondida", respuesta: "Respuesta 1", fuentes: [] }
        : { modo: "anónima", tipo: "respondida", respuesta: "Respuesta 1", fuentes: [] } });
    });
    const toggle = page.locator("button.geobot-w-btn");
    for (let recorrido = 0; recorrido < 3; recorrido++) {
      await page.goto("/observatorio");
      // El host registra todo mensaje que recibe del iframe: no debe llevar texto ni identificadores.
      await page.evaluate(() => {
        (window as unknown as { __msgs: string[] }).__msgs = [];
        window.addEventListener("message", e => (window as unknown as { __msgs: string[] }).__msgs.push(JSON.stringify(e.data)));
      });
      await toggle.click();
      const f = page.frameLocator("iframe");
      await f.getByRole("button", { name: modo, exact: true }).click();
      await f.getByRole("button", { name: "No estoy seguro" }).click();
      await f.getByLabel("Pregunta").fill(TEXTOS[recorrido]);
      await f.getByRole("button", { name: "Enviar" }).click();
      await expect(f.getByText("Respuesta 1")).toBeVisible();

      // Cinco ciclos de ocultar/mostrar: la conversación sigue ahí.
      for (let ciclo = 0; ciclo < 5; ciclo++) { await toggle.click(); await toggle.click(); }
      await expect(f.getByText("Respuesta 1")).toBeVisible();
      await expect(f.getByLabel("Pregunta")).toBeEnabled();

      const chatFrame = page.frames().find(fr => fr.url().startsWith(CHAT_ORIGIN))!;
      const iframeStore = await dumpOf(chatFrame);
      const hostStore = await dumpOf(page.mainFrame());
      const mensajes = (await page.evaluate(() => (window as unknown as { __msgs: string[] }).__msgs)).join("|");
      for (const secreto of [UUID, "22222222-2222-4222-8222-222222222222", "tok-tecnico-secreto", TEXTOS[recorrido], "Respuesta 1"]) {
        expect(iframeStore.dump, `iframe contiene ${secreto}`).not.toContain(secreto);
        expect(hostStore.dump, `host contiene ${secreto}`).not.toContain(secreto);
        expect(mensajes, `postMessage al host contiene ${secreto}`).not.toContain(secreto);
      }
      expect(iframeStore.dbs).toBe(0);
      expect(hostStore.dbs).toBe(0);
      expect(page.url()).not.toContain(TEXTOS[recorrido]);

      // Recargar destruye la conversación.
      await page.reload();
      await toggle.click();
      await expect(page.frameLocator("iframe").getByText("Respuesta 1")).toHaveCount(0);
      await expect(page.frameLocator("iframe").getByRole("button", { name: modo, exact: true })).toBeVisible();
    }
  });
}
