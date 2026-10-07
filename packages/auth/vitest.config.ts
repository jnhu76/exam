import { defineConfig } from "vitest/config";
import { TEST_RUNTIME_ENV } from "../../vitest.shared.js";

export default defineConfig({
  // #741: per-package implicit envDir admission is OFF (pinned by
  // scripts/check-env-surface.mjs).
  envDir: false,
  test: {
    globals: true,
    environment: "node",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Force a fixed runtime mode so tests are deterministic and do not
    // inherit the host's APP_MODE (e.g. "ci" in CI or "development"
    // locally). @exam/auth owns no mode policy — it reads no env — this
    // only pins the environment the package's tests observe.
    env: {
      ...TEST_RUNTIME_ENV,
    },
  },
});
