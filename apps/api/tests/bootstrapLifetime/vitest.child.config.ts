import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { TEST_RUNTIME_ENV } from "../../../../vitest.shared.js";

/**
 * Dedicated config for the bootstrap-lifetime CHILD vitest run (spawned by
 * bootstrap-lifetime.test.ts). Mirrors ../slotReuse/vitest.child.config.ts:
 *
 * - NO globalSetup: the OUTER run already holds the cluster-scoped run lease;
 *   the child is that run's fixture, not an independent invocation.
 * - Load-time guard: throws unless BOOTSTRAP_LIFETIME_HANDOFF is non-empty
 *   AND TEST_WORKER_ID is set (only the parent orchestrator sets both), so
 *   this config can never run ordinary API tests.
 * - `test.root` + `test.include` are pinned to EXACTLY the two lifetime
 *   fixtures.
 *
 * The lifetime property under proof requires BOTH fixture files to execute
 * sequentially against the SAME worker slot: `maxWorkers: 1` gives exactly
 * that — one pool slot, one VITEST_POOL_ID, one resolved slot database.
 * With the forks pool's `isolate: true`, each file still runs in its OWN
 * worker process, which is precisely the condition the worker-slot bootstrap
 * fact must survive (it lives server-side — see @exam/db testWorkerDatabase).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../../..");
const apiRoot = path.resolve(__dirname, "../..");

const handoff = process.env.BOOTSTRAP_LIFETIME_HANDOFF ?? "";
const workerId = process.env.TEST_WORKER_ID ?? "";
if (handoff.trim() === "" || workerId.trim() === "") {
  throw new Error(
    "[vitest.bootstrap-lifetime.child.config] fixture-only config: it exists solely " +
      "for the bootstrap-lifetime fixtures spawned by bootstrap-lifetime.test.ts and " +
      "requires a non-empty BOOTSTRAP_LIFETIME_HANDOFF plus a dedicated TEST_WORKER_ID. " +
      "It deliberately has NO globalSetup (it never acquires the run lease), so it must " +
      "never run ordinary API tests — use the default ../../vitest.config.ts for real runs.",
  );
}

// Seed process.env from .env files so the child runner inherits them the
// same way the parent config does (only keys still undefined).
const envVars = loadEnv("test", workspaceRoot, "");
for (const [key, value] of Object.entries(envVars)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

export default defineConfig(({ mode }) => ({
  test: {
    root: apiRoot,
    include: [
      "tests/bootstrapLifetime/bootstrap-lifetime.one.fixture.test.ts",
      "tests/bootstrapLifetime/bootstrap-lifetime.two.fixture.test.ts",
    ],
    exclude: ["dist/**", "node_modules/**"],
    env: {
      ...loadEnv(mode, workspaceRoot, ""),
      ...TEST_RUNTIME_ENV,
    },
    // The lifetime proof: both fixture files in ONE worker process.
    maxWorkers: 1,
  },
}));
