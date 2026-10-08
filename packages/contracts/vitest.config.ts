import { defineConfig } from "vitest/config";
import { DOMAIN_TEST_SOURCE_ALIAS } from "../../vitest.sourceAliases.js";

export default defineConfig({
  // #741: per-package implicit envDir admission is OFF (pinned by
  // scripts/check-env-surface.mjs).
  envDir: false,
  // #689: a direct vitest run must read fresh @exam/domain source, not stale dist.
  resolve: { alias: [DOMAIN_TEST_SOURCE_ALIAS] },
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
