/**
 * executeInTransaction retry contract — deterministic real-PostgreSQL owners.
 *
 * The wrapper (src/types.ts) classifies 40001 (serialization_failure) and
 * 40P01 (deadlock_detected) as transient and retries the whole transaction
 * with bounded backoff; every other SQLSTATE propagates on the first attempt.
 * Before this file the contract existed only in comments: the 40001 path is
 * owned compositionally by the gated API race proofs (e.g. the misconduct
 * Matrix A ">=2 primary txids" assertion), but no test forced a real 40P01,
 * and the non-retryable propagation had no direct owner.
 *
 * Deadlock schedule (two physical connections on one isolated schema):
 *   T1 parks pre-commit holding row_a. T2 holds a row lock on row_b, then
 *   parks BEFORE its row_a request. T1 is released first and OBSERVED
 *   waiting on T2's row_b transactionid via pg_locks (bounded predicate
 *   poll — no fixed sleep); only then is T2 released to complete the cycle
 *   on row_a. BOTH participants are wrapped in executeInTransaction, and
 *   each callback records its attempts' SQLSTATEs, so a wrong retry
 *   classification (or a second, unintended retryable error) fails the
 *   oracle explicitly instead of only perturbing the attempt count.
 *
 * INVARIANT (victim attribution): PostgreSQL runs at most ONE deadlock
 * check per lock wait — a waiter's deadlock_timeout fires once, and a
 * check that finds no cycle does not re-arm (measured: with the default
 * 1s, a contender that queues >1s after the victim's first wait is the
 * one blamed; the flip boundary equals deadlock_timeout exactly). The
 * victim is therefore whichever waiter first runs its check AFTER the
 * cycle is complete — normally the first waiter (T1), but a stall longer
 * than deadlock_timeout between the gate opening and T2's row_a request
 * landing (CI event-loop starvation under coverage + parallel workers;
 * this exact mechanism failed Package coverage in #960) makes T2's own
 * check the first to see the cycle and T2 the victim. The fixture must
 * not depend on that choice: both sides are wrapped, so whichever
 * transaction PostgreSQL aborts with the real 40P01 exercises the
 * whole-callback retry contract, and the oracle accepts exactly one
 * blamed side with exactly one 40P01 while the other completes on
 * attempt 1. Both directions are pinned: no stall → T1 blamed; a stall
 * > deadlock_timeout inside T2's callback → T2 blamed; both GREEN.
 *
 * INVARIANT (ordering edge): the contender takes row locks only and
 * WRITES NOTHING (`SELECT ... FOR UPDATE` on row_b and row_a). The
 * victim's `UPDATE row_b` still really blocks behind the contender's
 * row_b lock and the cycle still really ends in a 40P01 — but because
 * the contender never creates a new row version, the victim's retry
 * snapshot cannot version-conflict with it under ANY interleaving, no
 * matter how late the contender's commit lands relative to the wrapper's
 * 20ms backoff. Two consequences keep that edge intact: the contender's
 * own retry after a blame is a deliberate no-op (the cycle is already
 * broken; re-locking would expose the retry's REPEATABLE READ snapshot
 * to a 40001 if the victim's commit lands after it, and the retry
 * contract under test needs no further locks), and any contender that
 * writes a row the victim's retry also writes breaks this invariant: a
 * retry whose snapshot was taken while that writer was still uncommitted
 * then fails with 40001 and flips the oracle to a third attempt.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getIsolatedTestDb } from "./testDb.js";
import { createDatabase, type DatabaseConnection } from "./database.js";
import { executeInTransaction, type Database } from "./types.js";
import { schema } from "./schema/pg.js";

/** Walks an error's `cause` chain for the first PostgreSQL SQLSTATE code. */
function extractSqlState(err: unknown): string | undefined {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9][0-9A-Z]{4}$/.test(code)) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

