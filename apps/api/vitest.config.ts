import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    setupFiles: "./src/test/setup.ts",
    coverage: {
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 50,
      },
    },
  },
});
