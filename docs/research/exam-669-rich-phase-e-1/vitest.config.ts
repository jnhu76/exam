import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { TEST_RUNTIME_ENV } from "../../../vitest.shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../..");

// Phase-E research harness. Loads the same .env seeds as every other package
// config so the DB resolver routes to the implicit local exam_test contract
// (docs/standards/testing.md §2). Serial execution: L4 campaigns own real
// database lifecycle and must not interleave.
export default defineConfig(({ mode }) => ({
  test: {
    include: ["harness/**/*.test.ts"],
    // L4 campaigns share apps/api's DB lifecycle procedure verbatim (base-DB
    // existence + run lease): one authority, no parallel protocol.
    globalSetup: ["../../../apps/api/vitest.globalSetup.ts"],
    env: {
      ...loadEnv(mode, workspaceRoot, ""),
      ...TEST_RUNTIME_ENV,
    },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    // Preserve the workspace packages' TS-source resolution behavior
    // (.js specifier → .ts file) that apps/api and packages/db rely on.
    extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
  },
}));
