import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  dropDatabaseIfExists,
  withDatabaseName,
} from "@exam/db/src/testWorkerDatabase.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { resolveTestScope } from "@exam/db/src/testScope.js";

/**
 * Worker-DB bootstrap lifetime proof — PARENT orchestrator.
 *
 * The slot-reuse proof (../slotReuse/) runs its stages in TWO DIFFERENT child
 * Vitest invocations, so it cannot show what happens across test files that
 * share ONE worker slot within a single Vitest invocation. This proof closes
 * exactly that gap: ONE child invocation with `maxWorkers: 1` runs TWO fixture
 * files sequentially in the same pool slot (with forks + isolate:true each
 * file runs in its own worker process — precisely the condition the
 * slot-lifetime bootstrap fact must survive).
 *
 * Required invariant (worker-database mode):
 *   - worker-DB bootstrap (ensure+migrate under the shared lifecycle lock):
 *     WORKER-SLOT lifetime — the first file takes it (ONE merged critical
 *     section), the second file sees the completed bootstrap with zero new
 *     lifecycle acquisitions;
 *   - business-data reset (resetPostgres): FILE lifetime — the second file's
 *     first buildTestApp wipes the first file's sentinel business row while
 *     canonical seed state and migration metadata stay intact.
 *
 * Role assignment between the two fixtures is order-agnostic (exclusive
 * lock-file election in fixture-support.ts), so the proof holds whichever
 * order the child runner picks.
 *
 * The child runs under ./vitest.child.config.ts: no globalSetup (the outer
 * run holds the run lease), include pinned to the two fixtures, dedicated
 * per-invocation TEST_WORKER_ID slot DB that can never collide with the
 * outer run's VITEST_POOL_ID slots.
 */
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const API_DIR = join(__dirname, "../..");
const VITEST_BIN = join(API_DIR, "node_modules/.bin/vitest");
const CHILD_CONFIG = "tests/bootstrapLifetime/vitest.child.config.ts";
const FIRST_HANDOFF = "first-handoff.json";
const SECOND_HANDOFF = "second-handoff.json";

interface LifetimeHandoff {
  file: string;
  pid: number;
  poolId: string | null;
  workerDb: string;
  lockAcquisitions: number;
  sentinelCode: string;
  migrationCount: number;
  sentinelSeen: boolean | null;
  canonicalSeedOk: boolean | null;
}

const workDir = await mkdtemp(join(tmpdir(), "bootstrap-lifetime-"));
// Dedicated slot id for this invocation: charset-safe, unique per run, well
// under the 63-char identifier limit once prefixed with exam_test_w.
const slotWorkerId = `blt${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
// Derive the expected slot DB name through the SAME resolver the child uses,
// so the local (exam_test_w<id>) and CI shard (exam_test_s<N>_w<id>) naming
// shapes both hold.
const expectedSlotDbName = resolveTestScope({
  ...process.env,
  TEST_WORKER_ID: slotWorkerId,
  TEST_DB_ISOLATION: "worker-database",
}).postgresDatabaseName as string;

describe("worker-DB bootstrap lifetime (two files, one pool slot)", () => {
  it("bootstraps the slot exactly once while the business reset stays per-file", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    // Not consumed by the child config; kept empty so an inherited value can
    // never leak parallelism policy into the fixture runner.
    env.API_TEST_MAX_WORKERS = "";
    // The child runner injects its own runner ids; do not leak the parent's.
    delete env.VITEST_POOL_ID;
    delete env.VITEST_WORKER_ID;
    // Dedicated slot DB for this proof (documented serial-debug override).
    env.TEST_WORKER_ID = slotWorkerId;
    env.TEST_DB_ISOLATION = "worker-database";
    env.BOOTSTRAP_LIFETIME_HANDOFF = workDir;

    const run = await new Promise<{ code: number; output: string }>(
      (resolve, reject) => {
        const child = spawn(VITEST_BIN, ["run", "--config", CHILD_CONFIG], {
          cwd: API_DIR,
          env,
        });
        let output = "";
        child.stdout.on("data", (d: Buffer) => {
          output += d.toString();
        });
        child.stderr.on("data", (d: Buffer) => {
          output += d.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? -1, output }));
      },
    );
    expect(run.code, `lifetime child failed:\n${run.output.slice(-4000)}`).toBe(
      0,
    );

    const first = JSON.parse(
      await readFile(join(workDir, FIRST_HANDOFF), "utf8"),
    ) as LifetimeHandoff;
    const second = JSON.parse(
      await readFile(join(workDir, SECOND_HANDOFF), "utf8"),
    ) as LifetimeHandoff;

    // Two distinct fixture files really ran, in the SAME pool slot. With
    // forks + isolate:true each file runs in its own worker process — which
    // is precisely the condition the slot-lifetime bootstrap fact must
    // survive (it does, server-side; pid equality would be a vitest-internals
    // assertion, not the invariant).
    expect(first.file).not.toBe(second.file);
    expect(first.poolId).toBe("1");
    expect(second.poolId).toBe("1");
    expect(first.workerDb).toBe(expectedSlotDbName);
    expect(second.workerDb).toBe(expectedSlotDbName);

    // Bootstrap lifetime: SLOT, not file. ONE merged ensure+migrate critical
    // section in the first file; zero new ones in the second.
    expect(first.lockAcquisitions).toBe(1);
    expect(second.lockAcquisitions).toBe(0);

    // Reset lifetime: FILE, not slot.
    expect(second.sentinelSeen).toBe(false);
    expect(second.canonicalSeedOk).toBe(true);
    expect(second.migrationCount).toBe(first.migrationCount);
  }, 240_000); // Child Vitest boot + cold slot bootstrap (CREATE DATABASE +
  // migrate + seed + Fastify) twice over. Not a 5s-scale test.

  afterAll(
    async () => {
      // Dedicated slot DB is disposable evidence: drop it, then the tmpdir.
      await dropDatabaseIfExists(
        withDatabaseName(resolveTestDbUrl(), "postgres"),
        expectedSlotDbName,
        { keepMissing: true },
      ).catch(() => {
        /* best-effort; exam_test_w* are disposable per contract */
      });
      await rm(workDir, { recursive: true, force: true });
    },
    // DROP DATABASE under the shared lifecycle lock.
    30_000,
  );
});
