import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { TEST_RUNTIME_ENV } from "../../../../vitest.shared.js";
import { resolveParallelism } from "../../vitest.parallelism.js";

/**
 * Dedicated config for the slot-reuse CHILD vitest runs ONLY (spawned by
 * slot-reuse-isolation.test.ts). It intentionally omits the parent config's
 * `globalSetup`: that hook acquires the cluster-scoped run lease on the
 * canonical `postgres` database, and the OUTER run already holds that lease
 * for the whole duration of this proof — a child going through the parent's
 * globalSetup would be (correctly) rejected as a second worker-database run.
 *
 * The children are fixture runners orchestrated by the parent, not
 * independent test invocations: the parent's globalSetup has already probed
 * DB availability, and each child targets a unique slot database
 * (per-invocation TEST_WORKER_ID) that can never collide with the outer
 * run's VITEST_POOL_ID slot namespace. This file is therefore NOT a lease
 * bypass for real runs — the parent test is its only caller; nothing else
 * should invoke vitest with --config pointing here.
 *
 * Vitest deliberately exposes no CLI override for globalSetup, so a separate
 * config file is the only clean way to scope these fixture children out of
 * the parent's run-lease lifecycle. Everything else mirrors
 * ../../vitest.config.ts so the children boot with the same env seeding and
 * parallelism contract as a real run.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../../..");

// Seed process.env from .env files so the child runner inherits them the
// same way the parent config does (only keys still undefined).
const envVars = loadEnv("test", workspaceRoot, "");
for (const [key, value] of Object.entries(envVars)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const parallelism = resolveParallelism(process.env);

export default defineConfig(({ mode }) => ({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    // Force the same test runtime mode as every other vitest config.
    env: {
      ...loadEnv(mode, workspaceRoot, ""),
      ...TEST_RUNTIME_ENV,
    },
    fileParallelism: parallelism.fileParallelism,
    ...(parallelism.maxWorkers !== undefined
      ? { maxWorkers: parallelism.maxWorkers }
      : {}),
  },
}));
