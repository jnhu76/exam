/**
 * R-T4-1 / #1071 — Deadline scanner vs a held EA-seam row lock: bounded
 * give-up + failure accounting + exactly-once recovery.
 *
 * Failure mode (E0 integration reproduction, real buildTestApp + real
 * deadlineScanner tick body + real engine transactions + real PostgreSQL):
 * `autoSubmitAndGrade` acquires `Enrollment FOR UPDATE` as the FIRST lock of
 * the EA seam (Enrollment → Attempt → Exam). A long competitor transaction
 * holding that enrollment row blocks the scanner transaction INDEFINITELY —
 * there is no lock/statement timeout anywhere on the path (repo-wide rg for
 * lock_timeout/statement_timeout hits only perf-research SQL and test
 * comments) — so every tick parks on the row lock, single-flight skips all
 * subsequent ticks, and no candidate settles until the holder releases
 * (measured: 5.2s/8.0s holds → ~20/31 skipped ticks, zero settlements during
 * the hold).
 *
 * The #1071 fix contract: the scanner's transaction gets a bounded
 * `lock_timeout` (brief: 2–5s, scanner transaction only — never the candidate
 * submit/save path), 55P03 (lock_not_available) is NOT added to the
 * 40001/40P01 retryable set (no same-transaction retry; the whole transaction
 * rolls back), the timed-out candidate is accounted as a per-candidate
 * failure (`failedCount`) and the loop continues; the next tick retries the
 * candidate. The held-lock timeout therefore must NOT discard the final
 * transaction result (the attempt still settles exactly once after the lock
 * frees), must not double-settle, and must not leave partial state or a
 * phantom audit behind from the aborted pass.
 *
 * Schedule (no sleep gates an outcome — the hold is a deferred-parked real
 * repo `FOR UPDATE` on a dedicated connection, and the give-up observation is
 * a bounded condition poll of the tick's in-process settle):
 *
 *   1. An expired attempt is a live discovery candidate.
 *   2. A holder transaction (dedicated single-connection pool) takes the
 *      enrollment row via the REAL repo seam `findByExamAndCandidateForUpdate`
 *      and parks until released — the exact row the scanner's EA seam locks
 *      first.
 *   3. One real scanner tick (`scanDatabaseForExpiredAttempts`) is launched
 *      while the lock is held. The tick MUST settle while the lock is STILL
 *      held (bounded window `LOCK_RACE_BUDGET_MS`, strictly above the 2–5s
 *      lock_timeout budget the fix contract mandates), with the candidate
 *      accounted as failed: failedCount=1, submittedCount=0, noOpCount=0,
 *      discoveredCount=1.
 *   4. The aborted pass leaves NO partial state (whole-transaction rollback):
 *      the attempt stays in_progress with null submittedAt/gradedAt.
 *   5. After release, the next tick settles the candidate exactly once:
 *      submittedCount=1, attempt graded, submissionReason='deadline',
 *      submittedAt backdated to the canonical effective deadline D (the
 *      frozen business instant — the final result is not lost to the aborted
 *      pass).
 *   6. A further tick no-ops (nothing left to discover), gradedAt is
 *      unchanged (no double settlement) and no compliance audit row exists
 *      for the attempt in any phase (no phantom autoSubmit/submit audit from
 *      the aborted or the winning pass).
 *
 * RED boundary (pre-fix): the tick cannot settle while the lock is held at
 * all — it parks on the row lock until release, so the first oracle
 * assertion fails and the drained tick submits the candidate itself.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createPostgresDatabase } from "@exam/db/postgres";
import { setupIsolatedTestDb } from "@exam/db/testIsolation";
import { resolveTestDbUrl } from "@exam/db/testDb";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/schema/pg";
import { createEnrollmentRepo } from "@exam/db/repository/enrollmentRepo";
import { executeInTransaction } from "@exam/db/types";
import {
  scanDatabaseForExpiredAttempts,
  type ScanResult,
} from "../../plugins/deadlineScanner.js";
import {
  buildExamPayload,
  createIsolatedAttemptOrg,
  type IsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";
import { createDeferred } from "../../testing/barrier.js";

// The deadline scanner must never fire mid-schedule: this test parks a
// transaction on purpose, and a background auto-submit would compete for the
// same rows. 1h interval ≈ never (same guard as
// candidate-deadline-authority.concurrency.test.ts).
process.env.DEADLINE_SCAN_INTERVAL_MS = "3600000";

/**
 * Bounded window for "the tick settled while the lock is still held". Must
 * strictly exceed the scanner lock_timeout budget the #1071 fix contract
 * mandates (2–5s) plus tick overhead; a budget breach on the pre-fix code is
 * the RED signal (the tick parks on the row lock with no timeout at all).
 */
