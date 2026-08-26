import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { withDatabaseName } from "./testWorkerDatabase.js";
import {
  getTestInfraLifecycleLockKey,
  resolveTestInfraCoordinationUrl,
  withTestInfraLifecycleLock,
} from "./testInfraLock.js";
import { resolveTestDbUrl } from "./testDb.js";

/**
 * ADR-007 Phase 6D — tests for the test-infra advisory lock helper.
 *
 * Layer split:
 *   - Pure-logic tests (key derivation determinism, coordination-URL
 *     normalization) — no PG service needed.
 *   - PG-integration tests (acquire/release, deferred-driven serialization
 *     with pg_locks proof, cross-database coordination, release-on-throw) —
 *     require a reachable PostgreSQL; wrapped in `PG_DESCRIBE`
 *     (describe.skip when PG is down).
 *
 * No slow stress tests live here; concurrency is manufactured inside the test
 * via deferred-driven critical sections + real pg_locks evidence, not via
 * fixed sleeps or long loops.
 */

const BASE_URL = resolveTestDbUrl();

const ADMIN_URL = withDatabaseName(BASE_URL, "postgres");

const COORD_URL = resolveTestInfraCoordinationUrl(BASE_URL);

async function pgReachable(url: string): Promise<boolean> {
  const sql = postgres(url, { connect_timeout: 2 });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

const PG_UP = await pgReachable(ADMIN_URL);
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

/**
 * One-shot deferred with a timeout, local to this test file (packages/db must
 * not import apps/api's barrier). Used to gate critical sections: the holder
 * waits on `release` while the contender waits on the advisory lock.
 */
function createDeferred<T>(label: string, timeoutMs = 30_000) {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(() => {
    reject(new Error(`Deferred timeout [${label}] after ${timeoutMs}ms`));
  }, timeoutMs);
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
  };
  return {
    promise: promise.finally(settle),
    resolve: (value: T) => {
      settle();
      resolve(value);
    },
    reject: (error: unknown) => {
      settle();
      reject(error);
    },
    isSettled: () => settled,
  };
}

/** Advisory-lock row shape as surfaced by postgres.js from pg_locks. */
interface AdvisoryLockRow {
  classid: number;
  objid: number;
  database: number;
  locktype: string;
  mode: string;
  granted: boolean;
}

/**
 * Settle every not-yet-settled deferred (resolve + clear its timer) so a
 * stuck or failed test can never leave an armed 30-second rejection timer or
 * an unawaited gate promise behind. Mirrors the barrier `dispose()` used by
 * the incident concurrency test.
 */
function disposeAll(
  ...deferreds: Array<ReturnType<typeof createDeferred<void>>>
): void {
  for (const d of deferreds) {
    if (!d.isSettled()) d.resolve();
  }
}

/**
 * Split a 64-bit advisory-lock key into its two int4 halves as PostgreSQL
 * stores them in pg_locks (classid = high 32 bits, objid = low 32 bits,
 * both signed int4).
 */
function splitLockKey(key: bigint): { classid: number; objid: number } {
  return {
    classid: Number(key >> 32n),
    objid: Number(BigInt.asIntN(32, key & 0xffffffffn)),
  };
}

/** Reconstruct the 64-bit key from pg_locks classid/objid (signed int4). */
function reconstructLockKey(row: AdvisoryLockRow): bigint {
  return (BigInt(row.classid) << 32n) | (BigInt(row.objid) & 0xffffffffn);
}

/**
 * Bounded polling of pg_locks for the given advisory-lock key on the
 * coordination database. Polls every 25ms until `predicate` holds or
 * `timeoutMs` elapses. This is NOT a sleep-for-ordering mechanism: the
 * predicate must be satisfied by REAL lock state before the test proceeds.
 */
