import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { withDatabaseName } from "./testWorkerDatabase.js";
import {
  getTestInfraLifecycleLockKey,
  withTestInfraLifecycleLock,
} from "./testInfraLock.js";

/**
 * ADR-007 Phase 6D — tests for the test-infra advisory lock helper.
 *
 * Layer split:
 *   - Pure-logic tests (key derivation determinism) — no PG service needed.
 *   - PG-integration tests (acquire/release, serialization across sessions,
 *     release-on-throw) — require a reachable PostgreSQL; wrapped in
 *     `PG_DESCRIBE` (describe.skip when PG is down).
 *
 * No slow stress tests live here; concurrency is manufactured inside the test
 * via parallel `Promise.all` sessions, not via long loops.
 */

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://exam:exam@localhost:5432/exam_test";

const ADMIN_URL = withDatabaseName(BASE_URL, "postgres");

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
});

// ---------------------------------------------------------------------------
// PG-integration tests (skipped when PG is not reachable)
// ---------------------------------------------------------------------------

PG_DESCRIBE("withTestInfraLifecycleLock — acquire/release", () => {
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

  it("serializes concurrent lifecycle sections across sessions", async () => {
    // Two parallel lock holders must NOT run their critical sections
    // simultaneously. We record an overlap flag: if both are "inside" at the
    // same instant, overlap is true.
    let inside = 0;
    let maxConcurrent = 0;
    let overlap = false;

    const criticalSection = async (): Promise<void> => {
      await withTestInfraLifecycleLock(ADMIN_URL, async () => {
        inside += 1;
        maxConcurrent = Math.max(maxConcurrent, inside);
        if (inside > 1) overlap = true;
        // Hold the lock briefly so a truly-parallel peer would overlap.
        await new Promise((r) => setTimeout(r, 120));
        inside -= 1;
      });
    };

    await Promise.all([criticalSection(), criticalSection()]);

    expect(overlap).toBe(false);
    expect(maxConcurrent).toBe(1);
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
});
