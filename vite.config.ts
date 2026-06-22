import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    exclude: ["node_modules/**", ".worktrees/**", "dist/**", "out/**", "release/**", "release-*/**", "tests/e2e/**", "tests/live/**"],
    globals: true,
    setupFiles: ["tests/setup.ts"],
  },
});
