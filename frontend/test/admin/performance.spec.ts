/**
 * RNF-C3-AD-08 · Rendimiento de las ocho pantallas contractuales (navegación → datos útiles) con el
 * volumen SINTÉTICO exigido (1.000 documentos, 100.000 interacciones, 10.000 auditorías). Es una
 * medición CONTROLADA en un servidor local: NO acredita la verificación del cliente en C6 con dos
 * fechas (T093). p95 por rango más cercano (n = 20 → muestra 19).
 */
import { expect, test } from "@playwright/test";
import { crearCuenta, iniciarSesion, reiniciarBloqueos, TECNICO } from "./helpers/panel";

const MUESTRAS = Number(process.env.ADMIN_PERF_SAMPLES ?? 20);
const PANTALLAS: Array<{ id: string; ruta: string; listo: (p: import("@playwright/test").Page) => import("@playwright/test").Locator }> = [
  { id: "bandeja", ruta: "/admin/pending", listo: p => p.getByRole("heading", { name: "Pendientes por validar", level: 1 }) },
  { id: "matriz", ruta: "/admin/documents", listo: p => p.getByRole("table", { name: "Matriz documental" }) },
  { id: "notificaciones", ruta: "/admin/notifications", listo: p => p.getByRole("heading", { name: "Avisos", level: 1 }) },
  { id: "auditoria", ruta: "/admin/audit", listo: p => p.getByRole("table", { name: "Registro de auditoría" }) },
  { id: "uso", ruta: "/admin/metrics/usage", listo: p => p.getByRole("table", { name: "Consultas por día" }) },
  { id: "documentos", ruta: "/admin/metrics/documents", listo: p => p.getByText(/Respuestas con documentos citados/) },
  { id: "valoraciones", ruta: "/admin/metrics/ratings", listo: p => p.getByRole("table", { name: "Motivos de «No útil»" }) },
  { id: "consumo", ruta: "/admin/metrics/consumption", listo: p => p.getByRole("table", { name: "Consumo por modelo" }) },
];

const p95 = (m: number[]) => [...m].sort((a, b) => a - b)[Math.ceil(0.95 * m.length) - 1];

test("@perf cada pantalla contractual carga con p95 ≤ 3 s sobre el volumen sintético", async ({ page, request }) => {
  test.setTimeout(900_000);
  await reiniciarBloqueos(request);
  expect((await request.post("/__test/volumen", { timeout: 300_000 })).ok()).toBeTruthy();
  const t = await crearCuenta(request, TECNICO);
  await iniciarSesion(page, t.email);
  await expect(page).toHaveURL(/\/admin\/documents$/);
  const informe: Array<{ pantalla: string; muestras: number; p95Ms: number; maxMs: number }> = [];
  for (const pant of PANTALLAS) {
    const tiempos: number[] = [];
    for (let i = 0; i < MUESTRAS; i++) {
      await page.goto("about:blank");
      const t0 = Date.now();
      await page.goto(pant.ruta);
      await expect(pant.listo(page)).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState("networkidle");
      tiempos.push(Date.now() - t0);
    }
    informe.push({ pantalla: pant.id, muestras: tiempos.length, p95Ms: p95(tiempos), maxMs: Math.max(...tiempos) });
  }
  console.log(JSON.stringify({ requisito: "RNF-C3-AD-08", controlado: true, informe }, null, 2));
  for (const r of informe) expect(r.p95Ms, `${r.pantalla} p95`).toBeLessThanOrEqual(3000);
});
