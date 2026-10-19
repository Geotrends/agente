/** T021: CSP del HTML exportado y bloqueo de incrustación desde orígenes ajenos (RNF-C4-IN-02). */
import { expect, test, type Page } from "@playwright/test";
import { alternar, CHAT_ORIGIN, HOST_ORIGIN, stubApi } from "./helpers/api";

async function expectFrameBlocked(page: Page, navigate: () => Promise<void>) {
  const violations: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /frame-ancestors/.test(message.text())) violations.push(message.text());
  });
  await navigate();
  await expect.poll(() => violations.length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Geobot", exact: true })).toHaveCount(0);
}

test("el HTML de /chat trae una sola CSP con frame-ancestors exacto y sin X-Frame-Options", async ({ request }) => {
  const r = await request.get(`${CHAT_ORIGIN}/chat`);
  expect(r.status()).toBe(200);
  const headers = r.headers();
  const csp = headers["content-security-policy"];
  expect(csp).toBeTruthy();
  expect(csp.split(",").length, "una única cabecera").toBe(1);
  expect(csp).toContain(`frame-ancestors ${HOST_ORIGIN}`);
  expect(csp).not.toMatch(/frame-ancestors[^;]*(\*|'self'|http:\/\/(?!localhost))/);
  expect(headers["x-frame-options"]).toBeUndefined();
  expect(csp).toContain("object-src 'none'");
});

test("host autorizado incrusta; origen ajeno (127.0.0.1) y página sin origen quedan bloqueados", async ({ browser }) => {
  const ok = await browser.newContext();
  await stubApi(ok);
  const p1 = await ok.newPage();
  await p1.goto(`${HOST_ORIGIN}/observatorio`);
  await p1.locator("button.geobot-w-btn").click();
  await expect(p1.frameLocator("iframe").getByRole("heading", { name: "Geobot", exact: true })).toBeVisible();
  await ok.close();

  const bad = await browser.newContext();
  await stubApi(bad);
  const p2 = await bad.newPage();
  await expectFrameBlocked(p2, async () => {
    await p2.goto(HOST_ORIGIN.replace("localhost", "127.0.0.1") + "/observatorio");
    await p2.locator("button.geobot-w-btn").click();
  });
  await bad.close();
});

// ── SPEC005 · N402 (T058): 6 pruebas = 2 válidas / 3 bloqueos / 1 cabecera ────────────────────

test("N402 · válida 2: ocultar y volver a mostrar conserva un único iframe del origen autorizado", async ({ browser }) => {
  const ctx = await browser.newContext();
  await stubApi(ctx);
  const page = await ctx.newPage();
  await page.goto(`${HOST_ORIGIN}/observatorio`);
  const toggle = page.locator("button.geobot-w-btn");
  await toggle.click();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Geobot", exact: true })).toBeVisible();
  await alternar(page);
  await alternar(page);
  expect(await page.locator("iframe").count()).toBe(1);
  expect(await page.locator("iframe").getAttribute("src")).toBe(`${CHAT_ORIGIN}/chat`);
  await ctx.close();
});

test("N402 · bloqueo 2: un subdominio del host autorizado no puede incrustar", async ({ browser }) => {
  const ctx = await browser.newContext();
  await stubApi(ctx);
  const page = await ctx.newPage();
  await expectFrameBlocked(page, async () => {
    await page.goto(HOST_ORIGIN.replace("localhost", "sub.localhost") + "/observatorio");
    await page.locator("button.geobot-w-btn").click();
  });
  await ctx.close();
});

test("N402 · bloqueo 3: una página sin origen (about:blank/setContent) no puede incrustarlo", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await expectFrameBlocked(page, async () => {
    await page.setContent(`<iframe id="x" src="${CHAT_ORIGIN}/chat" width="400" height="300"></iframe>`);
  });
  await ctx.close();
});

test("N402 · cabecera: la CSP de producción generada nombra solo al Observatorio oficial y distinto del origen de la API", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "gb-csp-"));
  const target = join(dir, "csp-prod.conf");
  execFileSync("node", ["scripts/build-csp.mjs", "--out", "out", "--target", target], { cwd: join(process.cwd()) });
  const conf = readFileSync(target, "utf8");
  const csp = /Content-Security-Policy "([^"]+)"/.exec(conf)![1];
  expect(csp).toContain("frame-ancestors https://observatorioenvigado.geotrends.co");
  expect(csp.match(/frame-ancestors/g)).toHaveLength(1);
  expect(csp).not.toMatch(/frame-ancestors[^;]*(\*|'self'|http:|localhost)/);
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("unsafe-inline");
  // El origen que se incrusta (host) no es el origen de la API/iframe.
  expect(CHAT_ORIGIN).not.toBe("https://observatorioenvigado.geotrends.co");
});
