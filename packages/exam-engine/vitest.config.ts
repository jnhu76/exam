import { defineConfig } from "vitest/config";

export default defineConfig({
  // #741: per-package implicit envDir admission is OFF (pinned by
  // scripts/check-env-surface.mjs).
  envDir: false,
  test: {
    exclude: ["dist/**", "node_modules/**"],
  },
});
