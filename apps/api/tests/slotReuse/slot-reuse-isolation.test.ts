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

/**
 * Round-3 slot-reuse isolation proof — PARENT orchestrator.
 *
 * The new pool-slot architecture deliberately reuses ONE physical database
 * between sequential test files assigned to the same slot. Round-2 proved
 * only NAME/cardinality reuse; this test proves DATA isolation across the
 * sequential reuse, against real PostgreSQL:
 *
 *   stage A (child Vitest run, process 1): buildTestApp on the slot DB,
 *     write a unique sentinel business row, close normally.
 *   stage B (LATER child Vitest run, process 2): SAME resolved slot DB,
 *     enters through the same canonical buildTestApp path, must reset before
 *     observing business state, must not see A's sentinel, must see the
 *     canonical seed, must retain migration metadata.
 *
 * The parent controls sequencing explicitly (await stage A's exit, then run
 * stage B) — no reliance on harness file ordering. Both children run SERIALLY
 * (no API_TEST_MAX_WORKERS) with a per-invocation TEST_WORKER_ID so the slot
 * DB under test (exam_test_w<id>) is dedicated to this proof and can never
 * collide with the outer run's own slot databases (which matter when the
 * outer run itself is parallel, e.g. CI maxWorkers=4).
 *
 * Mutation-demonstrated (round-3 validation): removing the one-time truncate
 * boundary in buildTestApp (workerDbTruncated / adapter.resetPostgres) makes
 * stage B observe stage A's sentinel and fail.
 */
const __dirname = fileURLToPath(new URL(".", import.meta.url));

const API_DIR = join(__dirname, "../..");
const VITEST_BIN = join(API_DIR, "node_modules/.bin/vitest");

interface Handoff {
  stageADone?: boolean;
  stageBDone?: boolean;
  databaseName?: string;
  stageBDatabaseName?: string;
  poolId?: string | null;
  stageBPoolId?: string | null;
  sentinelCode?: string;
  migrationCount?: number;
}

const workDir = await mkdtemp(join(tmpdir(), "slot-reuse-"));
const handoffPath = join(workDir, "handoff.json");
// Dedicated slot id for this invocation: charset-safe, unique per run, well
// under the 63-char identifier limit once prefixed with exam_test_w.
const slotWorkerId = `sr${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;

function childEnv(stage: "A" | "B"): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Serial child run: defined-but-empty resolves to serial, and
  // vitest.config only seeds env-file values for keys that are still
  // undefined — deleting would let .env.test.local's API_TEST_MAX_WORKERS
  // slip back in and trip the TEST_WORKER_ID x parallel guard.
  env.API_TEST_MAX_WORKERS = "";
  // The child runner injects its own runner ids; do not leak the parent's.
  delete env.VITEST_POOL_ID;
  delete env.VITEST_WORKER_ID;
  // Dedicated slot DB for this proof (documented serial-debug override).
  env.TEST_WORKER_ID = slotWorkerId;
  env.TEST_DB_ISOLATION = "worker-database";
  env.SLOT_REUSE_STAGE = stage;
  env.SLOT_REUSE_HANDOFF = handoffPath;
  return env;
}

function runStage(stage: "A" | "B"): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      VITEST_BIN,
      ["run", `tests/slotReuse/stage${stage}.fixture.test.ts`],
      { cwd: API_DIR, env: childEnv(stage) },
    );
    let output = "";
    child.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      output += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

describe("slot-reuse data isolation (sequential files, same pool slot)", () => {
  it("stage B on the same slot DB sees no stage-A sentinel, only canonical state", async () => {
    const a = await runStage("A");
    expect(a.code, `stage A child failed:\n${a.output.slice(-4000)}`).toBe(0);

    const b = await runStage("B");
    expect(b.code, `stage B child failed:\n${b.output.slice(-4000)}`).toBe(0);

    const handoff: Handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    // Both stages really targeted the SAME physical slot database and both
    // completed their assertions (each child exits non-zero on failure).
    expect(handoff.stageADone).toBe(true);
    expect(handoff.stageBDone).toBe(true);
    expect(handoff.databaseName).toBe(`exam_test_w${slotWorkerId}`);
    expect(handoff.stageBDatabaseName).toBe(handoff.databaseName);
    expect(handoff.poolId).toBe("1");
    expect(handoff.stageBPoolId).toBe("1");
    expect(handoff.migrationCount ?? 0).toBeGreaterThan(0);
  }, // DATABASE + migrate + seed + Fastify). Not a 5s-scale test. // Two child Vitest boots + two full buildTestApp bootstraps (CREATE
  240_000);

  afterAll(
    async () => {
      // Dedicated slot DB is disposable evidence: drop it, then the tmpdir.
      await dropDatabaseIfExists(
        withDatabaseName(resolveTestDbUrl(), "postgres"),
        `exam_test_w${slotWorkerId}`,
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
