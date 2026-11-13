import path from "node:path";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import {
  TEST_RUNTIME_ENV,
  loadSupportedTestEnvFiles,
  seedProcessEnvFromFiles,
} from "../../config/vitest.shared.js";
import { workspaceSourceResolutionPlugin } from "../../config/workspace-resolution.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");

// Same env seeding contract as @exam/db's config (repo-root .env +
// .env.test.local, shell wins; TEST_RUNTIME_ENV last).
const fileEnv = loadSupportedTestEnvFiles(workspaceRoot);
seedProcessEnvFromFiles(fileEnv);

// The suite is small and file-schema isolated; the cap mirrors the resource
// admission rationale of @exam/db (DB-backed workers share one lifecycle
// advisory lane).
const DB_TEST_WORKER_CAP = 2;

export default defineConfig(() => ({
  envDir: false,
  plugins: [workspaceSourceResolutionPlugin()],
  test: {
    maxWorkers: Math.min(
      DB_TEST_WORKER_CAP,
      Math.max(1, availableParallelism() - 1),
    ),
    exclude: ["dist/**", "node_modules/**"],
    globalSetup: ["./vitest.globalSetup.ts"],
    env: {
      ...fileEnv,
      ...TEST_RUNTIME_ENV,
    },
  },
}));
