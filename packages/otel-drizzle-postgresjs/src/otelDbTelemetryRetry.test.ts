/**
 * Retry observability on REAL 40001/40P01 through the plugin (#964 W2).
 *
 * Reuses the proven deterministic schedules:
 * - 40001: the W2.1 probe's RR-snapshot gate (W2.1 §2.5 S7) — the victim
 *   takes its REPEATABLE READ snapshot with a SELECT, parks until a
 *   concurrent writer on a second pool has COMMITTED, and its UPDATE then
 *   fails with a real serialization_failure; the wrapper retries the whole
 *   callback to success.
 * - 40P01: packages/db/src/transactionRetry.test.ts's deadlock schedule
 *   (T1 parks pre-commit holding row_a; T2 holds row_b and is gated before
 *   its row_a request; bounded pg_locks polling proves the wait before the
 *   cycle completes). Victim attribution belongs to PostgreSQL — the oracle
 *   accepts exactly one blamed side, so statement COUNTS are not asserted
 *   for this scenario (they differ by victim), only the error count.
 *
 * Assertions: ONE logical span per executeInTransaction call, attempt spans
 * as siblings under it (2 on a retried side), exactly one transaction.retry
 * event carrying failedAttempt + SQLSTATE, the failed attempt span and its
 * statement span carry the SQLSTATE, the existing transactionRetryLogger
 * stdout contract is unchanged, and business results match the
 * retry-to-completion contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { SpanStatusCode } from "@opentelemetry/api";
import { getIsolatedTestDb } from "@exam/db/testDb";
import { createDatabase } from "@exam/db/database";
import {
  executeInTransaction,
  setTransactionRetryLogger,
} from "@exam/db/types";
import { schema } from "@exam/db/schema/pg";
import { setTransactionSeam } from "@exam/db/observation";
import {
  deltaDiagnostics,
  inScenario,
  parentSpanIdOf,
  startSpanCapture,
} from "./testHelpers.js";
import { installOtelDbTelemetry, type OtelDbTelemetryHandle } from "./index.js";

interface RecordedWarn {
  obj: Record<string, unknown>;
  msg: string;
}

describe("retry observability through the plugin (real 40001 / 40P01)", () => {
  let iso: Awaited<ReturnType<typeof getIsolatedTestDb>>;
  let probe: Awaited<ReturnType<typeof createDatabase>>;
  let conn2: Awaited<ReturnType<typeof createDatabase>>;
  let capture: ReturnType<typeof startSpanCapture>;
  let handle: OtelDbTelemetryHandle;
  let retryWarns: RecordedWarn[] = [];
  const orgA = randomUUID();
  const orgB = randomUUID();

  beforeAll(async () => {
    iso = await getIsolatedTestDb("otelw22retry");
    probe = await createDatabase(iso.databaseUrl!, iso.schemaName);
    conn2 = await createDatabase(iso.databaseUrl!, iso.schemaName);
    const now = new Date();
    for (const [id, n] of [
      [orgA, "otelw22retry-a"],
      [orgB, "otelw22retry-b"],
    ] as const) {
      await iso.db.insert(schema.organizations).values({
        id,
        name: n,
        displayName: n,
        slug: n,
        createdAt: now,
        updatedAt: now,
      });
    }
    capture = startSpanCapture();
    // The plugin observes the whole process once installed; the harness
    // pools are unregistered (transaction role). Every retry assertion is
    // scoped to its scenario trace and diagnostics DELTA, so harness noise
    // never enters an expectation.
    handle = installOtelDbTelemetry();
    setTransactionSeam(handle.transactionSeam);
    // POOL WARMUP outside scenarios (pg_type fetch on first connection per
    // pool — see the main suite): keeps the delta assertions statement-exact.
    await probe.sql.unsafe("select 1");
    await conn2.sql.unsafe("select 1");
  }, 60_000);

  afterAll(async () => {
    setTransactionSeam(null);
    setTransactionRetryLogger(null);
    await probe?.sql.end();
    await conn2?.sql.end();
    await iso?.cleanup();
  }, 30_000);

  it("real 40001: whole-callback retry surfaces as sibling attempt spans + one retry event under the same logical parent", async () => {
    retryWarns = [];
    setTransactionRetryLogger({
      warn: (obj, msg) => retryWarns.push({ obj, msg }),
    });
    let attempts = 0;
    let snapshotTaken = () => {};
    const snapshot = new Promise<void>((r) => {
      snapshotTaken = r;
    });
    let openT2CommittedGate = () => {};
    const t2Committed = new Promise<void>((r) => {
      openT2CommittedGate = r;
    });

    const before = handle.diagnostics();
    const { result, spans } = await inScenario(
      capture,
      "retry-40001",
      async () => {
        const victim = executeInTransaction(iso.db, async (tx) => {
          attempts += 1;
          const rows = (await tx.execute(
            drizzleSql`select display_name from organizations where id = ${orgA}`,
          )) as unknown as Array<{ display_name: string }>;
          if (attempts === 1) {
            // RR snapshot taken by the SELECT above; park until the concurrent
            // writer has committed, then the UPDATE hits the conflict.
            snapshotTaken();
            await t2Committed;
          }
          await tx.execute(
            drizzleSql`update organizations set display_name = ${`t1-attempt-${attempts}`} where id = ${orgA}`,
          );
          void rows;
          return "t1-done" as const;
        });
        victim.catch(() => {});

        // Concurrent committed writer on a separate pool, coordinated inside
        // the scenario so every related span lands on one trace.
        await snapshot;
        await executeInTransaction(probe.db, async (tx2) => {
          await tx2.execute(
            drizzleSql`update organizations set display_name = 't2-writer' where id = ${orgA}`,
          );
          return "t2-done" as const;
        });
        openT2CommittedGate();

        const outcome = await victim;
        return { outcome };
      },
    );

    expect(result.outcome).toBe("t1-done");
    expect(attempts).toBe(2);
    expect(retryWarns).toEqual([
      { obj: { attempt: 1, sqlstate: "40001" }, msg: "transaction retry" },
    ]);

    const scenarioSpans = spans();
    // TWO logical transactions share the scenario trace (victim + concurrent
    // writer); the retry event identifies the victim's logical span.
    const logicals = scenarioSpans.filter((s) => s.name === "db.transaction");
    expect(logicals.length).toBe(2);
    const withRetry = logicals.filter((l) =>
      l.events.some((e) => e.name === "transaction.retry"),
    );
    expect(withRetry.length).toBe(1);
    const logical = withRetry[0]!;
    expect(logical.status.code).toBe(SpanStatusCode.UNSET); // retried to success
    const retryEvents = logical.events.filter(
      (e) => e.name === "transaction.retry",
    );
    expect(retryEvents.length).toBe(1);
    expect(
      (retryEvents[0]!.attributes ?? {})["exam.db.tx.retry.failed_attempt"],
    ).toBe(1);
    expect((retryEvents[0]!.attributes ?? {})["db.response.status_code"]).toBe(
      "40001",
    );
    // the writer's transaction retried nothing
    const writerLogical = logicals.find((l) => l !== logical)!;
    expect(
      writerLogical.events.filter((e) => e.name === "transaction.retry").length,
    ).toBe(0);

    const attemptSpans = scenarioSpans.filter(
      (s) =>
        s.name === "db.transaction.attempt" &&
        parentSpanIdOf(s) === logical.spanContext().spanId,
    );
    expect(attemptSpans.length).toBe(2);
    for (const attempt of attemptSpans) {
      // same logical parent — the retry stays under one logical transaction
      expect(parentSpanIdOf(attempt)).toBe(logical.spanContext().spanId);
    }
    const [first, second] = attemptSpans;
    expect(first!.attributes["exam.db.tx.attempt"]).toBe(0);
    expect(first!.status.code).toBe(SpanStatusCode.ERROR);
    expect(first!.attributes["db.response.status_code"]).toBe("40001");
    expect(second!.attributes["exam.db.tx.attempt"]).toBe(1);
    expect(second!.status.code).toBe(SpanStatusCode.UNSET);

    // the failing UPDATE statement itself carries the SQLSTATE
    const failedStatements = scenarioSpans.filter(
      (s) =>
        s.name === "db.statement" && s.status.code === SpanStatusCode.ERROR,
    );
    expect(failedStatements.length).toBe(1);
    expect(failedStatements[0]!.attributes["db.response.status_code"]).toBe(
      "40001",
    );
    expect(parentSpanIdOf(failedStatements[0]!)).toBe(
      first!.spanContext().spanId,
    );

    // delta captured before the post-scenario verification read below
    const delta = deltaDiagnostics(before, handle.diagnostics());
    // victim attempt 1 (begin+set+select+update-fail+rollback = 5)
    // + writer tx (begin+set+update+commit = 4)
    // + victim attempt 2 (begin+set+select+update+commit = 5)
    expect(delta.submissions).toBe(14);
    expect(delta.errors).toBe(1);

    // final value proves the attempt-2 write landed after t2's commit
    const finalRows = (await probe.db.execute(
      drizzleSql`select display_name from organizations where id = ${orgA}`,
    )) as unknown as Array<{ display_name: string }>;
    expect(finalRows[0]!.display_name).toBe("t1-attempt-2");
  }, 30_000);

  it("real 40P01: exactly one victim, its retry under one logical parent, both transactions complete", async () => {
    retryWarns = [];
    setTransactionRetryLogger({
      warn: (obj, msg) => retryWarns.push({ obj, msg }),
    });
    let attempts = 0;
    let t2Attempts = 0;
    let rowAParkUsed = false;
    let contenderXid = "";
    let signalT1Parked = () => {};
    const t1Parked = new Promise<void>((r) => {
      signalT1Parked = r;
    });
    let releaseT1 = () => {};
    const t1Release = new Promise<void>((r) => {
      releaseT1 = r;
    });
    let openT2Gate = () => {};
    const t2Gate = new Promise<void>((r) => {
      openT2Gate = r;
    });
    let signalT2LockedB = (xid: string) => {};
    const t2LockedB = new Promise<string>((r) => {
      signalT2LockedB = r;
    });

    const before = handle.diagnostics();
    const { result, spans } = await inScenario(
      capture,
      "retry-40p01",
      async () => {
        // Both participants are wrapped (victim-attribution invariant of
        // transactionRetry.test.ts): whichever side PostgreSQL aborts with the
        // real 40P01 exercises the whole-callback retry contract.
        const victim = executeInTransaction(iso.db, async (tx) => {
          attempts += 1;
          try {
            await tx.execute(
              drizzleSql`update organizations set display_name = ${`t1-attempt-${attempts}`} where id = ${orgA}`,
            );
            if (!rowAParkUsed) {
              rowAParkUsed = true;
              signalT1Parked();
              await t1Release;
            }
            // queues behind T2's row_b lock → the first waiter
            await tx.execute(
              drizzleSql`update organizations set display_name = 't1' where id = ${orgB}`,
            );
            return "t1-done" as const;
          } catch (err) {
            throw err;
          }
        });

        const contender = executeInTransaction(conn2.db, async (tx2) => {
          t2Attempts += 1;
          if (t2Attempts > 1) {
            // blame-retry fast path (transactionRetry.test.ts invariant): the
            // cycle is already broken; re-locking could 40001 the snapshot.
            return;
          }
          // Lock-only participation: a real row lock the victim's row_b update
          // queues behind, without a contender row version.
          await tx2.execute(
            drizzleSql`select id from organizations where id = ${orgB} for update`,
          );
          const xidRows = (await tx2.execute(
            drizzleSql`select txid_current()::text as xid`,
          )) as unknown as Array<{ xid: string }>;
          contenderXid = xidRows[0]!.xid;
          signalT2LockedB(contenderXid);
          await t2Gate;
          // Completes the cycle by QUEUEING on T1's uncommitted row_a version.
          await tx2.execute(
            drizzleSql`select id from organizations where id = ${orgA} for update`,
          );
        });

        victim.catch(() => {});
        contender.catch(() => {});

        // T1 holds row_a pre-commit; T2 holds row_b, gated before its row_a
        // request. Release T1 so IT queues first, observe that wait via
        // pg_locks (bounded predicate poll — no fixed sleep), then complete
        // the cycle.
        await t1Parked;
        await t2LockedB;
        releaseT1();
        const waiterDeadline = Date.now() + 10_000;
        for (;;) {
          const rows = (await probe.db.execute(
            drizzleSql`select count(*)::int as n from pg_locks
              where locktype = 'transactionid' and not granted
                and transactionid = ${contenderXid}::xid`,
          )) as unknown as Array<{ n: number }>;
          if ((rows[0]?.n ?? 0) > 0) break;
          if (Date.now() > waiterDeadline) {
            throw new Error(
              "no pg_locks waiter appeared; the deadlock schedule is broken, not slow",
            );
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        openT2Gate();

        const victimOutcome = await victim;
        await contender;
        return { victimOutcome };
      },
    );

    expect(result.victimOutcome).toBe("t1-done");
    const t1Blamed = attempts === 2;
    expect(t1Blamed !== (t2Attempts === 2)).toBe(true);

    const scenarioSpans = spans();
    const logicals = scenarioSpans.filter((s) => s.name === "db.transaction");
    expect(logicals.length).toBe(2);
    const attemptSpans = scenarioSpans.filter(
      (s) => s.name === "db.transaction.attempt",
    );
    expect(attemptSpans.length).toBe(attempts + t2Attempts);
    for (const attempt of attemptSpans) {
      // each participant's attempts hang under ITS logical span
      expect(
        logicals.some(
          (l) => l.spanContext().spanId === parentSpanIdOf(attempt),
        ),
      ).toBe(true);
    }

    const allRetryEvents = logicals.flatMap((l) =>
      l.events.filter((e) => e.name === "transaction.retry"),
    );
    expect(allRetryEvents.length).toBe(1);
    expect(
      (allRetryEvents[0]!.attributes ?? {})["db.response.status_code"],
    ).toBe("40P01");
    expect(
      (allRetryEvents[0]!.attributes ?? {})["exam.db.tx.retry.failed_attempt"],
    ).toBe(1);

    const deadlockedAttempt = attemptSpans.find(
      (s) => s.status.code === SpanStatusCode.ERROR,
    )!;
    expect(deadlockedAttempt).toBeDefined();
    expect(deadlockedAttempt.attributes["db.response.status_code"]).toBe(
      "40P01",
    );

    // the stdout retry contract is unchanged: exactly one 40P01 warn
    expect(retryWarns).toEqual([
      { obj: { attempt: 1, sqlstate: "40P01" }, msg: "transaction retry" },
    ]);

    // exactly one real 40P01 statement regardless of which side was blamed
    const delta = deltaDiagnostics(before, handle.diagnostics());
    expect(delta.errors).toBe(1);
  }, 45_000);
});
