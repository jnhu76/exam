/**
 * Behavioral regression tests for the E2E reseed convergence contract
 * (issue #330), exercised through the canonical E2E seed workflow WITH the
 * production submit+grade composition.
 *
 * These tests live in @exam/api — not @exam/db — because the canonical
 * baseline they converge to includes GRADED demo fixtures, and the only
 * legitimate grader is the production composition (`createDemoSeedGrader`
 * binding `submitAndGradeAttempt`). A grader-less or no-op run cannot
 * produce that baseline: `verifyDemoSeed` now fails it (EXSEM-020), so the
 * workflow's `result.ok === true` is part of the contract pinned here.
 *
 * Field scenario being frozen: a worker DB survives a failed E2E run
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
 * beyond run.sh's E2E_WORKERS cap (16 → w0..w15), so the real harness
 * never manages this name and cannot collide with a live run. The database
 * is created and dropped per test-file run through the same guarded helpers
 * the vitest worker-DB isolation uses.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import {
  ensureDatabaseExists,
  dropDatabaseIfExists,
  withDatabaseName,
} from "@exam/db/src/testWorkerDatabase.js";
import { resolveTestInfraCoordinationUrl } from "@exam/db/src/testInfraLock.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { runE2eSeed } from "@exam/db/src/e2eSeedOrchestrator.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDemoSeedGrader } from "./demo-seed-grader.js";

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
describe(
  "E2E reseed convergence with the production grader (issue #330)",
  {
    timeout: 30_000,
  },
  () => {
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
      // First run: canonical baseline. The workflow must be SEMANTICALLY valid
      // (grader-driven graded fixtures pass verifyDemoSeed), not just complete.
      const first = await runE2eSeed(conn.db, memoizedHash, {
        reset: true,
        grader: createDemoSeedGrader(conn.db),
      });
      expect(first.errors, "canonical baseline seed must verify clean").toEqual(
        [],
      );

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
      const reseed = await runE2eSeed(conn.db, memoizedHash, {
        reset: true,
        grader: createDemoSeedGrader(conn.db),
      });
      expect(reseed.errors, "reseeded baseline must verify clean").toEqual([]);

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
      // and the graded demo attempts were recreated through the production
      // grading seam (terminal state, not pre-submit residue).
      const admin = await conn.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, "admin"));
      const candidate1 = await conn.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, "candidate1"));
      const attempts = await conn.db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.status, "graded"));
      expect(admin).toHaveLength(1);
      expect(candidate1).toHaveLength(1);
      expect(attempts).toHaveLength(6);
      for (const attempt of attempts) {
        expect(attempt.submittedAnswers).not.toBeNull();
        expect(attempt.gradingResult).not.toBeNull();
      }
    });

    it("without reset, stale state survives the seed (additive contract, pinned)", async () => {
      await runE2eSeed(conn.db, memoizedHash, {
        reset: true,
        grader: createDemoSeedGrader(conn.db),
      });
      await poisonWithFailedRunState();

      // The orchestrator's default remains an additive upsert — this is the
      // documented contract B that the reseed entrypoints layer reset on top
      // of. Pinning it here keeps the two contracts distinguishable.
      await runE2eSeed(conn.db, memoizedHash, {
        grader: createDemoSeedGrader(conn.db),
      });

      const staleUserAfter = await conn.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, "stale-maintainer-001"));
      const staleEvidenceAfter = await conn.db.select().from(schema.backupRuns);
      expect(staleUserAfter).toHaveLength(1);
      expect(staleEvidenceAfter).toHaveLength(1);
    });
  },
);
