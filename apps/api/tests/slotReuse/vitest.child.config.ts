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
 * run's VITEST_POOL_ID slot namespace.
 *
 * "Fixture-only" is EXECUTABLE here, not a comment-level convention — a
 * config without globalSetup must never be able to run the ordinary suite:
 *   - the config throws at load time unless SLOT_REUSE_STAGE is exactly "A"
 *     or "B" AND SLOT_REUSE_HANDOFF is non-empty (only the parent
 *     orchestrator sets both), and
 *   - `test.root` + `test.include` are pinned to EXACTLY the one stage
 *     fixture, so even a caller that fakes the env cannot discover any other
 *     API test through this config (positional filters only intersect the
 *     pinned include).
 * There is deliberately NO generic escape hatch (no TEST_DISABLE_RUN_LEASE /
 * SKIP_RUN_LEASE / ALLOW_NESTED_TEST_RUN): the lease exists precisely so
 * concurrent local worker-database runs cannot corrupt each other.
 *
 * Vitest deliberately exposes no CLI override for globalSetup, so a separate
 * config file is the only clean way to scope these fixture children out of
 * the parent's run-lease lifecycle. Everything else mirrors
 * ../../vitest.config.ts so the children boot with the same env seeding and
 * parallelism contract as a real run. Regressions for the boundary:
 * child-config.contract.test.ts.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../../..");
const apiRoot = path.resolve(__dirname, "../..");

const stage = process.env.SLOT_REUSE_STAGE;
const handoff = process.env.SLOT_REUSE_HANDOFF ?? "";
if ((stage !== "A" && stage !== "B") || handoff.trim() === "") {
  throw new Error(
    "[vitest.child.config] fixture-only config: this config exists solely for the " +
      "slot-reuse stage fixtures spawned by slot-reuse-isolation.test.ts and requires " +
      "SLOT_REUSE_STAGE=A|B plus a non-empty SLOT_REUSE_HANDOFF. It deliberately has NO " +
      "globalSetup (it never acquires the run lease), so it must never run ordinary API " +
      "tests — use the default ../../vitest.config.ts for real runs.",
  );
}

// Seed process.env from .env files so the child runner inherits them the
// same way the parent config does (only keys still undefined).
const envVars = loadEnv("test", workspaceRoot, "");
for (const [key, value] of Object.entries(envVars)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const parallelism = resolveParallelism(process.env);

export default defineConfig(({ mode }) => ({
  test: {
    root: apiRoot,
    include: [`tests/slotReuse/stage${stage}.fixture.test.ts`],
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
