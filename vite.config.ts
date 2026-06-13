import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    exclude: ["node_modules/**", "dist/**", "out/**", "tests/e2e/**"],
    globals: true,
    setupFiles: ["tests/setup.ts"],
  },
});