describe("executeInTransaction retry contract (real PostgreSQL)", () => {
  let iso: Awaited<ReturnType<typeof getIsolatedTestDb>>;
  let db: Database;
  let conn2: DatabaseConnection;
  // Dedicated probe pool: the fixture db and conn2 are max:1 pools whose only
  // connections are occupied by the parked victim / blocked contender, so
  // pg_locks observation must never share them.
  let probe: DatabaseConnection;
  const orgA = randomUUID();
  const orgB = randomUUID();

  beforeAll(async () => {
    iso = await getIsolatedTestDb("txretry");
    db = iso.db;
    conn2 = await createDatabase(iso.databaseUrl, iso.schemaName);
    probe = await createDatabase(iso.databaseUrl, iso.schemaName);
    const now = new Date();
    for (const id of [orgA, orgB]) {
      await db.insert(schema.organizations).values({
        id,
        name: `txretry-${id.slice(0, 8)}`,
        displayName: "before",
        slug: `txretry-${id.slice(0, 8)}`,
        createdAt: now,
        updatedAt: now,
      });
    }
  }, 30_000);

  afterAll(async () => {
    await probe?.sql.end();
    await conn2?.sql.end();
    await iso?.cleanup();
  }, 30_000);

  it("retries a real 40P01 deadlock to completion (bounded, whole-callback)", async () => {
    let attempts = 0;
    const attemptErrors: Array<{
      attempt: number;
      sqlstate?: string | undefined;
    }> = [];
    let rowAParkUsed = false;
    let signalT1Parked = () => {};
    const t1Parked = new Promise<void>((r) => {
      signalT1Parked = r;
    });
    let releaseT1 = () => {};
    const t1Release = new Promise<void>((r) => {
      releaseT1 = r;
    });

    const victim = executeInTransaction(db, async (tx) => {
      attempts += 1;
      const attempt = attempts;
      try {
        // Attempt-tagged write: if the aborted attempt left residue, the final
        // value would betray it (rollback is part of the retry contract).
        await tx.execute(
          sql`UPDATE organizations SET display_name = ${`t1-attempt-${attempts}`}, updated_at = now()
              WHERE id = ${orgA}`,
        );
        if (!rowAParkUsed) {
          rowAParkUsed = true;
          signalT1Parked();
          await t1Release;
        }
        await tx.execute(
          sql`UPDATE organizations SET display_name = 't1', updated_at = now()
              WHERE id = ${orgB}`,
        );
        return "t1-done" as const;
      } catch (err) {
        // Observability: the retry contract is keyed on SQLSTATE, so the
        // oracle asserts WHICH transient error each retry followed, not just
        // how many attempts ran.
        attemptErrors.push({ attempt, sqlstate: extractSqlState(err) });
        throw err;
      }
    });

    let contenderXid = "";
    let openT2Gate = () => {};
    const t2Gate = new Promise<void>((r) => {
      openT2Gate = r;
    });
    let signalT2LockedB = (_xid: string) => {};
    const t2LockedB = new Promise<string>((r) => {
      signalT2LockedB = r;
    });
    let t2Attempts = 0;
    const t2Errors: Array<{ attempt: number; sqlstate?: string | undefined }> =
      [];

    // The contender is wrapped too (INVARIANT victim attribution above):
    // whichever side PostgreSQL blames, the 40P01 lands on an
    // executeInTransaction callback and is retried whole-callback instead of
    // escaping the orchestration.
    const contender = executeInTransaction(conn2.db, async (tx2) => {
      t2Attempts += 1;
      const t2Attempt = t2Attempts;
      try {
        if (t2Attempt > 1) {
          // Blame-retry fast path (INVARIANT ordering edge above): the cycle
          // is already broken once this side was aborted, and re-locking
          // would expose this retry's snapshot to a possible 40001 if the
          // victim's commit lands after it. The retry contract under test
          // only needs the callback to re-run and commit.
          return;
        }
        // Lock-only participation (INVARIANT above): a real row lock that the
        // victim's row_b update must queue behind, without a contender row
        // version the retry's snapshot could conflict with.
        await tx2.execute(
          sql`SELECT id FROM organizations WHERE id = ${orgB} FOR UPDATE`,
        );
        const xidRows = (await tx2.execute(
          sql`SELECT txid_current()::text AS xid`,
        )) as Array<{ xid: string }>;
        contenderXid = xidRows[0]!.xid;
        signalT2LockedB(contenderXid);
        // Held until the victim is OBSERVED waiting on our row_b transaction,
        // so T1's (single, see the victim-attribution invariant) deadlock
        // check normally fires after the cycle is complete and T1 is blamed.
        await t2Gate;
        // Completes the deadlock cycle by QUEUEING on T1's uncommitted row_a.
        // The wait ends when the 40P01 abort of the blamed attempt releases
        // it; the surviving side commits right after.
        await tx2.execute(
          sql`SELECT id FROM organizations WHERE id = ${orgA} FOR UPDATE`,
        );
      } catch (err) {
        t2Errors.push({ attempt: t2Attempt, sqlstate: extractSqlState(err) });
        throw err;
      }
    });

    // Promise lifecycle: observe both settlements from creation. A rejection
    // must surface at the awaited call below — never as a process-level
    // unhandledRejection while the test is still awaiting the other side
    // (that window is what turned #960's victim flip into a CI failure).
    victim.catch(() => {});
    contender.catch(() => {});

    // T1 holds row_a pre-commit; T2 holds row_b, gated before its row_a
    // request. Release T1 so IT queues first (on row_b), observe that wait,
    // then let T2 complete the cycle as the second waiter.
    await t1Parked;
    await t2LockedB;
    releaseT1();
    const waiterDeadline = Date.now() + 10_000;
    for (;;) {
      const rows = (await probe.db.execute(
        sql`SELECT count(*)::int AS n FROM pg_locks
            WHERE locktype = 'transactionid'
              AND NOT granted
              AND transactionid = ${contenderXid}::xid`,
      )) as unknown as Array<{ n: number }>;
      if ((rows[0]?.n ?? 0) > 0) break;
      if (Date.now() > waiterDeadline) {
        throw new Error(
          `no pg_locks waiter appeared on contender xid ${contenderXid}; ` +
            `the deadlock schedule is broken, not slow`,
        );
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    openT2Gate();

    const result = await victim;
    await contender;

    expect(result).toBe("t1-done");
    // Exactly ONE participant is the 40P01 victim and its wrapper retries
    // the whole callback to completion; WHICH one is PostgreSQL's choice
    // (victim-attribution invariant above), not a property the test may
    // assume. Both branches verify the same contract: exactly one real
    // 40P01, exactly one whole-callback retry, no other transient error.
    const t1Blamed = attempts === 2;
    expect(t1Blamed !== (t2Attempts === 2)).toBe(true);
    if (t1Blamed) {
      // Normal schedule: T1 queued first and ran the cycle-completing check.
      expect(attemptErrors).toEqual([{ attempt: 1, sqlstate: "40P01" }]);
      expect(t2Attempts).toBe(1);
      expect(t2Errors).toEqual([]);
    } else {
      // The contender queued after T1's single deadlock check (a stall
      // longer than deadlock_timeout between the gate and T2's row_a
      // request) and was blamed instead; the retry contract is exercised
      // on the contender side.
      expect(t2Errors).toEqual([{ attempt: 1, sqlstate: "40P01" }]);
      expect(attempts).toBe(1);
      expect(attemptErrors).toEqual([]);
    }

    // Both durable effects survived; the aborted attempt left no residue.
    const after = await db
      .select({
        id: schema.organizations.id,
        displayName: schema.organizations.displayName,
      })
      .from(schema.organizations);
    const byId = new Map(after.map((r) => [r.id, r.displayName]));
    expect(byId.get(orgA)).toBe(t1Blamed ? "t1-attempt-2" : "t1-attempt-1");
    expect(byId.get(orgB)).toBe("t1");
  }, 30_000);

  it("does NOT retry a unique violation (permanent conflict propagates on attempt 1)", async () => {
    let attempts = 0;
    const dupId = randomUUID();

    await expect(
      executeInTransaction(db, async (tx) => {
        attempts += 1;
        await tx.insert(schema.organizations).values({
          id: dupId,
          name: "dup",
          displayName: "dup",
          slug: `txretry-dup-${dupId.slice(0, 8)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        // Real 23505 inside the same transaction: primary-key collision.
        await tx.insert(schema.organizations).values({
          id: dupId,
          name: "dup2",
          displayName: "dup2",
          slug: `txretry-dup2-${dupId.slice(0, 8)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return "unreachable";
      }),
    ).rejects.toThrowError();

    expect(attempts).toBe(1);
    // The first insert rolled back with the failed transaction.
    const rows = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations);
    expect(rows.find((r) => r.id === dupId)).toBeUndefined();
  }, 30_000);
});
