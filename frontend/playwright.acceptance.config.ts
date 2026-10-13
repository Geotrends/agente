import { defineConfig } from '@playwright/test';
// Solo objetivos externos prevalidos. Nunca levanta host de CI ni intercepta la API.
export default defineConfig({ testDir: './test/pr', testMatch: 'flows.spec.ts', workers: 1, retries: 0, timeout: 180000, reporter: [['list']], use: { browserName: 'chromium', trace: 'off', screenshot: 'off', ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}) } });
