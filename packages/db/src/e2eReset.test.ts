/**
 * Behavioral regression tests for the E2E mutable-state reset (issue #330).
 *
 * Field scenario being frozen here: a worker DB survives a failed E2E run
 * (E2E_KEEP_WORKER_DB_ON_FAILURE retention, or a crash that bypassed
 * cleanup) carrying that run's mutable state — backup-evidence ledger rows,
 * leftover Maintainer users, finished attempts. The next run reseeds the
 * same database. The contract under test:
 *
 *   reseed (reset: true)  →  the database CONVERGES to the canonical E2E
 *                            baseline (stale rows gone, seed rows rebuilt)
 *   seed (no reset)       →  additive upsert (stale rows survive — the
 *                            historical behavior, pinned as intentional)
 *
 * The tests run against a dedicated `exam_e2e_w31` database — slot 31 is
 * beyond run-wsl.sh's E2E_WORKERS cap (16 → w0..w15), so the real harness
 * never manages this name and cannot collide with a live run. The database
 * is created and dropped per test-file run through the same guarded helpers
 * the vitest worker-DB isolation uses.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "./database.js";
import { migratePostgres } from "./postgres.js";
import {
  ensureDatabaseExists,
  dropDatabaseIfExists,
  withDatabaseName,
} from "./testWorkerDatabase.js";
import { resolveTestInfraCoordinationUrl } from "./testInfraLock.js";
import { resolveTestDbUrl } from "./testDb.js";
import { runE2eSeed } from "./e2eSeedOrchestrator.js";
import { resetE2eState } from "./e2eReset.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "./schema/pg.js";

const RESET_TEST_DB = "exam_e2e_w31";

// The reseed contract under test is truncate/migrate/seed convergence, not
// argon2 performance. Memoizing per distinct password (same pattern as
// demo-seed.test.ts precomputed hashes) removes ~80ms × every seed user from
// the two full reseed cycles inside the first test's default 5s budget.
const hashCache = new Map<string, Promise<string>>();
function memoizedHash(password: string): Promise<string> {
  let hash = hashCache.get(password);
  if (!hash) {
    hash = hashPassword(password);
    hashCache.set(password, hash);
  }
  return hash;
}

let conn: Awaited<ReturnType<typeof createDatabase>>;
let adminUrl: string;

/** Insert the mutable leftovers a failed E2E run leaves behind. */
async function poisonWithFailedRunState(): Promise<void> {
  const orgRows = await conn.db.select().from(schema.organizations).limit(1);
  const orgId = orgRows[0]!.id;
  await conn.db.insert(schema.users).values({
    id: "stale-maintainer-001",
    organizationId: orgId,
    username: "maintainer-stale-001",
    passwordHash: "not-a-real-hash",
    name: "Stale Maintainer",
    role: "Maintainer",
    isActive: true,
  });
  await conn.db.insert(schema.backupRuns).values({
    id: "stale-backup-run-001",
    organizationId: orgId,
    operationId: "logical:e2e-verified",
    backupType: "logical",
    status: "succeeded",
    startedAt: new Date(),
    completedAt: new Date(),
    artifactLabel: "e2e-verified.dump",
    artifactSizeBytes: 1024,
    verificationMethod: "pg_restore_list",
    verificationStatus: "verified",
    verifiedAt: new Date(),
    executorType: "host_script",
  });
}

// Queue-participant hang protection (see docs/standards/test-flakes.md PR
// #242 rule): beforeAll/afterAll acquire the shared test-infra DDL lock.
// The 30s describe timeout covers the TEST bodies; the hooks declare their own
// explicit timeout argument (Vitest's per-describe timeout does NOT propagate
// to hooks, and there is deliberately NO package-wide hookTimeout raise — an
// unrelated broken hook should surface at the 10s default, not 30s).
describe("E2E reseed convergence (issue #330)", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const baseUrl = resolveTestDbUrl();
    adminUrl = resolveTestInfraCoordinationUrl(baseUrl, process.env);
    await ensureDatabaseExists(adminUrl, RESET_TEST_DB);
    conn = await createDatabase(withDatabaseName(baseUrl, RESET_TEST_DB));
    // Bootstrap (ensure + migrate) belongs to the setup phase: the timed test
    // bodies then exercise reset/seed convergence, not first-time migration.
    await migratePostgres(conn.db);
  }, 30_000);

  afterAll(async () => {
    if (conn) {
      await conn.sql.end();
    }
    if (adminUrl) {
      await dropDatabaseIfExists(adminUrl, RESET_TEST_DB);
    }
  }, 30_000);
  it("reset:true converges a retained DB to the canonical baseline", async () => {
    // First run: canonical baseline.
    await runE2eSeed(conn.db, memoizedHash, { reset: true });

    // A failed run leaves its mutable state behind (retention).
    await poisonWithFailedRunState();
    const staleUser = await conn.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, "stale-maintainer-001"));
    const staleEvidence = await conn.db
      .select()
      .from(schema.backupRuns)
      .where(eq(schema.backupRuns.id, "stale-backup-run-001"));
    expect(staleUser).toHaveLength(1);
    expect(staleEvidence).toHaveLength(1);

    // Next run's reseed must converge, not upsert on top.
    await runE2eSeed(conn.db, memoizedHash, { reset: true });

    const staleUserAfter = await conn.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, "stale-maintainer-001"));
    const staleEvidenceAfter = await conn.db.select().from(schema.backupRuns);
    expect(
      staleUserAfter,
      "stale user from the retained failed run must not survive the reseed",
    ).toHaveLength(0);
    expect(
      staleEvidenceAfter,
      "backup evidence ledger must be empty after the reseed (canonical baseline)",
    ).toHaveLength(0);

    // The canonical baseline is fully rebuilt: admin + demo candidates exist
    // and the demo attempts were recreated.
    const admin = await conn.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, "admin"));
    const candidate1 = await conn.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, "candidate1"));
    const attempts = await conn.db.select().from(schema.examAttempts);
    expect(admin).toHaveLength(1);
    expect(candidate1).toHaveLength(1);
    expect(attempts.length).toBeGreaterThan(0);
  });

  it("without reset, stale state survives the seed (additive contract, pinned)", async () => {
    await runE2eSeed(conn.db, memoizedHash, { reset: true });
    await poisonWithFailedRunState();

    // The orchestrator's default remains an additive upsert — this is the
    // documented contract B that the reseed entrypoints layer reset on top
    // of. Pinning it here keeps the two contracts distinguishable.
    await runE2eSeed(conn.db, memoizedHash, {});

    const staleUserAfter = await conn.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, "stale-maintainer-001"));
    const staleEvidenceAfter = await conn.db.select().from(schema.backupRuns);
    expect(staleUserAfter).toHaveLength(1);
    expect(staleEvidenceAfter).toHaveLength(1);
  });

  it("resetE2eState refuses databases outside the e2e full-reset allowlist", async () => {
    // exam_e2e_w31 is allowed; connect to the vitest test DB instead (its
    // name never matches the e2e/CI allowlist) and expect a loud refusal.
    const testConn = await createDatabase(resolveTestDbUrl());
    try {
      await expect(resetE2eState(testConn.db)).rejects.toThrow(
        /Refusing to reset database/,
      );
    } finally {
      await testConn.sql.end();
    }
  });
});
