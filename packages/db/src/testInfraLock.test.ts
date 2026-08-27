import { describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  dropDatabaseIfExists,
  ensureDatabaseExists,
  withDatabaseName,
} from "./testWorkerDatabase.js";
import {
  acquireTestInfraRunLease,
  getTestInfraLifecycleLockKey,
  resolveTestInfraCoordinationUrl,
  TEST_INFRA_RUN_LEASE_LOCK_KEY,
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

/** Create a disposable database (unique coordination-DB fixtures). */
async function ensureDb(adminUrl: string, name: string): Promise<void> {
  const sql = postgres(adminUrl);
  try {
    const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (rows.length === 0) await sql.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await sql.end();
  }
}

/** Drop a disposable database, terminating lingering connections first. */
async function dropDb(adminUrl: string, name: string): Promise<void> {
  const sql = postgres(adminUrl);
  try {
    await sql`SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${name} AND pid <> pg_backend_pid()`;
    await sql.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await sql.end();
  }
}

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

  it("is the ONLY lifecycle key (single shared key, no resource-class variants)", () => {
    // One key is the Phase 6D engine guarantee re-affirmed 2026-08-26: ALL
    // heavy DDL/migration (CREATE/DROP DATABASE included) serializes against
    // each other, so physical DB DDL can never fight migration traffic on the
    // catalog. The withdrawn resource-class split had no variants to begin
    // with once the queue load itself was traced back to the worker-identity
    // root cause (VITEST_WORKER_ID → VITEST_POOL_ID).
    const key = getTestInfraLifecycleLockKey();
    expect(key).toBe(getTestInfraLifecycleLockKey());
    expect(key).not.toBe(0n);
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

PG_DESCRIBE(
  "withTestInfraLifecycleLock — caller env authority (TEST_ADMIN_DATABASE)",
  // Queue-participant budget: this describe acquires the real lifecycle lock.
  { timeout: 30_000 },
  () => {
    it("hosts the lock on the caller-resolved coordination DB, not a process.env re-read (round-3 authority regression)", async () => {
      // Reproduces the CodeRabbit round-2 finding against the round-3 fix:
      // setupWorkerTestDatabase resolves adminUrl from ITS env
      // (TEST_ADMIN_DATABASE=injected), and the lock helper must host the
      // advisory lock on that SAME database. The old implementation silently
      // re-read process.env.TEST_ADMIN_DATABASE below the seam, so a divergent
      // ambient value moved the lock onto a different database — and advisory
      // locks are database-local, i.e. coordination silently broke.
      //
      // The injected authority is a UNIQUE disposable database: no sibling
      // test traffic can put rows there, so a granted row for THE lifecycle
      // key on this DB can only come from OUR holder. Old implementation:
      // holder's lock lands on the ambient DB, this DB never sees a row, the
      // poll times out and the test FAILS — deterministic either way.
      const ambientDb = "postgres";
      const injectedDb = `exam_test_coordauth_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      await ensureDb(ADMIN_URL, injectedDb);
      const injectedEnv = { TEST_ADMIN_DATABASE: injectedDb };
      const injectedUrl = resolveTestInfraCoordinationUrl(
        BASE_URL,
        injectedEnv,
      );
      expect(new URL(injectedUrl).pathname).toBe(`/${injectedDb}`);

      const key = getTestInfraLifecycleLockKey();
      const holderEntered = createDeferred<void>("authority holder entered");
      const releaseHolder = createDeferred<void>("authority release holder");

      // The hosting database's oid: pg_locks is CLUSTER-GLOBAL (rows for
      // locks hosted on OTHER databases appear too, tagged with the owning
      // database oid), so the discriminator is row.database === injected oid.
      // No sibling test uses this unique DB, so such a row can only be OUR
      // holder — deterministic even under parallel-suite lock traffic.
      const oidProbe = postgres(injectedUrl, { max: 1 });
      let injectedOid = 0;
      try {
        const oidRows = (await oidProbe`
          SELECT oid FROM pg_database WHERE datname = current_database()
        `) as Array<{ oid: number }>;
        injectedOid = Number(oidRows[0]?.oid);
      } finally {
        await oidProbe.end();
      }
      expect(injectedOid).toBeGreaterThan(0);

      const saved = process.env.TEST_ADMIN_DATABASE;
      process.env.TEST_ADMIN_DATABASE = ambientDb;
      let holderPromise: Promise<void> | undefined;
      try {
        holderPromise = withTestInfraLifecycleLock(
          injectedUrl,
          async () => {
            holderEntered.resolve();
            await releaseHolder.promise;
          },
          { env: injectedEnv },
        );
        await holderEntered.promise;

        // Exactly one granted lifecycle-key row HOSTED ON the injected
        // authority DB. Old implementation hosts it on the ambient DB, no row
        // ever carries the injected oid, and this poll times out → FAIL.
        const rows = await pollAdvisoryLocks(
          injectedUrl,
          key,
          (rs) =>
            rs.filter((r) => r.granted && Number(r.database) === injectedOid)
              .length === 1,
        );
        const hosted = rows.filter(
          (r) => r.granted && Number(r.database) === injectedOid,
        );
        expect(hosted).toHaveLength(1);
        expect(hosted[0]?.locktype).toBe("advisory");
        expect(hosted[0]?.mode).toBe("ExclusiveLock");

        releaseHolder.resolve();
        await holderPromise;
      } finally {
        if (saved === undefined) delete process.env.TEST_ADMIN_DATABASE;
        else process.env.TEST_ADMIN_DATABASE = saved;
        disposeAll(holderEntered, releaseHolder);
        await Promise.allSettled(holderPromise ? [holderPromise] : []);
        await dropDb(ADMIN_URL, injectedDb).catch(() => {});
      }
    });
  },
);

PG_DESCRIBE(
  "withTestInfraLifecycleLock — single shared key semantics",
  // Queue-participant hang protection: the critical section below takes a real
  // advisory lock on the coordination DB.
  { timeout: 30_000 },
  () => {
    it("any critical section holds THE single lifecycle key (probe try-lock must fail)", async () => {
      // Inverse of the withdrawn class-split regressions: with the ONE-key
      // design restored, EVERY heavy-lifecycle body — schema migration and
      // CREATE/DROP DATABASE alike — serializes on the same advisory key, so
      // while any section is inside, NO other session can acquire that key.
      // A regression that re-introduces per-class keys (or routes some caller
      // to a second key) leaves THE key free here; the try-lock succeeds and
      // this assertion fails. The probe only ever try-locks: it never blocks,
      // never queues, and no key is held externally, so this test cannot
      // starve sibling critical sections.
      const key = getTestInfraLifecycleLockKey();
      const probe = postgres(COORD_URL, { max: 1 });
      try {
        await withTestInfraLifecycleLock(ADMIN_URL, async () => {
          const rows = (await probe.unsafe(
            "SELECT pg_try_advisory_lock($1) AS ok",
            [key.toString()],
          )) as Array<{ ok: boolean }>;
          if (rows[0]?.ok === true) {
            await probe.unsafe("SELECT pg_advisory_unlock($1)", [
              key.toString(),
            ]);
          }
          expect(rows[0]?.ok).toBe(false);
        });
      } finally {
        await probe.end().catch(() => {});
      }
    });
  },
);

PG_DESCRIBE(
  "wrapper env authority — ensureDatabaseExists / dropDatabaseIfExists (round-4)",
  // Queue-participant budget: both wrapper phases take the real lifecycle lock
  // (and CREATE/DROP DATABASE) on the injected coordination DB.
  { timeout: 30_000 },
  () => {
    it("ensure and drop queue on the CALLER-resolved coordination DB, not a process.env re-read", async () => {
      // Wrapper-contract regression (round-4 review): the round-3 fix threaded
      // `env` through `withTestInfraLifecycleLock` when called DIRECTLY, but
      // `ensureDatabaseExists` / `dropDatabaseIfExists` — the wrappers every
      // real caller goes through — silently dropped it. Result: the bootstrap's
      // ensure/drop DDL serialized on the AMBIENT authority while its migration
      // used the caller's — one bootstrap on two serialization queues.
      //
      // Proof shape (deterministic both ways): a foreign session holds THE
      // lifecycle key on the caller-injected coordination DB. If the wrapper
      // propagates env, its lock attempt queues THERE — visible as an un-granted
      // pg_locks waiter row tagged with the injected DB oid — and the wrapper
      // blocks until the holder releases. If the wrapper re-reads process.env
      // (the bug), its lock lands on the ambient DB, no waiter row ever carries
      // the injected oid, the poll times out and the test FAILS.
      const injectedDb = `exam_test_coordwrap_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const target = `exam_test_wraptgt_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      await ensureDb(ADMIN_URL, injectedDb);
      const injectedEnv = { TEST_ADMIN_DATABASE: injectedDb };
      const injectedUrl = resolveTestInfraCoordinationUrl(
        BASE_URL,
        injectedEnv,
      );
      const key = getTestInfraLifecycleLockKey();

      const oidProbe = postgres(injectedUrl, { max: 1 });
      const foreign = postgres(injectedUrl, { max: 1 });
      const saved = process.env.TEST_ADMIN_DATABASE;
      process.env.TEST_ADMIN_DATABASE = "postgres"; // ambient diverges
      let ensurePromise: Promise<void> | undefined;
      let dropPromise: Promise<void> | undefined;
      try {
        let injectedOid = 0;
        const oidRows = (await oidProbe`
          SELECT oid FROM pg_database WHERE datname = current_database()
        `) as Array<{ oid: number }>;
        injectedOid = Number(oidRows[0]?.oid);
        expect(injectedOid).toBeGreaterThan(0);

        // Phase 1 — ensureDatabaseExists must queue on the injected authority.
        await foreign.unsafe("SELECT pg_advisory_lock($1)", [key.toString()]);
        ensurePromise = ensureDatabaseExists(injectedUrl, target, {
          env: injectedEnv,
        });
        await pollAdvisoryLocks(injectedUrl, key, (rs) =>
          rs.some((r) => !r.granted && Number(r.database) === injectedOid),
        );
        await foreign.unsafe("SELECT pg_advisory_unlock($1)", [key.toString()]);
        await ensurePromise;
        ensurePromise = undefined;

        // The wrapper really created the target DB through this path.
        const catalog = postgres(ADMIN_URL, { max: 1 });
        try {
          const created = await catalog`
            SELECT 1 FROM pg_database WHERE datname = ${target}
          `;
          expect(created.length).toBe(1);
        } finally {
          await catalog.end();
        }

        // Phase 2 — dropDatabaseIfExists must queue on the injected authority.
        await foreign.unsafe("SELECT pg_advisory_lock($1)", [key.toString()]);
        dropPromise = dropDatabaseIfExists(injectedUrl, target, {
          env: injectedEnv,
        });
        await pollAdvisoryLocks(injectedUrl, key, (rs) =>
          rs.some((r) => !r.granted && Number(r.database) === injectedOid),
        );
        await foreign.unsafe("SELECT pg_advisory_unlock($1)", [key.toString()]);
        await dropPromise;
        dropPromise = undefined;
      } finally {
        if (saved === undefined) delete process.env.TEST_ADMIN_DATABASE;
        else process.env.TEST_ADMIN_DATABASE = saved;
        await Promise.allSettled([
          ensurePromise ?? Promise.resolve(),
          dropPromise ?? Promise.resolve(),
        ]);
        await foreign.end().catch(() => {});
        await oidProbe.end().catch(() => {});
        await dropDb(ADMIN_URL, target).catch(() => {});
        await dropDb(ADMIN_URL, injectedDb).catch(() => {});
      }
    });
  },
);

PG_DESCRIBE(
  "acquireTestInfraRunLease — run-level exclusion lease (round-4)",
  // The lease is one try-lock round-trip on a disposable coordination DB; the
  // lifecycle-queue budget is pure hang protection.
  { timeout: 30_000 },
  () => {
    it("run-lease key is namespace-separated from the lifecycle key", () => {
      expect(TEST_INFRA_RUN_LEASE_LOCK_KEY).not.toBe(
        getTestInfraLifecycleLockKey(),
      );
      expect(TEST_INFRA_RUN_LEASE_LOCK_KEY).not.toBe(0n);
    });

    it("run B fails IMMEDIATELY while run A holds; release is idempotent and unblocks", async () => {
      // The withdrawn per-slot lease polled up to 10s before failing — an
      // internal wait racing the caller's testTimeout. The run lease must
      // answer in ONE try-lock round-trip: conflict ⇒ immediate rejection.
      const injectedDb = `exam_test_runlease_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      await ensureDb(ADMIN_URL, injectedDb);
      const env = { TEST_ADMIN_DATABASE: injectedDb };
      try {
        const a = await acquireTestInfraRunLease(BASE_URL, env);
        const t0 = Date.now();
        await expect(acquireTestInfraRunLease(BASE_URL, env)).rejects.toThrow(
          /another worker-database test run is already active/,
        );
        expect(Date.now() - t0).toBeLessThan(2_000);
        await a.release();
        await a.release(); // idempotent — teardown may race a double call
        const b = await acquireTestInfraRunLease(BASE_URL, env);
        await b.release();
      } finally {
        await dropDb(ADMIN_URL, injectedDb).catch(() => {});
      }
    });

    it("lease authority comes from the CALLER env (TEST_ADMIN_DATABASE domain separation)", async () => {
      // Same authority discipline as the lifecycle lock: advisory locks are
      // database-local, so a holder on the injected coordination DB must NOT
      // affect a run whose env resolves a different coordination DB.
      const injectedDb = `exam_test_runauth_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      await ensureDb(ADMIN_URL, injectedDb);
      try {
        const injected = { TEST_ADMIN_DATABASE: injectedDb };
        const ambient = { TEST_ADMIN_DATABASE: "postgres" };
        const a = await acquireTestInfraRunLease(BASE_URL, injected);
        await expect(
          acquireTestInfraRunLease(BASE_URL, injected),
        ).rejects.toThrow(/already active/);
        const other = await acquireTestInfraRunLease(BASE_URL, ambient);
        await other.release();
        await a.release();
      } finally {
        await dropDb(ADMIN_URL, injectedDb).catch(() => {});
      }
    });
  },
);