const LOCK_RACE_BUDGET_MS = 6_500;

/** Poll cadence of the bounded give-up observation (in-memory flag check). */
const SETTLE_POLL_MS = 50;

/** All teardown steps run and every error surfaces (no swallowed cleanup). */
async function teardownAll(
  ...steps: Array<() => Promise<unknown>>
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `teardown failed with ${errors.length} error(s): ` +
        errors.map((e) => String(e)).join(" | "),
    );
  }
}

describe("R-T4-1 / #1071 — deadline scanner vs held enrollment row lock", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let holderConn: Awaited<ReturnType<typeof createPostgresDatabase>>;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "api",
      databaseUrl: resolveTestDbUrl(),
    });

    ctx = await buildTestApp(
      async (fastify) => {
        await fastify.register(examRoutes, { prefix: "" });
        await fastify.register(attemptRoutes, { prefix: "" });
      },
      { schemaName: iso.schemaName },
    );

    // Dedicated holder pool (its only session parks inside the barrier
    // transaction); it shares the app's isolated schema.
    holderConn = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => holderConn.sql.end(),
      () => ctx.cleanup(),
      () => iso.cleanup(),
    );
  }, 30_000);

  /** Raw attempt row reader (MVCC read — never blocks on the held lock). */
  async function readAttemptRow(attemptId: string) {
    const rows = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`attempt row missing: ${attemptId}`);
    return row;
  }

  /** Compliance audit rows for the attempt, filtered to submit-family actions. */
  async function countSubmitFamilyAudits(attemptId: string): Promise<number> {
    const rows = await ctx.db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, attemptId));
    return rows.filter(
      (r) => r.action === "attempt.autoSubmit" || r.action === "attempt.submit",
    ).length;
  }

  /**
   * Creates one published exam + enrolled started attempt with a saved
   * answer (same shape as deadline-scanner.test.ts
   * `createStartedAttemptWithQuestion`), then backdates the attempt's
   * personal deadline to `effectiveDeadline` so the discovery predicate
   * selects it. Returns the attempt + enrollment ids.
   */
  async function makeExpiredAttempt(
    t: IsolatedAttemptOrg,
    examTitle: string,
    effectiveDeadline: Date,
  ): Promise<{ attemptId: string; enrollmentId: string; examId: string }> {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: examTitle,
        courseId: t.courseId,
        questionIds: [t.questionId],
        durationMinutes: 1,
      }),
      cookies: { "auth-token": t.adminToken },
    });
    expect(created.statusCode, created.body).toBe(201);
    const examId = created.json().id as string;

    const pub = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": t.adminToken },
    });
    expect(pub.statusCode, pub.body).toBe(200);

    const enrollRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [t.candidateProfileId] },
      cookies: { "auth-token": t.adminToken },
    });
    expect(enrollRes.statusCode, enrollRes.body).toBe(200);

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": t.candidateToken },
    });
    expect(startRes.statusCode, startRes.body).toBe(201);
    const attemptId = startRes.json().id as string;

    const examDetail = (
      await ctx.app.inject({
        method: "GET",
        url: `/api/exams/${examId}`,
        cookies: { "auth-token": t.adminToken },
      })
    ).json();
    const localQuestionId = examDetail.questionIds[0] as string;

    const saved = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${localQuestionId}`,
      payload: {
        attemptId,
        questionId: localQuestionId,
        answer: "a",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": t.candidateToken },
    });
    expect(saved.statusCode, saved.body).toBeLessThan(400);

    await ctx.db
      .update(schema.examAttempts)
      .set({ deadlineAt: effectiveDeadline, status: "in_progress" })
      .where(eq(schema.examAttempts.id, attemptId));

    const enrRows = await ctx.db
      .select({ enrollmentId: schema.examAttempts.enrollmentId })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId))
      .limit(1);
    const enrollmentId = enrRows[0]!.enrollmentId;
    expect(enrollmentId).toBeTruthy();
    return { attemptId, enrollmentId, examId };
  }

  it("a tick launched while the EA row lock is held gives up within the bounded budget (failedCount=1), leaves no partial state, and the next tick settles the candidate exactly once after release", async () => {
    // The canonical effective deadline D is fixed at a known past instant;
    // the seeded exam closeAt stays in the future, so D = deadlineAt is the
    // exact backdating oracle for the post-release settlement.
    const effectiveDeadline = new Date(Date.now() - 60_000);
    const t = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: "deadline-lock-timeout-test-",
      label: "DLT",
    });
    const { attemptId, examId } = await makeExpiredAttempt(
      t,
      "Deadline Scanner Held Lock Exam",
      effectiveDeadline,
    );

    // ── Holder barrier: real repo seam, dedicated connection ──
    // Parks holding `Enrollment FOR UPDATE` — the FIRST lock
    // autoSubmitAndGrade acquires — until `release` fires. The holder
    // writes nothing; its commit releases the row lock.
    const holding = createDeferred<void>("lock holder acquired", 20_000);
    const release = createDeferred<void>("lock holder release", 30_000);
    holding.promise.catch(() => {});
    release.promise.catch(() => {});
    const holderDone = executeInTransaction(holderConn.db, async (tx) => {
      const enrollmentRepo = createEnrollmentRepo(tx);
      const enrollment = await enrollmentRepo.findByExamAndCandidateForUpdate(
        {
          organizationId: t.orgId,
          actorId: t.adminUserId,
          role: "Admin",
          permissions: [],
        },
        examId,
        t.candidateProfileId,
      );
      if (!enrollment) {
        throw new Error("lock holder: enrollment row missing");
      }
      holding.resolve();
      await release.promise;
    }).catch((err) => err as Error);
    // The lock MUST be held before the tick launches, or the tick could
    // win the race before the fault is injected.
    await holding.promise;

    // ── Launch one real scanner tick while the lock is held ──
    let heldSettled = false;
    let heldResult: ScanResult | null = null;
    const tick = scanDatabaseForExpiredAttempts(ctx.app, () => new Date());
    tick.then(
      (r) => {
        heldSettled = true;
        heldResult = r;
      },
      () => {
        heldSettled = true;
      },
    );

    // Bounded give-up observation: poll the in-memory settle flag until the
    // window expires. On the fixed code the tick aborts at lock_timeout
    // (< budget) while the holder still parks; on the pre-fix code the tick
    // parks on the row lock for the whole window.
    const windowDeadline = Date.now() + LOCK_RACE_BUDGET_MS;
    while (!heldSettled && Date.now() < windowDeadline) {
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
    }
    // Capture the held-phase evidence BEFORE releasing the lock.
    const settledWhileHeld = heldSettled;
    const heldSnapshot: ScanResult | null = heldResult;

    // ── Release + drain (no holder or tick leak in either world) ──
    release.resolve();
    const drained = (await tick.catch((e) => e)) as unknown;
    await holderDone;

    // ── ORACLE 1: the tick gave up while the lock was still held ──
    expect(
      settledWhileHeld,
      `the scanner tick must settle while the enrollment row lock is still ` +
        `held (bounded lock_timeout give-up); instead it stayed parked on ` +
        `the row lock for the whole ${LOCK_RACE_BUDGET_MS}ms window ` +
        `(drained tick result after release: ${JSON.stringify(drained)})`,
    ).toBe(true);
    expect(heldSnapshot, "held-phase tick result must be captured").not.toBe(
      null,
    );
    expect(heldSnapshot!.discoveredCount).toBe(1);
    expect(heldSnapshot!.failedCount).toBe(1);
    expect(heldSnapshot!.submittedCount).toBe(0);
    expect(heldSnapshot!.noOpCount).toBe(0);

    // ── ORACLE 2: the aborted pass left no partial state ──
    const afterAbort = await readAttemptRow(attemptId);
    expect(afterAbort.status).toBe("in_progress");
    expect(afterAbort.submittedAt).toBeNull();
    expect(afterAbort.gradedAt).toBeNull();
    expect(await countSubmitFamilyAudits(attemptId)).toBe(0);

    // ── ORACLE 3: after release the next tick settles exactly once ──
    const recovered = await scanDatabaseForExpiredAttempts(
      ctx.app,
      () => new Date(),
    );
    expect(recovered.submittedCount).toBe(1);
    expect(recovered.failedCount).toBe(0);

    const afterRecovery = await readAttemptRow(attemptId);
    expect(afterRecovery.status).toBe("graded");
    expect(afterRecovery.submissionReason).toBe("deadline");
    // Business valid instant: submittedAt = the canonical effective deadline
    // D (frozen backdating — the held-lock abort must not have discarded the
    // final transaction result or degraded it to the tick instant).
    expect(afterRecovery.submittedAt?.getTime()).toBe(
      effectiveDeadline.getTime(),
    );
    expect(afterRecovery.gradedAt).not.toBeNull();
    expect(await countSubmitFamilyAudits(attemptId)).toBe(0);

    // ── ORACLE 4: no double settlement, no double audit on rescan ──
    const rescan = await scanDatabaseForExpiredAttempts(
      ctx.app,
      () => new Date(),
    );
    expect(rescan.submittedCount).toBe(0);
    expect(rescan.discoveredCount).toBe(0);
    const afterRescan = await readAttemptRow(attemptId);
    expect(afterRescan.gradedAt?.getTime()).toBe(
      afterRecovery.gradedAt?.getTime(),
    );
    expect(await countSubmitFamilyAudits(attemptId)).toBe(0);
  }, 20_000);
});
