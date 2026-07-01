import { defineConfig } from "vitest/config";
import { TEST_RUNTIME_ENV } from "../../vitest.shared.js";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Force test runtime mode so production-guard tests can reliably stub
    // APP_MODE/NODE_ENV without inheriting the host's APP_MODE (e.g. "ci"
    // in CI or "development" locally). session.ts reads process.env lazily
    // at call time, so vi.stubEnv in the test overrides these values.
    env: {
      ...TEST_RUNTIME_ENV,
    },
  },
});
