/**
 * Scoped handler closure retention (#964 W2 follow-up): the plugin's
 * scoped-closure dedup MUST NOT strongly retain the per-transaction handler
 * closures postgres.js mints for every `sql.begin`/savepoint scope.
 *
 * Why this is a real boundary (postgres.js 3.4.9 source): `begin()` →
 * `scope()` builds `Sql(handler)` with a fresh `handler` function whose
 * context chain holds the per-tx queue, `uncaughtError`, and the caller's
 * transaction body `fn` — so a strong dedup set retains a slice of every
 * finished transaction for the process lifetime (unbounded in transaction
 * count). The fix keeps membership in a WeakSet; counting semantics are
 * pinned by the main suite, this file pins recyclability.
 *
 * Evidence discipline: collection is asserted WITHIN A BUDGET of full-GC
 * rounds (never "GC happens to run at one exact point"), and only when
 * `--expose-gc` is available — otherwise the recyclability test skips:
 *
 *   NODE_OPTIONS=--expose-gc pnpm --filter @exam/otel-drizzle-postgresjs test:retention
 *
 * The direction is what makes this a regression test: a strong retainer
 * (the pre-fix Set) NEVER releases, so the assertion fails deterministically
 * on that code and passes once the objects are actually unreachable.
 *
 * The second describe is the repeatable before/after experiment (guarded by
 * EXAM_DB_TELEMETRY_RETENTION_PROBE=1, like the benchmark): a long mixed
 * transaction loop whose tx bodies capture a 64 KB buffer (the real-world
 * shape — `fn` captures request-scoped state), measuring retained heap at
 * checkpoints, a WeakRef cohort's survival, and per-tx CPU:
 *
 *   NODE_OPTIONS=--expose-gc EXAM_DB_TELEMETRY_RETENTION_PROBE=1 \
 *     pnpm --filter @exam/otel-drizzle-postgresjs probe:retention
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import { getIsolatedTestDb } from "@exam/db/testDb";
import { executeInTransaction } from "@exam/db/types";
import { schema } from "@exam/db/schema/pg";
import { installOtelDbTelemetry } from "./index.js";
import { deltaDiagnostics } from "./testHelpers.js";

/** The marker query's handler field — the scoped closure under test. */
interface HandlerCarrier {
  readonly handler: object;
}

const gc = (globalThis as { gc?: () => void }).gc;
const withGc = typeof gc === "function" ? it : it.skip;
if (typeof gc !== "function") {
  process.stdout.write(
    "[scopedClosureRetention] INFO: global gc not exposed — " +
      "recyclability test skipped (run with NODE_OPTIONS=--expose-gc).\n",
  );
}

const PROBE_ENABLED = process.env.EXAM_DB_TELEMETRY_RETENTION_PROBE === "1";
const probe = PROBE_ENABLED ? describe : describe.skip;

/** Runs one raw `sql.begin` round trip, returning a WeakRef to its handler. */
async function captureScopedHandlerRef(
  sql: postgres.Sql,
): Promise<WeakRef<object>> {
  let ref: WeakRef<object> | null = null;
  await sql.begin(async (scoped) => {
    // Consumed (not just created) so the seam observer actually sees the
    // closure — the production dedup path.
    const marker = scoped.unsafe("select 1::int as one");
    ref = new WeakRef((marker as unknown as HandlerCarrier).handler);
    await marker;
  });
  return ref!;
}