async function pollAdvisoryLocks(
  coordUrl: string,
  key: bigint,
  predicate: (rows: AdvisoryLockRow[]) => boolean,
  timeoutMs = 15_000,
): Promise<AdvisoryLockRow[]> {
  const { classid, objid } = splitLockKey(key);
  const sql = postgres(coordUrl, { max: 1 });
  try {
    const deadline = Date.now() + timeoutMs;
    let rows: AdvisoryLockRow[] = [];
    while (Date.now() < deadline) {
      rows = (await sql`
        SELECT classid, objid, database, locktype, mode, granted
        FROM pg_locks
        WHERE locktype = 'advisory' AND classid = ${classid} AND objid = ${objid}
      `) as unknown as AdvisoryLockRow[];
      if (predicate(rows)) return rows;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `pg_locks never satisfied predicate within ${timeoutMs}ms; last rows: ${JSON.stringify(rows)}`,
    );
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// Pure-logic tests (no PG service required)
// ---------------------------------------------------------------------------

describe("testInfraLock — key derivation", () => {
  it("exposes a stable, non-zero advisory lock key", () => {
    const key = getTestInfraLifecycleLockKey();
    expect(typeof key).toBe("bigint");
    expect(key).not.toBe(0n);
  });

  it("derives the same key on every call (deterministic)", () => {
    expect(getTestInfraLifecycleLockKey()).toBe(getTestInfraLifecycleLockKey());
  });

  it("the key fits in a PostgreSQL bigint (signed 64-bit) range", () => {
    const key = getTestInfraLifecycleLockKey();
    // PostgreSQL bigint range: -9223372036854775808 .. 9223372036854775807
    expect(key >= -9223372036854775808n).toBe(true);
    expect(key <= 9223372036854775807n).toBe(true);
  });

  it("derives distinct keys per resource class (schema vs database)", () => {
    const schemaKey = getTestInfraLifecycleLockKey("schema");
    const databaseKey = getTestInfraLifecycleLockKey("database");
    // The 2026-08-26 audit fix split the single shared key by resource class
    // so a long-tail DROP DATABASE (23.4s hold) can no longer block the
    // high-frequency schema queue. Distinct keys are the structural
    // guarantee; the PG tests below prove the runtime consequence.
    expect(databaseKey).not.toBe(schemaKey);
    for (const key of [schemaKey, databaseKey]) {
      expect(key >= -9223372036854775808n).toBe(true);
      expect(key <= 9223372036854775807n).toBe(true);
    }
  });
});

describe("resolveTestInfraCoordinationUrl — canonical coordination URL", () => {
  it("normalizes exam_test / postgres / worker-db URLs to ONE coordination URL", () => {
    // The three URLs the test-infra callers historically locked on.
    const examTestUrl = BASE_URL;
    const postgresUrl = withDatabaseName(BASE_URL, "postgres");
    const workerDbUrl = withDatabaseName(BASE_URL, "exam_test_w1");

    const a = resolveTestInfraCoordinationUrl(examTestUrl);
    const b = resolveTestInfraCoordinationUrl(postgresUrl);
    const c = resolveTestInfraCoordinationUrl(workerDbUrl);

    expect(a).toBe(b);
    expect(b).toBe(c);
    const url = new URL(a);
    // The coordination database is the TEST_ADMIN_DATABASE (default postgres).
    expect(url.pathname).toBe("/postgres");
    // The three inputs really did target different databases (otherwise the
    // normalization would be vacuous).
    expect(new URL(examTestUrl).pathname).not.toBe(
      new URL(workerDbUrl).pathname,
    );
  });

  it("honors TEST_ADMIN_DATABASE as the coordination database", () => {
    const out = resolveTestInfraCoordinationUrl(BASE_URL, {
      TEST_ADMIN_DATABASE: "exam_coord",
    });
    expect(new URL(out).pathname).toBe("/exam_coord");
  });

  it("preserves credentials, host, and port from the input URL", () => {
    const input =
      "postgresql://user:p%40ss@db.internal.example:15433/exam_test";
    const out = new URL(resolveTestInfraCoordinationUrl(input));
    expect(out.protocol).toBe("postgresql:");
    expect(out.username).toBe("user");
    // Node's URL keeps the password percent-encoded, exactly as given.
    expect(out.password).toBe("p%40ss");
    expect(out.hostname).toBe("db.internal.example");
    expect(out.port).toBe("15433");
    expect(out.pathname).toBe("/postgres");
  });

  it("removes search_path/options but keeps unrelated query params", () => {
    const withSearchPath = `${BASE_URL}?options=${encodeURIComponent(
      "-c search_path=test_x,public",
    )}&sslmode=disable&search_path=test_y`;
    const out = new URL(resolveTestInfraCoordinationUrl(withSearchPath));
    expect(out.searchParams.get("options")).toBeNull();
    expect(out.searchParams.get("search_path")).toBeNull();
    expect(out.searchParams.get("sslmode")).toBe("disable");
  });

  it("rejects an unsafe TEST_ADMIN_DATABASE name", () => {
    expect(() =>
      resolveTestInfraCoordinationUrl(BASE_URL, {
        TEST_ADMIN_DATABASE: "exam; DROP TABLE x",
      }),
    ).toThrow(/unsafe TEST_ADMIN_DATABASE/);
  });

  it("rejects a TEST_ADMIN_DATABASE longer than 63 chars", () => {
    expect(() =>
      resolveTestInfraCoordinationUrl(BASE_URL, {
        TEST_ADMIN_DATABASE: "x".repeat(64),
      }),
    ).toThrow(/63/);
  });

  it("rejects a non-postgres protocol", () => {
    expect(() => resolveTestInfraCoordinationUrl("sqlite:./dev.db")).toThrow(
      /postgres:\/\/ or postgresql:\/\//,
    );
  });
});

// ---------------------------------------------------------------------------
// PG-integration tests (skipped when PG is not reachable)
// ---------------------------------------------------------------------------

PG_DESCRIBE(
  "withTestInfraLifecycleLock — acquire/release",
  // Hang-protection budget: every test here acquires the lifecycle lock, which
  // serializes ALL heavy catalog DDL on one coordination database; under
  // parallel @exam/db runs the acquisition can queue behind sibling CREATE/
  // DROP DATABASE sections (seconds each). Ordering is deterministic — this
  // is pure hang protection, not an ordering mechanism.
  { timeout: 30_000 },
  () => {
    it("runs the body and releases the lock (a second caller acquires promptly)", async () => {
      // First call holds then releases the lock; a second call must be able to
      // acquire it immediately afterward (proving release happened).
      let ran = false;
      await withTestInfraLifecycleLock(ADMIN_URL, async () => {
        ran = true;
      });
      expect(ran).toBe(true);

      // Second acquisition should succeed without hanging. If release failed,
      // this would block until testTimeout.
      let ran2 = false;
      await withTestInfraLifecycleLock(ADMIN_URL, async () => {
        ran2 = true;
      });
      expect(ran2).toBe(true);
    });

    it("serializes concurrent lifecycle sections across sessions (pg_locks-proven)", async () => {
      // The holder gates its critical section on a deferred; the contender
      // starts while the holder is still inside. pg_locks must prove the
      // contender is WAITING (granted=false) before the test releases the
      // holder — no fixed sleep is used to assume overlap.
      const key = getTestInfraLifecycleLockKey();
      const holderEntered = createDeferred<void>("holder entered");
      const releaseHolder = createDeferred<void>("release holder");
      const contenderEntered = createDeferred<void>("contender entered");

      let inside = 0;
      let maxConcurrent = 0;

      const holderPromise = withTestInfraLifecycleLock(ADMIN_URL, async () => {
        inside += 1;
        maxConcurrent = Math.max(maxConcurrent, inside);
        holderEntered.resolve();
        await releaseHolder.promise;
        inside -= 1;
      });

      let contenderPromise: Promise<void> | undefined;
      try {
        await holderEntered.promise;

        contenderPromise = withTestInfraLifecycleLock(ADMIN_URL, async () => {
          inside += 1;
          maxConcurrent = Math.max(maxConcurrent, inside);
          contenderEntered.resolve();
          inside -= 1;
        });

        // Real lock-state proof: one granted holder + at least one ungranted
        // waiter on the SAME key, before the holder is released.
        const rows = await pollAdvisoryLocks(
          COORD_URL,
          key,
          (rs) =>
            rs.filter((r) => r.granted).length === 1 &&
            rs.filter((r) => !r.granted).length >= 1,
        );
        const holder = rows.filter((r) => r.granted);
        const waiters = rows.filter((r) => !r.granted);
        expect(holder).toHaveLength(1);
        expect(waiters.length).toBeGreaterThanOrEqual(1);
        for (const row of [...holder, ...waiters]) {
          expect(row.locktype).toBe("advisory");
          expect(row.mode).toBe("ExclusiveLock");
          expect(reconstructLockKey(row)).toBe(key);
        }

        // Release the holder; the contender must then enter.
        releaseHolder.resolve();
        await contenderPromise;
        expect(contenderEntered.isSettled()).toBe(true);
        // Structural no-overlap: the contender's body could only run after the
        // holder released (proven by the waiting row above), so the sections
        // never overlapped.
        expect(maxConcurrent).toBe(1);
      } finally {
        // Dispose EVERY deferred (holderEntered / contenderEntered /
        // releaseHolder) + settle every promise even on assertion failure, so
        // no lock session, connection, or armed rejection timer is left
        // behind.
        disposeAll(holderEntered, contenderEntered, releaseHolder);
        await Promise.allSettled([
          holderPromise,
          ...(contenderPromise ? [contenderPromise] : []),
        ]);
      }
    });

    it("releases the lock when the body throws", async () => {
      // Body throws; lock must still be released so a subsequent caller acquires.
      await expect(
        withTestInfraLifecycleLock(ADMIN_URL, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow(/boom/);

      // If the throw-path leaked the lock, this would hang until testTimeout.
      let recovered = false;
      await withTestInfraLifecycleLock(ADMIN_URL, async () => {
        recovered = true;
      });
      expect(recovered).toBe(true);
    });
  },
);

PG_DESCRIBE(
  "withTestInfraLifecycleLock — cross-database coordination",
  // Same lifecycle-queue budget as the acquire/release describe.
  { timeout: 30_000 },
  () => {
    it("a holder on exam_test blocks a contender on postgres (advisory locks are database-local, so the canonical coordination DB unifies them)", async () => {
      // Prerequisite: the two input URLs must genuinely target DIFFERENT
      // databases — otherwise this test would not prove cross-database
      // coordination.
      expect(new URL(BASE_URL).pathname).not.toBe(new URL(ADMIN_URL).pathname);

      const key = getTestInfraLifecycleLockKey();
      const holderEntered = createDeferred<void>("cross-db holder entered");
      const releaseHolder = createDeferred<void>("cross-db release holder");
      const contenderEntered = createDeferred<void>(
        "cross-db contender entered",
      );

      // Holder acquires the lock via the EXAM_TEST URL.
      const holderPromise = withTestInfraLifecycleLock(BASE_URL, async () => {
        holderEntered.resolve();
        await releaseHolder.promise;
      });

      let contenderPromise: Promise<void> | undefined;
      try {
        await holderEntered.promise;

        // Contender acquires the same lock via the POSTGRES URL (a different
        // database than the holder). Without canonicalization these would not
        // coordinate; the pg_locks proof below demonstrates they DO.
        contenderPromise = withTestInfraLifecycleLock(ADMIN_URL, async () => {
          contenderEntered.resolve();
        });

        // Bounded polling of pg_locks on the coordination database: exactly one
        // granted holder + at least one ungranted waiter for the SAME key.
        const rows = await pollAdvisoryLocks(
          COORD_URL,
          key,
          (rs) =>
            rs.filter((r) => r.granted).length === 1 &&
            rs.filter((r) => !r.granted).length >= 1,
        );

        const holder = rows.filter((r) => r.granted);
        const waiters = rows.filter((r) => !r.granted);
        expect(holder).toHaveLength(1);
        expect(waiters.length).toBeGreaterThanOrEqual(1);
        for (const row of [...holder, ...waiters]) {
          expect(row.locktype).toBe("advisory");
          expect(row.mode).toBe("ExclusiveLock");
          // The lock lives on the coordination database, not on either caller's
          // original database.
          expect(row.database).toBeGreaterThan(0);
          expect(reconstructLockKey(row)).toBe(key);
        }

        // The coordination database OID matches the pg_locks row's database.
        const coord = postgres(COORD_URL, { max: 1 });
        try {
          const oidRows = (await coord`
          SELECT oid FROM pg_database WHERE datname = current_database()
        `) as Array<{ oid: number }>;
          const coordOid = Number(oidRows[0]?.oid ?? 0);
          expect(coordOid).toBeGreaterThan(0);
          for (const row of [...holder, ...waiters]) {
            expect(Number(row.database)).toBe(coordOid);
          }
        } finally {
          await coord.end();
        }

        // Release the holder; the contender (which entered through the postgres
        // URL) must then acquire and enter.
        releaseHolder.resolve();
        await contenderPromise;
        expect(contenderEntered.isSettled()).toBe(true);
      } finally {
        // Dispose EVERY deferred (holderEntered / contenderEntered /
        // releaseHolder) + settle every promise even on assertion failure, so
        // no lock session, connection, or armed rejection timer is left
        // behind.
        disposeAll(holderEntered, contenderEntered, releaseHolder);
        await Promise.allSettled([
          holderPromise,
          ...(contenderPromise ? [contenderPromise] : []),
        ]);
      }
    });
  },
);

/** Resolve with `label` after `ms` (bounded race timer; unref'd). */
function raceTimeoutLabel(label: string, ms: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(label), ms);
    timer.unref?.();
  });
}

PG_DESCRIBE(
  "withTestInfraLifecycleLock — resource-class key split",
  // Queue-participant hang protection: both critical sections below take real
  // advisory locks on the coordination DB.
  { timeout: 30_000 },
  () => {
    it("a held database-class lock does not hold the schema key (pg_locks proof)", async () => {
      // Deterministic reproducer of the 2026-08-26 audit failure: one
      // pathological DROP DATABASE held the single shared key for 23.4s and
      // every queued schema setup inherited that wait inside its hook budget.
      //
      // pg_locks is filtered to THIS session (pid = pg_backend_pid()), so the
      // proof is independent of sibling critical sections and needs no timing:
      // a session holding the DATABASE key must not also hold the SCHEMA key,
      // which is exactly why a schema-class caller can never be blocked by a
      // database-class holder after the split.
      const probe = postgres(COORD_URL, { max: 1 });
      const schemaKey = getTestInfraLifecycleLockKey("schema");
      const databaseKey = getTestInfraLifecycleLockKey("database");
      const countAdvisoryOnThisSession = async (key: bigint) => {
        // pg_locks.classid/objid are oid (raw unsigned 32-bit halves of the
        // advisory bigint key); mask the key halves before casting so a
        // high-bit key never raises "integer out of range".
        const rows = (await probe.unsafe(
          `SELECT count(*)::int AS n
           FROM pg_locks
           WHERE pid = pg_backend_pid()
             AND locktype = 'advisory'
             AND granted
             AND classid = (($1::bigint >> 32) & 4294967295)::oid
             AND objid = ($1::bigint & 4294967295)::oid`,
          [key.toString()],
        )) as Array<{ n: number }>;
        return rows[0]?.n ?? 0;
      };
      try {
        await probe.unsafe("SELECT pg_advisory_lock($1)", [
          databaseKey.toString(),
        ]);
        try {
          // Sanity: this session really does hold the database key.
          expect(await countAdvisoryOnThisSession(databaseKey)).toBe(1);
          // The database holder must NOT hold the schema key on its own
          // session, so a schema-class caller can never be blocked by it.
          expect(await countAdvisoryOnThisSession(schemaKey)).toBe(0);
        } finally {
          await probe.unsafe("SELECT pg_advisory_unlock($1)", [
            databaseKey.toString(),
          ]);
        }
      } finally {
        await probe.end().catch(() => {});
      }
    });

    it("database-class critical sections are routed to the database key", async () => {
      const databaseKey = getTestInfraLifecycleLockKey("database");
      const probe = postgres(COORD_URL, { max: 1 });
      try {
        await withTestInfraLifecycleLock(
          ADMIN_URL,
          async () => {
            // Runs inside the held critical section. A different session
            // cannot re-acquire a key the holder's own session owns, so
            // try-locking the DATABASE key here must FAIL — proving the
            // section is routed to the DATABASE key. A regression that
            // routes the database class onto the schema key leaves the
            // DATABASE key free, so the try-lock succeeds and this assertion
            // fails. The probe only ever try-locks: it never blocks, never
            // queues, and no key is held externally, so this test cannot
            // starve sibling critical sections (unlike a race-based probe).
            const rows = (await probe.unsafe(
              "SELECT pg_try_advisory_lock($1) AS ok",
              [databaseKey.toString()],
            )) as Array<{ ok: boolean }>;
            if (rows[0]?.ok === true) {
              await probe.unsafe("SELECT pg_advisory_unlock($1)", [
                databaseKey.toString(),
              ]);
            }
            expect(rows[0]?.ok).toBe(false);
          },
          { lockClass: "database" },
        );
      } finally {
        await probe.end().catch(() => {});
      }
    });

    it("database-class callers still serialize against each other", async () => {
      const first = createDeferred<void>("dbFirstEntered");
      const releaseFirst = createDeferred<void>("dbReleaseFirst");
      const firstPromise = withTestInfraLifecycleLock(
        ADMIN_URL,
        async () => {
          first.resolve();
          await releaseFirst.promise;
        },
        { lockClass: "database" },
      );
      await first.promise;
      // `first.promise` resolves inside the held critical section, so the
      // second caller is now guaranteed to launch BEHIND a real database-key
      // holder. Launching it before this point races the initial acquisition:
      // if the second caller happened to win the key first, the test would
      // misread "second-finished-early" and fail spuriously.
      let overlapped = false;
      const secondPromise = (async () => {
        await withTestInfraLifecycleLock(
          ADMIN_URL,
          async () => {
            if (!releaseFirst.isSettled()) overlapped = true;
          },
          { lockClass: "database" },
        );
      })();
      try {
        const winner = await Promise.race([
          secondPromise.then((): string => "second-finished-early"),
          raceTimeoutLabel("second-still-waiting", 1_000),
        ]);
        expect(winner).toBe("second-still-waiting");
        releaseFirst.resolve();
        await Promise.all([firstPromise, secondPromise]);
        expect(overlapped).toBe(false);
      } finally {
        disposeAll(first, releaseFirst);
        await Promise.allSettled([firstPromise, secondPromise]);
      }
    });
  },
);
