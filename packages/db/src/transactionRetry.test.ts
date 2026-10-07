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
 *   T1 (victim, wrapped) parks pre-commit holding row_a. T2 (raw sql.begin,
 *   NOT wrapped) holds a row lock on row_b, then parks BEFORE its row_a
 *   request. T1 is released first and OBSERVED waiting on T2's row_b
 *   transactionid via pg_locks (bounded predicate poll — no fixed sleep);
 *   only then is T2 released to complete the cycle on row_a. Deadlock blame
 *   goes to whichever waiter queued FIRST (its deadlock_timeout elapses
 *   first while the cycle is complete), so T1 — the wrapped transaction — is
 *   deterministically the one aborted with 40P01. The callback records each
 *   attempt's SQLSTATE, so a wrong retry classification (or a second,
 *   unintended retryable error) fails the oracle explicitly instead of only
 *   perturbing the attempt count. If PostgreSQL ever blamed T2 instead, T2
 *   (unwrapped) would surface 40P01 and this test fails loudly — the blame
 *   rule is stable PG behavior, not a timing assumption.
 *
 * INVARIANT (ordering edge): the contender takes row locks only and
 * WRITES NOTHING (`SELECT ... FOR UPDATE` on row_b and row_a). The victim's
 * `UPDATE row_b` still really blocks behind the contender's row_b lock and
 * the cycle still really ends in a 40P01 — but because the contender never
 * creates a new row version, the retry attempt's REPEATABLE READ snapshot
 * cannot version-conflict with it under ANY interleaving, no matter how
 * late the contender's commit lands relative to the wrapper's 20ms backoff.
 * A contender that writes any row the retry callback also writes breaks
 * this: a retry whose snapshot was taken while the contender was still
 * uncommitted then fails with 40001 on the contender-written row and flips
 * the oracle to attempts == 3 under package-level concurrency.
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

    const contender = conn2.sql.begin(async (tx2) => {
      // Lock-only participation (INVARIANT above): a real row lock that the
      // victim's row_b update must queue behind, without a contender row
      // version the retry's snapshot could conflict with.
      await tx2`SELECT id FROM organizations WHERE id = ${orgB} FOR UPDATE`;
      const xidRows = (await tx2`SELECT txid_current()::text AS xid`) as Array<{
        xid: string;
      }>;
      contenderXid = xidRows[0]!.xid;
      signalT2LockedB(contenderXid);
      // Held until the victim is OBSERVED waiting on our row_b transaction —
      // deadlock blame goes to whichever waiter queued FIRST (its
      // deadlock_timeout elapses first), so the victim must be the earlier
      // waiter for the wrapped retry to be the exercised path.
      await t2Gate;
      // Completes the deadlock cycle by QUEUEING on T1's uncommitted row_a.
      // The wait ends when the 40P01 abort of T1's first attempt releases
      // it; T2 commits right after.
      await tx2`SELECT id FROM organizations WHERE id = ${orgA} FOR UPDATE`;
    });

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
    expect(attempts).toBe(2);
    // Exactly one transient failure — the owned 40P01 — drove the retry.
    expect(attemptErrors).toEqual([{ attempt: 1, sqlstate: "40P01" }]);

    // Both durable effects survived; the aborted attempt left no residue.
    const after = await db
      .select({
        id: schema.organizations.id,
        displayName: schema.organizations.displayName,
      })
      .from(schema.organizations);
    const byId = new Map(after.map((r) => [r.id, r.displayName]));
    expect(byId.get(orgA)).toBe("t1-attempt-2");
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
