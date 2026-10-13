import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Pruebas de estado/componentes de SPEC004 (`npm run test:ui`). Los archivos `di-*` son las
// pruebas heredadas de node:test y se ejecutan con `npm test`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3000/" } },
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["test/di-*", "test/**/*.spec.ts", "node_modules/**"],
    restoreMocks: true,
  },
});
