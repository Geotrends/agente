import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/admin-ux", workers: 1, retries: 0, reporter: "list",
  use: { baseURL: "http://127.0.0.1:4340", viewport: { width: 1440, height: 1000 },
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  webServer: { command: "npm run dev -- --hostname 127.0.0.1 --port 4340", url: "http://127.0.0.1:4340/admin/login", reuseExistingServer: true, timeout: 120_000 },
});
