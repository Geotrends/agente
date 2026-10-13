import { defineConfig, devices } from "@playwright/test";

/**
 * E2E de SPEC004 (`npm run test:ui:e2e`).
 *
 * El host (fixture del Observatorio) y el iframe viven en puertos distintos, como en producción.
 * Chromium/Firefox/WebKit y los canales Chrome/Edge son EMULACIÓN de escritorio y móvil: no
 * equivalen a Chrome Android ni Safari iOS reales (T079). Los canales solo se añaden si existen.
 */
const HOST_PORT = Number(process.env.E2E_HOST_PORT ?? 4310);
const CHAT_PORT = Number(process.env.E2E_CHAT_PORT ?? 4311);
const withChannels = process.env.E2E_CHANNELS === "1";

export default defineConfig({
  testDir: "./test",
  testMatch: /.*\.spec\.ts/,
  // El panel de SPEC007 tiene su propia configuración (playwright.admin.config.ts).
  testIgnore: /[\\/]admin[\\/]/,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${HOST_PORT}`,
    trace: "retain-on-failure",
    // Solo desarrollo local: usar un Chromium ya instalado (E2E_CHROMIUM_PATH) en lugar del descargado.
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ...(withChannels
      ? [
          { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
          { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
        ]
      : []),
    { name: "mobile-chromium-emulado", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit-emulado", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: "node --import tsx test/helpers/hostServer.ts",
    url: `http://localhost:${HOST_PORT}/observatorio`,
    reuseExistingServer: !process.env.CI,
    env: { E2E_HOST_PORT: String(HOST_PORT), E2E_CHAT_PORT: String(CHAT_PORT) },
  },
});
