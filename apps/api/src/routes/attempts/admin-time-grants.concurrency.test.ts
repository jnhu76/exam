/**
 * REC-I4-V1 — Deterministic PostgreSQL Operator-Grant Concurrency Verification.
 *
 * Proves that two concurrent operator-grant commands with the same `operationId`
 * but targeting different Attempts (different Exams, so no row-lock overlap)
 * deterministically resolve to:
 *   1. T1 wins (granted, one ledger row, deadline advanced)
 *   2. T2 loses (23505 unique violation → fresh transaction → IDEMPOTENCY_CONFLICT)
 *
 * This test calls the SAME production function (`grantWithOperationRaceRecovery`
 * from `orchestrators/operatorGrantExecution.ts`) that the HTTP route calls.
 * It does NOT reimplement the grant transaction, the recovery wrapper, the
 * constraint matcher, or the constraint constant. The only test-owned logic is
 * the barrier-backed observer that fixes T1-before-T2 ordering and records the
 * real in-transaction evidence (PID, txid, and the SQLSTATE/constraint
 * extracted from the caught error by the production matcher).
 *
 * Uses two physical PostgreSQL connections (verified distinct PIDs + same
 * isolated schema), explicit barrier/latch coordination, and fresh-transaction
 * recovery observation captured inside each transaction callback.
 *
 * HTTP error-mapping evidence (200/409 + IDEMPOTENCY_CONFLICT) is covered by
 * the existing `Promise.all` test in `admin-time-grants.test.ts`; this
 * deterministic test owns the DB/domain evidence.
 *
 * @see docs/audits/REC-I4-V1-OPERATOR-GRANT-POSTGRES-CONCURRENCY.md
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Permission, RequestContext, Role } from "@exam/domain";
import { IdempotencyConflictError } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { createRaceBarrier } from "../../testing/barrier.js";
import {
  collectConnectionEvidence,
  createBarrierBackedObserver,
} from "../../testing/operatorGrantConcurrencyHarness.js";
import {
  grantWithOperationRaceRecovery,
  OPERATION_UNIQUE_CONSTRAINT,
} from "../../orchestrators/operatorGrantExecution.js";
import type { GrantAttemptTimeInput } from "@exam/exam-engine";

const TEST_PREFIX = "rec-i4-v1-";

/**
 * Runs all teardown steps and fails the test if ANY errored, instead of
 * swallowing every error with `.catch(() => {})` (which hides connection
 * leaks, schema-drop failures, and test pollution).
 */
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