describe("scoped closure retention (real PostgreSQL)", () => {
  let iso: Awaited<ReturnType<typeof getIsolatedTestDb>>;
  let sql: postgres.Sql;
  let handle: ReturnType<typeof installOtelDbTelemetry>;

  beforeAll(async () => {
    iso = await getIsolatedTestDb("otelw22ret");
    await iso.db.insert(schema.organizations).values({
      id: randomUUID(),
      name: "otelw22ret-a",
      displayName: "otelw22ret-a",
      slug: "otelw22ret-a",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    sql = postgres(iso.databaseUrl!, {
      max: 3,
      connection: { search_path: iso.schemaName },
    });
    // Pool warmup BEFORE install (first-connection pg_type fetch stays out
    // of the cohort and the diagnostics windows).
    await sql.unsafe("select 1");
    handle = installOtelDbTelemetry();
    handle.registerRootConnection(sql);
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await iso?.cleanup();
  }, 30_000);

  it("scoped closures of settled transactions are counted once and classified transaction", async () => {
    const before = handle.diagnostics();
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < 3; i += 1) {
      refs.push(await captureScopedHandlerRef(sql));
    }
    expect(refs.length).toBe(3);
    // Per raw begin: BEGIN rides the root pool, select + commit ride the
    // scoped closure — 3 submissions, 1 root, 2 transaction, ONE closure.
    const delta = deltaDiagnostics(before, handle.diagnostics());
    expect(delta.submissions).toBe(9);
    expect(delta.settles).toBe(9);
    expect(delta.byRole).toEqual({ root: 3, transaction: 6 });
    expect(delta.scopedClosures).toBe(3);
  }, 30_000);

  withGc(
    "scoped handler closures become collectable once their transactions settled",
    async () => {
      const refs: WeakRef<object>[] = [];
      for (let i = 0; i < 8; i += 1) {
        refs.push(await captureScopedHandlerRef(sql));
      }
      expect(handle.diagnostics().scopedClosures).toBeGreaterThan(0);

      // Collection is required WITHIN the budget of full-GC rounds, not at a
      // fixed point; a strong retainer never releases at any round.
      let collected = 0;
      for (let round = 0; round < 12 && collected < refs.length; round += 1) {
        gc!();
        gc!();
        await new Promise((resolve) => setImmediate(resolve));
        collected = refs.filter((r) => r.deref() === undefined).length;
      }
      expect(collected).toBe(refs.length);
    },
    60_000,
  );
});

probe("retention probe: long transaction loop (before/after evidence)", () => {
  let iso: Awaited<ReturnType<typeof getIsolatedTestDb>>;
  let sql: postgres.Sql;
  let handle: ReturnType<typeof installOtelDbTelemetry>;

  const DRIZZLE_TX_ROUNDS = 300;
  const COHORT_EVERY = 10; // raw begin with a WeakRef every N rounds
  const CAPTURED_BUFFER_KB = 64;

  beforeAll(async () => {
    iso = await getIsolatedTestDb("otelw22retprobe");
    await iso.db.insert(schema.organizations).values({
      id: randomUUID(),
      name: "otelw22retprobe-a",
      displayName: "otelw22retprobe-a",
      slug: "otelw22retprobe-a",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    sql = postgres(iso.databaseUrl!, {
      max: 3,
      connection: { search_path: iso.schemaName },
    });
    await sql.unsafe("select 1");
    handle = installOtelDbTelemetry();
    handle.registerRootConnection(sql);
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await iso?.cleanup();
  }, 30_000);

  it("measures retained heap, cohort survival, and CPU across the loop", async () => {
    const db = drizzle(sql, { schema });
    const cohort: WeakRef<object>[] = [];
    const quiesceHeap = (): number => {
      if (typeof gc === "function") {
        gc();
        gc();
      }
      return process.memoryUsage().heapUsed;
    };
    const runRounds = async (count: number, offset: number): Promise<void> => {
      for (let i = 0; i < count; i += 1) {
        // The tx body closes over a distinct buffer — the real-world shape
        // (fn captures request-scoped state) that makes the retention chain
        // measurable instead of noise-level.
        const captured = Buffer.alloc(CAPTURED_BUFFER_KB * 1024, offset + i);
        await executeInTransaction(db, async (tx) => {
          await tx.execute(
            drizzleSql`update organizations set updated_at = now() where slug = 'otelw22retprobe-a'`,
          );
          void captured;
        });
        if ((offset + i) % COHORT_EVERY === 0) {
          cohort.push(await captureScopedHandlerRef(sql));
        }
      }
    };

    const checkpoint = (
      phase: string,
      cpuStart: ReturnType<typeof process.cpuUsage>,
      wallStart: number,
      txCount: number,
    ) => {
      const heapUsed = quiesceHeap();
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage(cpuStart);
      const line = {
        phase,
        txRounds: txCount,
        capturedBufferKbPerTx: CAPTURED_BUFFER_KB,
        cohortRefs: cohort.length,
        cohortAlive: cohort.filter((r) => r.deref() !== undefined).length,
        heapUsedBytes: heapUsed,
        // The 64 KB captured buffers live in external (ArrayBuffer) memory —
        // heapUsed alone would hide exactly the retention being measured.
        externalBytes: mem.external,
        rssBytes: mem.rss,
        cpuUserMs: Math.round(cpu.user / 1000) / 1000,
        cpuSystemMs: Math.round(cpu.system / 1000) / 1000,
        wallMs: Math.round((performance.now() - wallStart) * 100) / 100,
        scopedClosuresTotal: handle.diagnostics().scopedClosures,
        gcExposed: typeof gc === "function",
      };
      const out =
        process.env.EXAM_DB_TELEMETRY_RETENTION_OUT ??
        path.join(
          fileURLToPath(new URL("../../../..", import.meta.url)),
          "out/otel-w964/retention-fix/retention-probe.jsonl",
        );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.appendFileSync(out, `${JSON.stringify(line)}\n`);
      process.stdout.write(`[retention-probe] ${JSON.stringify(line)}\n`);
    };

    await runRounds(20, -20); // warmup outside every window
    cohort.length = 0;

    let cpuStart = process.cpuUsage();
    let wallStart = performance.now();
    await runRounds(DRIZZLE_TX_ROUNDS / 2, 0);
    checkpoint("first-half", cpuStart, wallStart, DRIZZLE_TX_ROUNDS / 2);

    cpuStart = process.cpuUsage();
    wallStart = performance.now();
    await runRounds(DRIZZLE_TX_ROUNDS / 2, DRIZZLE_TX_ROUNDS / 2);
    checkpoint("second-half", cpuStart, wallStart, DRIZZLE_TX_ROUNDS / 2);

    // Counter semantics hold across the whole loop: one scoped closure per
    // drizzle tx + one per raw cohort begin.
    const expectedClosures = DRIZZLE_TX_ROUNDS + cohort.length;
    expect(handle.diagnostics().scopedClosures).toBeGreaterThanOrEqual(
      expectedClosures,
    );
    // Cohort survival AFTER quiesce is reported, not asserted here: the
    // deterministic recyclability contract is the withGc test above.
  }, 300_000);
});
