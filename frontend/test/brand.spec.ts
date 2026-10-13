/** T039 (RNF-C4-UI-04): diez elementos con estilos computados contra la guía y contrastes medidos. */
import { expect, test, type Locator } from "@playwright/test";
import { stubApi } from "./helpers/api";

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const toRgb = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
const lum = ([r, g, b]: number[]) => { const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a: string, b: string) => { const [l1, l2] = [lum(toRgb(a)), lum(toRgb(b))].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const style = (l: Locator) => l.evaluate(el => { const c = getComputedStyle(el); return { color: c.color, bg: c.backgroundColor, font: c.fontFamily }; });

const GUIA = { deep: "#0c342c", green: "#076653", cream: "#fffdee", mint: "#e2fbce", white: "#ffffff" };

test("diez elementos coinciden con la guía y cumplen contraste", async ({ page, context }) => {
  await stubApi(context, {
    answer: () => ({ json: { modo: "conversación", conversationId: "11111111-1111-4111-8111-111111111111", responseId: "r1", tipo: "respondida", respuesta: "Consulte la [norma](https://envigado.gov.co/n).", fuentes: [] } }),
  });
  await page.goto("/observatorio");
  const launcher = page.locator("button.geobot-w-btn");
  await launcher.click();
  const f = page.frameLocator("iframe");
  await expect(f.getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
  const header = f.locator(".chat-header");
  const logo = f.locator(".chat-header img");
  await expect(logo).toHaveAttribute("src", "/brand/logo-envigado.png");
  await f.getByRole("button", { name: "Autorizo", exact: true }).click();
  await f.getByRole("button", { name: "No estoy seguro" }).click();
  await f.getByLabel("Pregunta").fill("hola");
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByText("Consulte la")).toBeVisible();

  const els: Array<[string, Locator, { color?: string; bg?: string }]> = [
    ["botón de apertura", launcher, { color: GUIA.white, bg: GUIA.green }],
    ["encabezado", header, { color: GUIA.white, bg: GUIA.deep }],
    ["título Geobot", f.locator(".chat-header h1"), { color: GUIA.white }],
    ["subtítulo", f.locator(".chat-header p"), { color: GUIA.white }],
    ["botón primario", f.getByRole("button", { name: "No estoy seguro" }), { color: GUIA.white, bg: GUIA.green }],
    ["mensaje de Geobot", f.locator(".message.assistant").first(), { color: GUIA.deep, bg: GUIA.cream }],
    ["mensaje del ciudadano", f.locator(".message.user").first(), { color: GUIA.deep, bg: GUIA.mint }],
    ["enlace", f.locator(".message.assistant a").first(), { color: GUIA.green }],
    ["botón enviar", f.getByRole("button", { name: "Enviar" }), { color: GUIA.deep }],
    ["panel", f.locator(".chat-panel"), { color: GUIA.deep, bg: GUIA.white }],
  ];
  const informe: string[] = [];
  for (const [nombre, loc, esperado] of els) {
    const s = await style(loc);
    if (esperado.color) expect(s.color, `${nombre}: color`).toBe(rgb(esperado.color));
    if (esperado.bg) expect(s.bg, `${nombre}: fondo`).toBe(rgb(esperado.bg));
    expect(s.font, `${nombre}: tipografía`).toContain("Segoe UI");
    informe.push(`${nombre}|${s.color}|${s.bg}|${s.font}`);
  }
  // Contrastes medidos (texto ≥ 4,5:1) entre color y fondo efectivo declarado en la guía.
  const pares: Array<[string, string, string]> = [
    ["encabezado", GUIA.white, GUIA.deep], ["botón primario", GUIA.white, GUIA.green],
    ["mensaje de Geobot", GUIA.deep, GUIA.cream], ["mensaje del ciudadano", GUIA.deep, GUIA.mint],
    ["enlace sobre crema", GUIA.green, GUIA.cream], ["panel", GUIA.deep, GUIA.white],
  ];
  for (const [n, a, b] of pares) expect(ratio(rgb(a), rgb(b)), n).toBeGreaterThanOrEqual(4.5);
  console.log("ESTILOS\n" + informe.join("\n"));
});
