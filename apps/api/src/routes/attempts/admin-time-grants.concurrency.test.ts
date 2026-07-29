/**
 * REC-I4-V1 — Deterministic PostgreSQL Operator-Grant Concurrency Verification.
 *
 * Proves that two concurrent operator-grant commands with the same `operationId`
 * but targeting different Attempts (different Exams, so no row-lock overlap)
 * deterministically resolve to:
 *   1. T1 wins (granted, one ledger row, deadline advanced)
 *   2. T2 loses (23505 unique violation → fresh transaction → IDEMPOTENCY_CONFLICT)
 *
 * Uses two physical PostgreSQL connections (verified distinct PIDs), explicit
 * barrier/latch coordination, and fresh-transaction recovery observation.
 *
 * @see docs/audits/REC-I4-V1-OPERATOR-GRANT-POSTGRES-CONCURRENCY.md
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import { IdempotencyConflictError } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { createRaceBarrier } from "../../testing/barrier.js";
import {
  runGrantWithRaceRecovery,
  getBackendPid,
  OPERATION_UNIQUE_CONSTRAINT,
} from "../../testing/operatorGrantConcurrencyHarness.js";

const TEST_PREFIX = "rec-i4-v1-";

describe("REC-I4-V1: deterministic operationId race recovery", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let db1: Database;
  let db2: Database;
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };

  beforeAll(async () => {
    // Create an isolated schema for this test file.
    const testDbUrl =
      process.env.TEST_DATABASE_URL ??
      process.env.TEST_DB_URL ??
      (() => {
        throw new Error("TEST_DATABASE_URL or TEST_DB_URL must be set");
      })();
    iso = await setupIsolatedTestDb({
      namespace: "api",
      databaseUrl: testDbUrl,
    });

    // Build the test app with this schema.
    ctx = await buildTestApp(
      async (fastify) => {
        await fastify.register(examRoutes, { prefix: "" });
        await fastify.register(attemptRoutes, { prefix: "" });
      },
      { schemaName: iso.schemaName },
    );

    // Create two separate PostgreSQL connections to the SAME schema.
    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db1 = conn1.db;
    db2 = conn2.db;
    sql1 = conn1.sql;
    sql2 = conn2.sql;

    // Verify the two connections are physically distinct.
    const pid1 = await getBackendPid(db1);
    const pid2 = await getBackendPid(db2);
    if (pid1 === pid2) {
      throw new Error(
        `PID collision: both connections have PID ${pid1}. ` +
          "The two connections must be distinct physical backends. " +
          "Check that postgres-js created separate connections.",
      );
    }
  }, 60_000);

  afterAll(async () => {
    // Clean up in reverse order.
    if (sql2) await sql2.end().catch(() => {});
    if (sql1) await sql1.end().catch(() => {});
    if (ctx) await ctx.cleanup().catch(() => {});
    if (iso) await iso.cleanup().catch(() => {});
  }, 30_000);

  /**
   * Creates a test organization with admin user, course, question, and starts
   * an operator_incident attempt. Returns the org context and attempt info.
   */
  async function createTestOrgAndAttempt(
    label: string,
    durationMinutes = 60,
  ): Promise<{
    orgId: string;
    adminUserId: string;
    adminToken: string;
    attemptId: string;
    examId: string;
  }> {
    const slug = `${TEST_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
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
      },
      jwtSecret,
    );

    // Create course
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

    // Create question
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

    // Create exam with operator_incident policy
    const exam = (
      await ctx.db
        .insert(schema.exams)
        .values({
          id: randomUUID(),
          organizationId: org.id,
          title: `Exam ${slug}`,
          description: "",
          courseId: course.id,
          status: "open",
          timingMode: "timed_window",
          durationMinutes,
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

    // Publish exam
    await ctx.db
      .update(schema.exams)
      .set({ status: "open" })
      .where(eq(schema.exams.id, exam.id));

    // Create candidate profile
    const candidateId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: candidateId,
      organizationId: org.id,
      username: `cand-${slug}`,
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
      },
      jwtSecret,
    );

    // Enroll candidate
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${exam.id}/enrollments`,
      payload: { candidateIds: [profile.id] },
      cookies: { "auth-token": adminToken },
    });

    // Start attempt
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
    const attemptId = startRes.json().id as string;

    return {
      orgId: org.id,
      adminUserId: adminId,
      adminToken,
      attemptId,
      examId: exam.id,
    };
  }

  it("deterministically fixes T1 as winner, recovers T2 as IDEMPOTENCY_CONFLICT", async () => {
    // ── 1. Create two test orgs, each with one attempt ────────────────
    const orgA = await createTestOrgAndAttempt("A");
    const orgB = await createTestOrgAndAttempt("B");

    // We need both attempts to be in the SAME organization for the
    // (organization_id, operation_id) unique index to apply.
    // Use orgA's org for both attempts.
    // Re-create orgB's attempt under orgA's org.
    const orgA2 = await createTestOrgAndAttempt("A2");
    // Actually, the operationId unique index is scoped to organization_id.
    // Two different orgs would not conflict. We need the same org.
    // Let's use a single org with two exams.

    // Cleaner approach: create one org with two exams.
    // Re-use orgA's org for both. But orgA2 uses a different org.
    // Let me restructure: create ONE org and create two attempts under it.

    // Actually, the simplest approach: create a single org, two exams,
    // enroll the same candidate, start two attempts.

    // Let me do this properly...
    // Create a single org
    const slug = `${TEST_PREFIX}combined-${randomUUID().slice(0, 8)}`;
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
      },
      jwtSecret,
    );

    // Create course
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

    // Create question
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

    // Create TWO exams, both with operator_incident
    const createExam = async (examTitle: string) => {
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

      // Create candidate
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
        },
        jwtSecret,
      );

      // Enroll
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${exam.id}/enrollments`,
        payload: { candidateIds: [profile.id] },
        cookies: { "auth-token": adminToken },
      });

      // Start attempt
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
      const attemptId = startRes.json().id as string;

      return { examId: exam.id, attemptId, candidateToken };
    };

    const exam1 = await createExam("Race Exam A1");
    const exam2 = await createExam("Race Exam A2");

    // Verify A1 != A2 (different attempts)
    expect(exam1.attemptId).not.toBe(exam2.attemptId);

    // ── 2. Record initial deadlines ────────────────────────────────────
    const attemptRepo = createAttemptRepo(ctx.db);
    const tenantCtx = {
      organizationId: org.id,
      actorId: adminId,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      targetOrganizationId: org.id,
    };

    const beforeA1 = (await attemptRepo.findById(tenantCtx, exam1.attemptId))!
      .deadlineAt!;
    const beforeA2 = (await attemptRepo.findById(tenantCtx, exam2.attemptId))!
      .deadlineAt!;

    // ── 3. Prepare the shared operationId ──────────────────────────────
    const sharedOpId = randomUUID();
    const addedSeconds = 300;
    const grantNow = new Date();

    const input1: import("@exam/exam-engine").GrantAttemptTimeInput = {
      attemptId: exam1.attemptId,
      operationId: sharedOpId,
      addedSeconds,
      reasonCode: "technical_incident",
      reasonText: "race scenario attempt A1",
      interruptionId: null,
      incidentId: null,
      actorId: adminId,
      now: grantNow,
    };

    const input2: import("@exam/exam-engine").GrantAttemptTimeInput = {
      attemptId: exam2.attemptId,
      operationId: sharedOpId,
      addedSeconds,
      reasonCode: "technical_incident",
      reasonText: "race scenario attempt A2",
      interruptionId: null,
      incidentId: null,
      actorId: adminId,
      now: grantNow,
    };

    // ── 4. Create the barrier and launch both transactions ─────────────
    const barrier = createRaceBarrier();

    // T1 runs on db1, T2 runs on db2.
    const t1Promise = runGrantWithRaceRecovery(
      db1,
      tenantCtx,
      input1,
      barrier,
      "T1",
    );
    const t2Promise = runGrantWithRaceRecovery(
      db2,
      tenantCtx,
      input2,
      barrier,
      "T2",
    );

    // ── 5. Wait for both to read absent ────────────────────────────────
    const t1Obs = await barrier.t1ReadAbsent.promise;
    const t2Obs = await barrier.t2ReadAbsent.promise;

    // Assert both observed absent
    expect(t1Obs.operationId).toBe(sharedOpId);
    expect(t1Obs.attemptId).toBe(exam1.attemptId);
    expect(t2Obs.operationId).toBe(sharedOpId);
    expect(t2Obs.attemptId).toBe(exam2.attemptId);

    // ── 6. Prove distinct physical connections ─────────────────────────
    expect(t1Obs.pid).not.toBe(t2Obs.pid);
    // PID evidence is logged to the audit document, not to stdout.

    // ── 7. Release T1, wait for commit ─────────────────────────────────
    barrier.releaseT1.resolve();
    const t1Result = await t1Promise;

    expect(t1Result.outcome).toBe("granted");
    expect(t1Result.adjustment).not.toBeNull();
    expect(t1Result.adjustment!.operationId).toBe(sharedOpId);
    expect(t1Result.adjustment!.attemptId).toBe(exam1.attemptId);
    expect(t1Result.addedSeconds).toBe(addedSeconds);

    // ── 8. Release T2, wait for completion ─────────────────────────────
    barrier.releaseT2.resolve();

    // T2 should throw IdempotencyConflictError (caught from the recovery
    // path, which propagates the domain error thrown by grantAttemptTime).
    let t2Error: unknown = null;
    let t2Result: import("@exam/exam-engine").GrantAttemptTimeResult | null =
      null;
    try {
      t2Result = await t2Promise;
      // If recovery somehow succeeded, that's a test failure.
      // But the recovery should throw IdempotencyConflictError.
    } catch (err) {
      t2Error = err;
    }

    // ── 9. Observe T2 unique violation ─────────────────────────────────
    const violationObs = await barrier.t2UniqueViolation.promise;
    expect(violationObs.code).toBe("23505");
    expect(violationObs.constraint).toBe(OPERATION_UNIQUE_CONSTRAINT);

    // ── 10. Observe T2 recovery ────────────────────────────────────────
    const recoveryObs = await barrier.t2RecoveryStarted.promise;
    expect(recoveryObs.pid).toBeGreaterThan(0);

    // ── 11. Verify T2 result ───────────────────────────────────────────
    expect(t2Error).not.toBeNull();
    expect(t2Error).toBeInstanceOf(IdempotencyConflictError);

    // ── 12. Final DB state: exactly one ledger row ─────────────────────
    const ledgerRows = await ctx.db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.operationId, sharedOpId));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]!.attemptId).toBe(exam1.attemptId);
    expect(ledgerRows[0]!.source).toBe("operator");
    expect(ledgerRows[0]!.addedSeconds).toBe(addedSeconds);

    // ── 13. Verify deadline effects ────────────────────────────────────
    const afterA1 = (await attemptRepo.findById(tenantCtx, exam1.attemptId))!
      .deadlineAt!;
    const afterA2 = (await attemptRepo.findById(tenantCtx, exam2.attemptId))!
      .deadlineAt!;

    // A1: deadline advanced by exactly addedSeconds
    expect(afterA1.getTime()).toBe(beforeA1.getTime() + addedSeconds * 1000);

    // A2: deadline unchanged
    expect(afterA2.getTime()).toBe(beforeA2.getTime());

    // ── 14. No second ledger row for A2 ────────────────────────────────
    const a2Ledger = await ctx.db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.attemptId, exam2.attemptId));
    expect(a2Ledger).toHaveLength(0);

    // ── 15. Verify T1 response details ─────────────────────────────────
    expect(t1Result.attempt.id).toBe(exam1.attemptId);
    expect(t1Result.attempt.deadlineAt!.getTime()).toBe(
      beforeA1.getTime() + addedSeconds * 1000,
    );
  }, 30_000);
});
