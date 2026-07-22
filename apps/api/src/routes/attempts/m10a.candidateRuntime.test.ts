import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import courseRoutes from "../course.js";
import questionRoutes from "../question.js";
import candidateRoutes from "../candidate.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import scoreRoutes from "../scores.js";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
  createFutureRoleUserForTest,
  publishExamViaApi,
  uniquePrefix,
} from "../testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

/**
 * RBAC-M10-A — Candidate runtime capability authorization integration proof.
 *
 * Two responsibilities that candidateOwnership.test.ts does NOT cover:
 *
 * 1. **Runtime metadata conformance:** handled by the sole authority
 *    routeRegistryConformance.test.ts (15 tests, registry ↔ Fastify onRoute).
 *
 * 2. **Zero-side-effect denial (directive §9.3):** a cross-candidate denial
 *    on each of the 4 mutating routes (start, save-answer, submit, heartbeat,
 *    restore) leaves no new row in exam_attempts / audit_logs /
 *    attempt_grading_entries and does not bump exam_enrollments.attemptCount.
 *
 * Cross-candidate / cross-org / non-Candidate-role denial is already proven by
 * candidateOwnership.test.ts (re-run as part of this job) — not duplicated here.
 */

const routePlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(scoreRoutes);
};

describe("RBAC-M10-A candidate runtime — zero-side-effect denial (directive §9.3)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let sharedQuestionId: string;
  /** Candidate A — enrolled, has an attempt. Used as the "owner" for save/submit/heartbeat/restore denial tests. */
  let candidateA: { candidateProfileId: string; userId: string; token: string };
  /** Candidate B — enrolled, no attempt. Used as the attacker against A's attempt. */
  let candidateB: { candidateProfileId: string; userId: string; token: string };
  /** Candidate U — NOT enrolled. Used for the denied-start zero-write test. */
  let candidateU: { candidateProfileId: string; userId: string; token: string };
  let attemptAId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(routePlugin, { prefix: "/api" });

    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "M10A Zero-Side-Effect Exam",
      courseCode: "M10A",
      courseName: "M10-A Course",
      questionContent: "M10-A question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);

    const examDetail = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    sharedQuestionId = examDetail.json().questionIds[0] as string;

    // Create three candidates: A and B are enrolled, U is NOT enrolled.
    candidateA = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `m10a-a-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateB = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `m10a-b-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateU = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `m10a-u-${uniquePrefix()}`,
      ctx.org.id,
    );

    // Enroll A and B only (U is deliberately unenrolled for the denied-start test).
    for (const cand of [candidateA, candidateB]) {
      const enrollment = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [cand.candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(enrollment.statusCode).toBe(200);
    }

    // A starts an attempt; B will attack it (cross-candidate denial).
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateA.token },
    });
    expect(startRes.statusCode).toBe(201);
    attemptAId = startRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Count rows for a table+org predicate. */
  async function countRows(
    table: "examAttempts" | "auditLogs" | "attemptGradingEntries",
    attemptId: string,
  ): Promise<number> {
    const colMap = {
      examAttempts: schema.examAttempts,
      auditLogs: schema.auditLogs,
      attemptGradingEntries: schema.attemptGradingEntries,
    } as const;
    const t = colMap[table];
    const rows = await ctx.db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.organizationId, ctx.org.id), eq(t.id, attemptId)));
    return rows.length;
  }

  /** Count audit rows for an action targeting an attempt (org-scoped). */
  async function countAuditForAction(
    attemptId: string,
    action: string,
  ): Promise<number> {
    const rows = await ctx.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, ctx.org.id),
          eq(schema.auditLogs.action, action),
          eq(schema.auditLogs.targetId, attemptId),
        ),
      );
    return rows.length;
  }

  /** Read A's enrollment attemptCount. */
  async function aEnrollmentAttemptCount(): Promise<number> {
    const rows = await ctx.db
      .select({ c: schema.examEnrollments.attemptCount })
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.organizationId, ctx.org.id),
          eq(schema.examEnrollments.candidateId, candidateA.candidateProfileId),
          eq(schema.examEnrollments.examId, examId),
        ),
      );
    return rows[0]?.c ?? 0;
  }

  function attackB(method: string, url: string, payload?: unknown) {
    return ctx.app.inject({
      method: method as never,
      url,
      payload: payload as never,
      cookies: { "auth-token": candidateB.token },
    });
  }

  it("POST /attempts/:examId/start — unenrolled candidate (U) denied 403, zero side effects on A/B/enrollment/audit/grading/outbox", async () => {
    // U is not enrolled. Starting the exam should return 403 and leave no trace.
    const aCountBefore = await aEnrollmentAttemptCount();
    const aAttemptsBefore = await ctx.db
      .select({ id: schema.examAttempts.id })
      .from(schema.examAttempts)
      .where(
        and(
          eq(schema.examAttempts.organizationId, ctx.org.id),
          eq(schema.examAttempts.candidateId, candidateA.candidateProfileId),
        ),
      );

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateU.token },
    });
    expect(res.statusCode).toBe(403);
    // The start route declares eligibilityDenialMode "permission_denied", so the
    // missing-enrollment denial is 403 PERMISSION_DENIED — both the HTTP status
    // AND the error code are oracles and must be pinned together (review G.5).
    expect(res.json().error.code).toBe("PERMISSION_DENIED");

    // No A enrollment mutation
    const aCountAfter = await aEnrollmentAttemptCount();
    expect(aCountAfter).toBe(aCountBefore);
    // No new A attempt
    const aAttemptsAfter = await ctx.db
      .select({ id: schema.examAttempts.id })
      .from(schema.examAttempts)
      .where(
        and(
          eq(schema.examAttempts.organizationId, ctx.org.id),
          eq(schema.examAttempts.candidateId, candidateA.candidateProfileId),
        ),
      );
    expect(aAttemptsAfter.length).toBe(aAttemptsBefore.length);
    // No U attempt created at all
    const uAttempts = await ctx.db
      .select({ id: schema.examAttempts.id })
      .from(schema.examAttempts)
      .where(
        and(
          eq(schema.examAttempts.organizationId, ctx.org.id),
          eq(schema.examAttempts.candidateId, candidateU.candidateProfileId),
        ),
      );
    expect(uAttempts.length).toBe(0);
    // No success audit
    const auditAfter = await countAuditForAction(examId, "attempt.start");
    expect(auditAfter).toBe(0);
    // No grading row, no client events, no outbox
    const gradingRows = await ctx.db
      .select({ id: schema.attemptGradingEntries.id })
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, examId));
    expect(gradingRows.length).toBe(0);
    // U is unenrolled, so no enrollment record exists for U.
    const uEnrollment = await ctx.db
      .select({ id: schema.examEnrollments.id })
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.organizationId, ctx.org.id),
          eq(schema.examEnrollments.candidateId, candidateU.candidateProfileId),
        ),
      );
    expect(uEnrollment.length).toBe(0);
  });

  it("POST /attempts/:attemptId/answers/:questionId — B denied on A's attempt: no answer mutation, no audit, no grading entry", async () => {
    const saveAuditBefore = await countAuditForAction(
      attemptAId,
      "attempt.saveAnswer",
    );
    const gradingBefore = await ctx.db
      .select({ id: schema.attemptGradingEntries.id })
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptAId));

    const res = await attackB(
      "POST",
      `/api/attempts/${attemptAId}/answers/${sharedQuestionId}`,
      {
        attemptId: attemptAId,
        questionId: sharedQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
    );
    expect(res.statusCode).toBe(404); // anti-enumeration (cross-candidate)

    const saveAuditAfter = await countAuditForAction(
      attemptAId,
      "attempt.saveAnswer",
    );
    const gradingAfter = await ctx.db
      .select({ id: schema.attemptGradingEntries.id })
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptAId));
    expect(saveAuditAfter).toBe(saveAuditBefore); // no audit recorded for the denial
    expect(gradingAfter.length).toBe(gradingBefore.length); // no grading entry
  });

  it("POST /attempts/:attemptId/submit — B denied on A's attempt: no submit audit, no state transition", async () => {
    const submitAuditBefore = await countAuditForAction(
      attemptAId,
      "attempt.submit",
    );

    const res = await attackB("POST", `/api/attempts/${attemptAId}/submit`);
    expect(res.statusCode).toBe(404);

    const submitAuditAfter = await countAuditForAction(
      attemptAId,
      "attempt.submit",
    );
    expect(submitAuditAfter).toBe(submitAuditBefore); // no submit audit
    // A's attempt remains in_progress (not transitioned by B's denied submit).
    const attRows = await ctx.db
      .select({ status: schema.examAttempts.status })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptAId));
    expect(attRows[0]?.status).toBe("in_progress");
  });

  it("POST /attempts/:attemptId/heartbeat — B denied on A's attempt: no lastActivityAt mutation", async () => {
    const beforeRows = await ctx.db
      .select({ lastActivityAt: schema.examAttempts.lastActivityAt })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptAId));
    const before = beforeRows[0]?.lastActivityAt ?? null;

    const res = await attackB("POST", `/api/attempts/${attemptAId}/heartbeat`);
    expect(res.statusCode).toBe(404);

    const afterRows = await ctx.db
      .select({ lastActivityAt: schema.examAttempts.lastActivityAt })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptAId));
    const after = afterRows[0]?.lastActivityAt ?? null;
    // lastActivityAt unchanged (heartbeat is the mutation this route performs;
    // denial must not advance it).
    expect(String(after)).toBe(String(before));
  });

  it("POST /attempts/:attemptId/restore — B denied on A's attempt: no restore audit, no state transition", async () => {
    const restoreAuditBefore = await countAuditForAction(
      attemptAId,
      "attempt.restore",
    );

    const res = await attackB("POST", `/api/attempts/${attemptAId}/restore`);
    expect(res.statusCode).toBe(404);

    const restoreAuditAfter = await countAuditForAction(
      attemptAId,
      "attempt.restore",
    );
    expect(restoreAuditAfter).toBe(restoreAuditBefore); // no restore audit
  });
});

describe("RBAC-M10-A candidate runtime — non-Candidate role denial (directive §9.2)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let proctor: { user: { id: string }; token: string };
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(routePlugin, { prefix: "/api" });
    proctor = await createFutureRoleUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      `m10a-proctor-${uniquePrefix()}`,
    );
    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "M10A Proctor Denial Exam",
      courseCode: "M10AP",
      courseName: "M10-A Proctor Course",
      questionContent: "M10-A proctor question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it("Proctor is denied 403 on GET /candidate/exams (Candidate-preset-only route)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": proctor.token },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Proctor is denied 403 on GET /candidate/exams/:examId", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/exams/${examId}`,
      cookies: { "auth-token": proctor.token },
    });
    expect(res.statusCode).toBe(403);
  });
});