describe("REC-I4-V1: deterministic operationId race recovery", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let db1: Database;
  let db2: Database;
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };

  beforeAll(async () => {
    const testDbUrl = resolveTestDbUrl();
    iso = await setupIsolatedTestDb({
      namespace: "api",
      databaseUrl: testDbUrl,
    });

    ctx = await buildTestApp(
      async (fastify) => {
        await fastify.register(examRoutes, { prefix: "" });
        await fastify.register(attemptRoutes, { prefix: "" });
      },
      { schemaName: iso.schemaName },
    );

    // Two separate PostgreSQL connections to the SAME isolated schema. Each
    // has max:1 so they are distinct physical backends.
    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db1 = conn1.db;
    db2 = conn2.db;
    sql1 = conn1.sql;
    sql2 = conn2.sql;
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => sql2.end(),
      () => sql1.end(),
      () => ctx.cleanup(),
      () => iso.cleanup(),
    );
  }, 30_000);

  it("deterministically fixes T1 as winner, recovers T2 as IDEMPOTENCY_CONFLICT, on the production recovery path", async () => {
    // ── 1. One org, two operator_incident exams, two started attempts ─────
    // Both attempts live in the SAME organization so the
    // (organization_id, operation_id) unique index applies. They target
    // DIFFERENT exams, so neither the EA lock nor the Exam FOR UPDATE lock
    // overlap — the only mutex is the unique index.
    const slug = `${TEST_PREFIX}race-${randomUUID().slice(0, 8)}`;
    const now = new Date();

    const org = (
      await ctx.db
        .insert(schema.organizations)
        .values({
          id: randomUUID(),
          name: slug,
          displayName: slug,
          slug,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;

    const passwordHash = await hashPassword("password123");
    const adminId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: adminId,
      organizationId: org.id,
      username: `admin-${slug}`,
      passwordHash,
      name: "Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: org.id,
      userId: adminId,
      role: "Admin",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const { jwtSecret } = getRuntimeConfig().authSecret;
    const adminToken = signJWT(
      {
        actorId: adminId,
        role: "Admin" as Role,
        organizationId: org.id,
        authEpoch: 0,
      },
      jwtSecret,
    );

    const course = (
      await ctx.db
        .insert(schema.courses)
        .values({
          id: randomUUID(),
          organizationId: org.id,
          name: `Course ${slug}`,
          code: `C-${slug}`,
          description: "",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;

    const question = (
      await ctx.db
        .insert(schema.questions)
        .values({
          id: randomUUID(),
          organizationId: org.id,
          courseId: course.id,
          type: "single_choice",
          content: "test",
          options: [
            { id: "a", content: "1" },
            { id: "b", content: "2" },
          ],
          standardAnswer: "a",
          attachments: [],
          score: 100,
          difficulty: 1,
          tags: [],
          gradingRule: {
            multiSelectScoring: "all_correct_full",
            fillBlankMatchMode: "exact",
          },
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;

    const createExamAndAttempt = async (examTitle: string) => {
      const exam = (
        await ctx.db
          .insert(schema.exams)
          .values({
            id: randomUUID(),
            organizationId: org.id,
            title: examTitle,
            description: "",
            courseId: course.id,
            status: "open",
            timingMode: "timed_window",
            durationMinutes: 60,
            openAt: new Date(now.getTime() - 3600000),
            closeAt: new Date(now.getTime() + 86400000),
            passingScore: 60,
            totalScore: 100,
            questionSelectionMode: "manual",
            questionIds: [question.id],
            questionSnapshot: [],
            controlFlags: {
              shuffleQuestions: false,
              shuffleOptions: false,
              detectTabSwitch: false,
              disableCopyPaste: false,
              requireQueue: false,
              batchSize: 10,
              batchInterval: 3,
              restrictIp: false,
              requireLockdown: false,
              showResultImmediately: true,
            },
            retakePolicy: "unlimited",
            scoreStrategy: "highest",
            maxAttempts: 10,
            interruptionTimePolicy: "operator_incident",
            interruptionGracePerIncidentSeconds: null,
            interruptionGracePerAttemptSeconds: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      const candidateId = randomUUID();
      await ctx.db.insert(schema.users).values({
        id: candidateId,
        organizationId: org.id,
        username: `cand-${examTitle}-${randomUUID().slice(0, 8)}`,
        passwordHash,
        name: "Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: randomUUID(),
        organizationId: org.id,
        userId: candidateId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const profile = (
        await ctx.db
          .insert(schema.candidateProfiles)
          .values({
            id: randomUUID(),
            organizationId: org.id,
            userId: candidateId,
            fields: {},
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;
      const candidateToken = signJWT(
        {
          actorId: candidateId,
          role: "Candidate" as Role,
          organizationId: org.id,
          authEpoch: 0,
        },
        jwtSecret,
      );

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${exam.id}/enrollments`,
        payload: { candidateIds: [profile.id] },
        cookies: { "auth-token": adminToken },
      });
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${exam.id}/start`,
        cookies: { "auth-token": candidateToken },
      });
      if (startRes.statusCode !== 201) {
        throw new Error(
          `Failed to start attempt: ${startRes.statusCode} ${startRes.body}`,
        );
      }
      return { examId: exam.id, attemptId: startRes.json().id as string };
    };

    const a1 = await createExamAndAttempt("Race Exam A1");
    const a2 = await createExamAndAttempt("Race Exam A2");
    expect(a1.attemptId).not.toBe(a2.attemptId);

    // ── 2. Prove the two connections are distinct backends in one schema ──
    const ev1 = await collectConnectionEvidence(db1);
    const ev2 = await collectConnectionEvidence(db2);
    expect(ev1.pid).not.toBe(ev2.pid);
    expect(ev1.currentSchema).toBe(ev2.currentSchema);
    expect(ev1.searchPath).toBe(ev2.searchPath);
    expect(ev1.currentSchema).toBe(iso.schemaName);

    // ── 3. Build the request context and record pre-race deadlines ───────
    const adminCtx: RequestContext = {
      actorId: adminId,
      organizationId: org.id,
      role: "Admin",
      permissions: [] as Permission[],
      sessionId: "rec-i4-v1",
      targetOrganizationId: org.id,
    };
    const attemptRepo = createAttemptRepo(ctx.db);
    const beforeA1 = (await attemptRepo.findById(adminCtx, a1.attemptId))!
      .deadlineAt!;
    const beforeA2 = (await attemptRepo.findById(adminCtx, a2.attemptId))!
      .deadlineAt!;

    // ── 4. Shared operationId + byte-identical grant inputs ──────────────
    const sharedOpId = randomUUID();
    const addedSeconds = 300;
    const grantNow = new Date();
    const input1: GrantAttemptTimeInput = {
      attemptId: a1.attemptId,
      operationId: sharedOpId,
      addedSeconds,
      reasonCode: "technical_incident",
      reasonText: "race scenario attempt A1",
      interruptionId: null,
      incidentId: null,
      actorId: adminId,
      now: grantNow,
    };
    const input2: GrantAttemptTimeInput = {
      attemptId: a2.attemptId,
      operationId: sharedOpId,
      addedSeconds,
      reasonCode: "technical_incident",
      reasonText: "race scenario attempt A2",
      interruptionId: null,
      incidentId: null,
      actorId: adminId,
      now: grantNow,
    };

    // ── 5. Launch both transactions on the PRODUCTION recovery path ──────
    // No `audit` option → the test does not record the HTTP compliance audit
    // (it has no FastifyRequest). Audit atomicity (winner=1, loser=0
    // `attempt.timeGrant` rows) is therefore NOT asserted in this file; it is
    // proven by the `Promise.all` HTTP race test in
    // admin-time-grants.test.ts, which drives the SAME production code path
    // through the route. The deterministic test owns the DB/domain evidence
    // only (ledger, deadline, recovery txid).
    const barrier = createRaceBarrier();
    const observer1 = createBarrierBackedObserver(
      barrier,
      "T1",
      sharedOpId,
      a1.attemptId,
    );
    const observer2 = createBarrierBackedObserver(
      barrier,
      "T2",
      sharedOpId,
      a2.attemptId,
    );

    const t1Promise = grantWithOperationRaceRecovery(db1, adminCtx, input1, {
      observer: observer1,
      label: "T1",
    });
    const t2Promise = grantWithOperationRaceRecovery(db2, adminCtx, input2, {
      observer: observer2,
      label: "T2",
    });

    try {
      // ── 6. Wait for both to read absent (inside their txns) ───────────
      const t1Obs = await barrier.t1ReadAbsent.promise;
      const t2Obs = await barrier.t2ReadAbsent.promise;
      expect(t1Obs.operationId).toBe(sharedOpId);
      expect(t1Obs.attemptId).toBe(a1.attemptId);
      expect(t2Obs.operationId).toBe(sharedOpId);
      expect(t2Obs.attemptId).toBe(a2.attemptId);
      // Distinct PIDs captured INSIDE the transaction callbacks.
      expect(t1Obs.pid).not.toBe(t2Obs.pid);
      expect(t1Obs.txid).toBeTruthy();
      expect(t2Obs.txid).toBeTruthy();
      expect(t1Obs.txid).not.toBe(t2Obs.txid);

      // ── 7. Release T1, await its commit on the production path ────────
      barrier.releaseT1.resolve();
      const t1Result = await t1Promise;
      expect(t1Result.outcome).toBe("granted");
      expect(t1Result.adjustment).not.toBeNull();
      expect(t1Result.adjustment!.operationId).toBe(sharedOpId);
      expect(t1Result.adjustment!.attemptId).toBe(a1.attemptId);
      expect(t1Result.addedSeconds).toBe(addedSeconds);

      // T1 committed BEFORE T2's violation — causal ordering proof. The
      // determinism comes from the code committing T1 before T2's insert
      // fails, observed here (not merely enforced by the barrier).
      const t1CommitObs = await barrier.t1PrimaryCommitted.promise;
      expect(t1CommitObs.outcome).toBe("granted");

      // ── 8. Release T2; it must violate then recover to a conflict ─────
      barrier.releaseT2.resolve();
      // Recovery must NOT succeed — it must throw IdempotencyConflictError.
      // Track resolution separately so a misbehaving recovery that resolves
      // instead of rejecting surfaces as "T2 recovery unexpectedly succeeded",
      // not as a misleading "expected IdempotencyConflictError". (The previous
      // form let expect(t2Result).toBeNull()'s AssertionError be caught into
      // t2Error and then mis-reported as a type mismatch.)
      let t2Resolved = false;
      let t2Error: unknown = null;
      try {
        await t2Promise;
        t2Resolved = true;
      } catch (err) {
        t2Error = err;
      }
      expect(t2Resolved, "T2 recovery unexpectedly succeeded").toBe(false);
      expect(t2Error).toBeInstanceOf(IdempotencyConflictError);

      // ── 9. The violation evidence comes from the REAL caught error ────
      const violationObs = await barrier.t2UniqueViolation.promise;
      expect(violationObs.code).toBe("23505");
      expect(violationObs.constraint).toBe(OPERATION_UNIQUE_CONSTRAINT);
      expect(violationObs.txid).toBe(t2Obs.txid);

      // ── 10. Recovery is a FRESH transaction with a distinct txid ──────
      const recoveryObs = await barrier.t2RecoveryStarted.promise;
      expect(recoveryObs.txid).not.toBe(t2Obs.txid);

      // Signal that recovery rejected with conflict (the production module
      // cannot observe its own thrown error, so the test resolves this after
      // catching it above).
      barrier.t2RecoveryRejectedWithConflict.resolve();
    } finally {
      // Settle every outstanding deferred + clear every timer so an
      // unawaited deferred cannot time out 10s later.
      barrier.dispose();
      // Wait for both transactions to truly finish before letting the test
      // exit. On a mid-assertion failure, dispose() releases the barrier gates
      // but does NOT await the in-flight transactions; without this, the test
      // could exit while T1/T2 are still running, racing afterAll' teardown
      // (connection close + schema drop).
      await Promise.allSettled([t1Promise, t2Promise]);
    }

    // ── 11. Final DB invariants: exactly one ledger row, on A1 ───────────
    const ledgerRows = await ctx.db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.operationId, sharedOpId));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]!.attemptId).toBe(a1.attemptId);
    expect(ledgerRows[0]!.source).toBe("operator");
    expect(ledgerRows[0]!.addedSeconds).toBe(addedSeconds);

    // ── 12. Deadline effects: A1 advanced, A2 unchanged ──────────────────
    const afterA1 = (await attemptRepo.findById(adminCtx, a1.attemptId))!
      .deadlineAt!;
    const afterA2 = (await attemptRepo.findById(adminCtx, a2.attemptId))!
      .deadlineAt!;
    expect(afterA1.getTime()).toBe(beforeA1.getTime() + addedSeconds * 1000);
    expect(afterA2.getTime()).toBe(beforeA2.getTime());

    // ── 13. No second ledger row for A2 ───────────────────────────────────
    const a2Ledger = await ctx.db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.attemptId, a2.attemptId));
    expect(a2Ledger).toHaveLength(0);
  }, 30_000);
});
