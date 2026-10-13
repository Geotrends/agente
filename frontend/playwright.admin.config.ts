import { defineConfig, devices } from "@playwright/test";

/**
 * E2E del panel de administración de SPEC007 (`npm run test:admin:e2e`).
 *
 * Sirve el export estático de Next (`npm run build:admin`) y reenvía `/api` a la API REAL
 * (`createApp`) sobre una base PostgreSQL aislada con los roles de producción. No usa el host del
 * Observatorio ni la CSP del widget: configuración separada para no alterar la de SPEC004.
 * Las pruebas son controladas (C): no acreditan producción ni dispositivos reales.
 */
const PORT = Number(process.env.E2E_ADMIN_PORT ?? 4320);

export default defineConfig({
  testDir: "./test/admin",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --import tsx test/admin/helpers/adminServer.mts",
    url: `http://localhost:${PORT}/__ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_ADMIN_PORT: String(PORT) },
  },
});
