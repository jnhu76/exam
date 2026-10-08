import { defineConfig } from "vitest/config";

export default defineConfig({
  // #741: per-package implicit envDir admission is OFF (pinned by
  // scripts/check-env-surface.mjs).
  envDir: false,
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 60,
      },
    },
  },
});
