import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { materializeGradingWorkset } from "@exam/exam-engine";
import { createGradingWorksetRepoAdapter } from "../../adapters/repoAdapters.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getSaveAnswerMessage } from "@exam/contracts";
import {
  buildExamPayload,
  enrollCandidateForExam,
  buildSharedAttemptFixture,
  disruptAttempt,
} from "./attempts.testHelpers.js";

async function installSubmitAuditFailure(
  db: Awaited<ReturnType<typeof buildTestApp>>["db"],
): Promise<() => Promise<void>> {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `fail_submit_audit_${suffix}`;
  const triggerName = `fail_submit_audit_trigger_${suffix}`;
  await db.execute(
    sql.raw(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected submit audit failure';
      END;
      $$ LANGUAGE plpgsql
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      WHEN (NEW.action = 'attempt.submit')
      EXECUTE FUNCTION ${functionName}()
    `),
  );
  return async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`),
    );
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
  };
}

describe("attempt routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let courseId: string;
  let questionId: string;
  let fillBlankQuestionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    const fixture = await buildSharedAttemptFixture();
    ctx = fixture.ctx;
    examId = fixture.examId;
    courseId = fixture.courseId;
    questionId = fixture.questionId;
    fillBlankQuestionId = fixture.fillBlankQuestionId;
    candidateProfileId = fixture.candidateProfileId;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("GET /candidate/exams/:examId", () => {
    it("returns active attempt metadata without creating a new attempt", async () => {
      const examResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Resume Exam",
          courseId,
          questionIds: [questionId],
          retakePolicy: "max_attempts",
          maxAttempts: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const resumeExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${resumeExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, resumeExamId);

      const startResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${resumeExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startResponse.json().id as string;

      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const beforeList = await createAttemptRepo(ctx.db).findByExamAndCandidate(
        candidateCtx,
        resumeExamId,
        candidateProfileId,
      );

      const detailResponse = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/exams/${resumeExamId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json()).toMatchObject({
        id: resumeExamId,
        currentAttempts: 1,
        maxAttempts: 1,
        activeAttemptId: attemptId,
        canStartNewAttempt: false,
      });

      const afterList = await createAttemptRepo(ctx.db).findByExamAndCandidate(
        candidateCtx,
        resumeExamId,
        candidateProfileId,
      );
      expect(afterList).toHaveLength(beforeList.length);
    });

    it("returns max-attempt blocking reason after all attempts are used", async () => {
      const examResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Blocked Exam",
          courseId,
          questionIds: [questionId],
          retakePolicy: "max_attempts",
          maxAttempts: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const blockedExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${blockedExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, blockedExamId);

      const startResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${blockedExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      const detailResponse = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/exams/${blockedExamId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json()).toMatchObject({
        currentAttempts: 1,
        maxAttempts: 1,
        canStartNewAttempt: false,
        blockingReason: "max_attempts_reached",
      });
    });
  });

  describe("GET /attempts/:id", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam2 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Load Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId2 = exam2.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId2}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId2);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId2}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;
    });

    it("returns attempt without standardAnswer", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/attempts/${attemptId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(attemptId);
      expect(body.questionSnapshot).toHaveLength(1);
      expect(body.questionSnapshot[0]).not.toHaveProperty("standardAnswer");
      expect(body.questionSnapshot[0]).toHaveProperty("content");
    });

    it("returns 400 for malformed attempt id", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/attempts/nonexistent",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(400);
    });

    it("does not expose another candidate's attempt", async () => {
      const userId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: userId,
        organizationId: ctx.org.id,
        username: `candidate-${userId}`,
        passwordHash: "unused",
        name: "Other Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await ctx.db.insert(schema.candidateProfiles).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const token = signJWT({
        actorId: userId,
        role: "Candidate",
        organizationId: ctx.org.id,
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/attempts/${attemptId}`,
        cookies: { "auth-token": token },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /attempts/:attemptId/answers/:questionId", () => {
    let attemptId: string;
    let qId: string;

    beforeAll(async () => {
      const exam3 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Answer Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId3 = exam3.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId3}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId3);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId3}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;
      qId = startRes.json().questionSnapshot[0].originalQuestionId;
    });

    it("saves answer successfully", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(true);
      expect(body.serverVersion).toBe(1);
      expect(body.savedAt).toBeDefined();
      const auditRows = await ctx.db
        .select({ id: schema.auditLogs.id })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, "attempt.saveAnswer"),
            eq(schema.auditLogs.targetId, attemptId),
          ),
        );
      expect(auditRows).toEqual([]);
    });

    it("returns idempotent result for same clientSeq", async () => {
      const res1 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      const savedAt = res1.json().savedAt;

      const res2 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res2.json().accepted).toBe(true);
      expect(res2.json().serverVersion).toBe(res1.json().serverVersion);
      expect(res2.json().savedAt).toBe(savedAt);
      const auditRows = await ctx.db
        .select({ id: schema.auditLogs.id })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, "attempt.saveAnswer"),
            eq(schema.auditLogs.targetId, attemptId),
          ),
        );
      expect(auditRows).toEqual([]);
    });

    it("accepts new version with correct baseVersion", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "c",
          clientSeq: 2,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 1,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(true);
      expect(res.json().serverVersion).toBe(2);
    });

    it("replays an older clientSeq after a newer version is saved", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(true);
      expect(res.json().serverVersion).toBe(1);
    });

    it("rejects stale version", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "a",
          clientSeq: 3,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.json().accepted).toBe(false);
      expect(res.json().reason).toBe("STALE_VERSION");
      expect(res.json().message).toBe(getSaveAnswerMessage("STALE_VERSION"));
      expect(res.json().serverVersion).toBe(2);
      expect(res.json().details).toEqual({ serverAnswer: "c" });
    });

    it("preserves a null server answer in stale-version details", async () => {
      const saveNull = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: null,
          clientSeq: 4,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 2,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(saveNull.json().accepted).toBe(true);

      const stale = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "late",
          clientSeq: 5,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 2,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(stale.json()).toMatchObject({
        accepted: false,
        reason: "STALE_VERSION",
        serverVersion: 3,
        details: { serverAnswer: null },
      });
    });

    it("returns 400 for malformed save payload", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          clientSeq: -1,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects answers for questions outside the attempt snapshot", async () => {
      const otherQuestionId = crypto.randomUUID();
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${otherQuestionId}`,
        payload: {
          attemptId,
          questionId: otherQuestionId,
          answer: "b",
          clientSeq: 4,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /attempts/:attemptId/submit", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam4 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Submit Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId4 = exam4.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId4}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId4);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId4}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;
    });

    it("rolls back the service-owned submit transition when audit insertion fails", async () => {
      const removeFailure = await installSubmitAuditFailure(ctx.db);
      try {
        const response = await ctx.app.inject({
          method: "POST",
          url: `/api/attempts/${attemptId}/submit`,
          cookies: { "auth-token": ctx.candidateToken },
        });

        expect(response.statusCode).toBe(500);
        const attempts = await ctx.db
          .select({ status: schema.examAttempts.status })
          .from(schema.examAttempts)
          .where(eq(schema.examAttempts.id, attemptId));
        expect(attempts[0]?.status).toBe("in_progress");
        const auditRows = await ctx.db
          .select({ id: schema.auditLogs.id })
          .from(schema.auditLogs)
          .where(
            and(
              eq(schema.auditLogs.action, "attempt.submit"),
              eq(schema.auditLogs.targetId, attemptId),
            ),
          );
        expect(auditRows).toHaveLength(0);
      } finally {
        await removeFailure();
      }
    });

    it("submits in_progress attempt", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("graded");
      expect(res.json().score).toBe(0);
      expect(res.json().passed).toBe(false);
      expect(res.json().submittedAt).toBeDefined();
      expect(res.json().questionSnapshot[0]).not.toHaveProperty(
        "standardAnswer",
      );
      const auditRows = await ctx.db
        .select({ id: schema.auditLogs.id })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, "attempt.submit"),
            eq(schema.auditLogs.targetId, attemptId),
          ),
        );
      expect(auditRows).toHaveLength(1);
    });

    it("idempotent: re-submitting a graded attempt returns the graded result (FIX-2)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("graded");
      expect(body.score).toBe(0);
      expect(body.passed).toBe(false);
      const auditRows = await ctx.db
        .select({ id: schema.auditLogs.id })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, "attempt.submit"),
            eq(schema.auditLogs.targetId, attemptId),
          ),
        );
      expect(auditRows).toHaveLength(1);
    });
  });

  describe("POST /attempts/:attemptId/submit — minSubmitAfterStartMinutes guard (ADR-005 Slice 3)", () => {
    it("rejects candidate submit too early with 409 ATTEMPT_SUBMIT_TOO_EARLY", async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "MinSubmit Exam",
          courseId,
          questionIds: [questionId],
          minSubmitAfterStartMinutes: 60,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId = examRes.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId);
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id;

      // Submit immediately (well under 60 min) -> 409.
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("ATTEMPT_SUBMIT_TOO_EARLY");
      expect(res.json().error.details?.remainingSeconds).toBeGreaterThan(0);
    });
  });

  describe("POST /attempts/:attemptId/submit — idempotent retry-grading (FIX-2)", () => {
    let retryExamId: string;

    beforeAll(async () => {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Retry Grading Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      retryExamId = exam.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${retryExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, retryExamId);
    });

    it("re-grades an attempt stuck in submitted after a crash", async () => {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${retryExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const stuckAttemptId = startRes.json().id as string;

      const qId = startRes.json().questionSnapshot[0].originalQuestionId;
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${stuckAttemptId}/answers/${qId}`,
        payload: {
          attemptId: stuckAttemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      await ctx.db
        .update(schema.examAttempts)
        .set({
          status: "submitted",
          submittedAt: new Date(),
          submittedAnswers: {
            schemaVersion: 1,
            answers: [{ questionId: qId, value: "b" }],
          },
          gradingStatus: "auto_graded",
          updatedAt: new Date(),
        })
        .where(eq(schema.examAttempts.id, stuckAttemptId));

      // Slice 4: the submit freeze barrier materializes grading workset
      // entries atomically with the status flip, so a real crashed-after-submit
      // row ALWAYS carries its workset. Simulate that faithfully: re-read the
      // frozen attempt and materialize the workset via the same production
      // helper the crashed submit would have used.
      const adminCtx = {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const frozenAttempt = await createAttemptRepo(ctx.db).findById(
        adminCtx,
        stuckAttemptId,
      );
      await materializeGradingWorkset(
        frozenAttempt! as never,
        createGradingWorksetRepoAdapter(
          createAttemptGradingEntryRepo(ctx.db),
          adminCtx,
        ),
      );

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${stuckAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("graded");
      expect(submitRes.json().score).toBe(100);
      expect(submitRes.json().passed).toBe(true);
    });
  });

  describe("POST /attempts/:attemptId/answers — deadline contract (FIX-1)", () => {
    let deadlineContractExamId: string;

    beforeAll(async () => {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Deadline Contract Exam",
          courseId,
          questionIds: [questionId],
          durationMinutes: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      deadlineContractExamId = exam.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${deadlineContractExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(
        ctx,
        candidateProfileId,
        deadlineContractExamId,
      );
    });

    afterEach(() => {
      ctx.setNow(null);
    });

    it("rejects save-answer after deadline with DEADLINE_EXCEEDED, but still allows submit of saved answers", async () => {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${deadlineContractExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      const saveBefore = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(saveBefore.json().accepted).toBe(true);

      ctx.setNow(new Date(Date.now() + 5 * 60 * 1000));

      const saveAfter = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "a",
          clientSeq: 2,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 1,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(saveAfter.statusCode).toBe(200);
      expect(saveAfter.json().accepted).toBe(false);
      // P3-L0-3: lazy deadline reconciliation now freezes the attempt at the
      // save entry point before the save is evaluated, so the rejection reason
      // is ATTEMPT_ALREADY_SUBMITTED (the attempt was deadline-submitted),
      // not the legacy DEADLINE_EXCEEDED. Both communicate the same invariant:
      // no save accepted past the deadline.
      expect(saveAfter.json().reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
      expect(saveAfter.json().message).toBe(
        getSaveAnswerMessage("ATTEMPT_ALREADY_SUBMITTED"),
      );

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("graded");
      expect(submitRes.json().score).toBe(100);
    });
  });

  describe("POST /attempts/:attemptId/submit — deadline 行为", () => {
    let deadlineExamId: string;

    beforeAll(async () => {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Deadline Submit Exam",
          courseId,
          questionIds: [questionId],
          durationMinutes: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      deadlineExamId = exam.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${deadlineExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, deadlineExamId);
    });

    afterEach(() => {
      ctx.setNow(null);
    });

    it("allows submit even when fastify.now() is past deadlineAt", async () => {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${deadlineExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(startRes.statusCode).toBe(201);
      const lateAttemptId = startRes.json().id as string;

      ctx.setNow(new Date(Date.now() + 5 * 60 * 1000));

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${lateAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("graded");
    });
  });

  describe("POST /attempts/:attemptId/submit — ownership safety net", () => {
    let otherCandidateToken: string;
    let ownAttemptId: string;
    let ownershipExamId: string;

    beforeAll(async () => {
      const otherUserId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: otherUserId,
        organizationId: ctx.org.id,
        username: `other-candidate-${uniquePrefix()}`,
        passwordHash: "unused",
        name: "Other Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const otherProfileId = crypto.randomUUID();
      await ctx.db.insert(schema.candidateProfiles).values({
        id: otherProfileId,
        organizationId: ctx.org.id,
        userId: otherUserId,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // RBAC-M10-E: this user must authenticate to exercise the cross-candidate
      // submit rejection at the ownership layer — seed an active primary
      // Candidate assignment so the failure is at ownership, not authenticate
      // (401).
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId: otherUserId,
        role: "Candidate" as never,
        isPrimary: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      otherCandidateToken = signJWT({
        actorId: otherUserId,
        role: "Candidate",
        organizationId: ctx.org.id,
      });

      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Ownership Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      ownershipExamId = examRes.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${ownershipExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, ownershipExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${ownershipExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      ownAttemptId = startRes.json().id;
    });

    it("rejects submit by a different candidate (404)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${ownAttemptId}/submit`,
        cookies: { "auth-token": otherCandidateToken },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
      expect(body.error.requestId).toEqual(expect.any(String));
    });

    it("owner can still submit after cross-candidate attempt", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${ownAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("graded");
    });
  });

  describe("POST /attempts/:attemptId/answers/:questionId — rejects after submit", () => {
    let gradedAttemptId: string;
    let gradedQuestionId: string;
    let answersBeforeSave: unknown;

    beforeAll(async () => {
      gradedQuestionId = questionId;

      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Save After Submit Exam",
          courseId,
          questionIds: [gradedQuestionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const gradedExamId = examRes.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${gradedExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, gradedExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${gradedExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      gradedAttemptId = startRes.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${gradedAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      const attemptRepo = createAttemptRepo(ctx.db);
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const row = await attemptRepo.findById(candidateCtx, gradedAttemptId);
      answersBeforeSave = row?.answers;
    });

    it("rejects save when attempt is graded (accepted: false, conflict: ATTEMPT_ALREADY_SUBMITTED)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${gradedAttemptId}/answers/${gradedQuestionId}`,
        payload: {
          attemptId: gradedAttemptId,
          questionId: gradedQuestionId,
          answer: true,
          clientSeq: 999,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(false);
      expect(body.reason).toBeDefined();
      expect(body.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
      expect(body.message).toBe(
        getSaveAnswerMessage("ATTEMPT_ALREADY_SUBMITTED"),
      );
    });

    it("DB invariant: answers unchanged after rejected save (regression guard for route-level rejection)", async () => {
      const attemptRepo = createAttemptRepo(ctx.db);
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const row = await attemptRepo.findById(candidateCtx, gradedAttemptId);
      expect(row?.answers).toEqual(answersBeforeSave);
    });
  });

  describe("fill_blank attempt flow", () => {
    it("loads, saves, submits, and grades a fill_blank answer", async () => {
      const examResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Fill Blank Flow Exam",
          courseId,
          questionIds: [fillBlankQuestionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const fillBlankExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${fillBlankExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, fillBlankExamId);

      const startResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${fillBlankExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startResponse.json().id as string;

      expect(startResponse.statusCode).toBe(201);
      expect(startResponse.json().questionSnapshot[0]).toMatchObject({
        type: "fill_blank",
        content: "安全出口标识的颜色是____色",
      });

      const loadResponse = await ctx.app.inject({
        method: "GET",
        url: `/api/attempts/${attemptId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(loadResponse.statusCode).toBe(200);
      expect(loadResponse.json().questionSnapshot[0].type).toBe("fill_blank");

      const saveResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${fillBlankQuestionId}`,
        payload: {
          attemptId,
          questionId: fillBlankQuestionId,
          answer: "绿",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.json()).toMatchObject({
        accepted: true,
        serverVersion: 1,
      });

      const submitResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(submitResponse.statusCode).toBe(200);
      expect(submitResponse.json()).toMatchObject({
        status: "graded",
        score: 100,
        passed: true,
      });
    });
  });

  describe("POST /attempts/:attemptId/restore", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam6 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Restore Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId6 = exam6.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId6}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId6);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId6}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;

      await disruptAttempt(ctx.db, ctx.org.id, attemptId);
    });

    it("restores disrupted attempt to in_progress", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/restore`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // REC-I4-I3A frozen restore response contract.
      expect(body.lifecycle).toBe("restored");
      expect(body.compensation.policy).toBe("strict");
      expect(body.compensation.addedSeconds).toBe(0);
      expect(body.attempt.status).toBe("in_progress");
    });

    it("restores with deadlineAt adjusted by the bounded_grace per-incident cap (ADR-013)", async () => {
      const exam7 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Restore Deadline Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId7 = exam7.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId7}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId7);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId7}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attId = startRes.json().id;
      const originalDeadline = new Date(startRes.json().deadlineAt);

      await ctx.db
        .update(schema.examAttempts)
        .set({
          interruptionPolicySnapshotVersion: 1,
          interruptionTimePolicySnapshot: "bounded_grace",
          interruptionGracePerIncidentSecondsSnapshot: 300,
          interruptionGracePerAttemptSecondsSnapshot: 600,
        })
        .where(eq(schema.examAttempts.id, attId));

      const fixedNow = new Date(Date.now());
      ctx.setNow(fixedNow);
      // Disrupt 10 minutes ago. Under ADR-013 bounded_grace the eligible
      // interval (600s) is capped by the per-incident snapshot cap (300s), so
      // the grant is 300s — NOT the full disconnected duration. This is the
      // behavior the legacy full-gap compensation (disconnectedDuration) was
      // replaced by.
      const lastActivity = new Date(fixedNow.getTime() - 10 * 60_000);
      await disruptAttempt(ctx.db, ctx.org.id, attId, {
        interruptedAt: lastActivity,
        lastActivityAt: lastActivity,
        policy: "bounded_grace",
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attId}/restore`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // REC-I4-I3A frozen restore response contract: the candidate-safe
      // attempt is nested under `attempt`, and the compensation summary
      // reports the policy + granted seconds.
      expect(body.lifecycle).toBe("restored");
      expect(body.compensation.policy).toBe("bounded_grace");
      expect(body.compensation.addedSeconds).toBe(300);
      expect(body.attempt.status).toBe("in_progress");
      const restoredDeadline = new Date(body.attempt.deadlineAt);
      const expectedDeadline = new Date(
        originalDeadline.getTime() + 300 * 1000,
      );
      expect(restoredDeadline.getTime()).toBe(expectedDeadline.getTime());
    });

    it("strict policy restore grants zero seconds and preserves the deadline (ADR-013)", async () => {
      const exam8 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Strict Restore Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId8 = exam8.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId8}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId8);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId8}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attId = startRes.json().id;
      const originalDeadline = new Date(startRes.json().deadlineAt);

      const fixedNow = new Date(Date.now());
      ctx.setNow(fixedNow);
      const lastActivity = new Date(fixedNow.getTime() - 5 * 60_000);
      await disruptAttempt(ctx.db, ctx.org.id, attId, {
        interruptedAt: lastActivity,
        lastActivityAt: lastActivity,
        policy: "strict",
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attId}/restore`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.lifecycle).toBe("restored");
      expect(body.compensation.policy).toBe("strict");
      expect(body.compensation.addedSeconds).toBe(0);
      expect(body.attempt.status).toBe("in_progress");
      // Strict policy: deadline is preserved exactly, not extended by the
      // disconnected duration.
      const restoredDeadline = new Date(body.attempt.deadlineAt);
      expect(restoredDeadline.getTime()).toBe(originalDeadline.getTime());
    });

    it("returns terminal lifecycle when restore triggers deadline reconciliation (expired)", async () => {
      // Create an exam, start an attempt, then advance the clock past the
      // deadline so the restore's deadline reconciliation submits the attempt.
      const exam9 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Terminal Restore Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId9 = exam9.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId9}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId9);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId9}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attId = startRes.json().id;
      const attemptDeadline = new Date(startRes.json().deadlineAt);

      // Advance the clock well past the deadline.
      const expiredNow = new Date(attemptDeadline.getTime() + 60 * 1000);
      ctx.setNow(expiredNow);

      await disruptAttempt(ctx.db, ctx.org.id, attId, {
        interruptedAt: expiredNow,
        lastActivityAt: expiredNow,
        policy: "strict",
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attId}/restore`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.lifecycle).toBe("terminal");
      expect(body.compensation.policy).toBe("strict");
      expect(body.compensation.addedSeconds).toBe(0);
      // The attempt must have been submitted by deadline reconciliation.
      expect(
        body.attempt.status === "submitted" ||
          body.attempt.status === "grading" ||
          body.attempt.status === "graded",
      ).toBe(true);
    });

    it("retry restore against already-terminal attempt returns terminal (idempotent)", async () => {
      // Reuse the same expired attempt from the previous test. The retry
      // restore must return 200 with lifecycle=terminal without error.
      const exam10 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Terminal Retry Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId10 = exam10.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId10}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId10);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId10}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attId = startRes.json().id;
      const attemptDeadline = new Date(startRes.json().deadlineAt);

      // Advance the clock past the deadline.
      const expiredNow = new Date(attemptDeadline.getTime() + 60 * 1000);
      ctx.setNow(expiredNow);

      await disruptAttempt(ctx.db, ctx.org.id, attId, {
        interruptedAt: expiredNow,
        lastActivityAt: expiredNow,
        policy: "strict",
      });

      // First restore — should terminalize.
      const firstRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attId}/restore`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(firstRes.statusCode).toBe(200);
      expect(firstRes.json().lifecycle).toBe("terminal");

      // Second restore against the already-terminal attempt — must be
      // idempotent: 200, lifecycle=terminal, no duplicate terminalization.
      const secondRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attId}/restore`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(secondRes.statusCode).toBe(200);
      const secondBody = secondRes.json();
      expect(secondBody.lifecycle).toBe("terminal");
      expect(secondBody.compensation.policy).toBe("strict");
      expect(secondBody.compensation.addedSeconds).toBe(0);
      // The attempt should remain in a terminal state.
      expect(
        secondBody.attempt.status === "submitted" ||
          secondBody.attempt.status === "grading" ||
          secondBody.attempt.status === "graded",
      ).toBe(true);
    });
  });

  // P2D-J1 regression: clean submit → grade → result flows for every objective
  // question type, plus score-strategy selection observed through the API.
  // These complement the single_choice/fill_blank cases scattered above by
  // giving each type a named, self-contained path and asserting the graded
  // score directly. Score strategy is verified end-to-end by enrolling the
  // same candidate twice on strategy-specific exams and reading the
  // enrollment's recorded finalScore/finalAttemptId from the DB.
  describe("POST /attempts/:attemptId/submit — submit→grade→result for all objective question types", () => {
    let mcPartialQuestionId: string;
    let tfQuestionId: string;

    beforeAll(async () => {
      mcPartialQuestionId = crypto.randomUUID();
      tfQuestionId = crypto.randomUUID();

      await ctx.db.insert(schema.questions).values({
        id: mcPartialQuestionId,
        organizationId: ctx.org.id,
        courseId,
        type: "multiple_choice",
        content: "Select the even numbers",
        options: [
          { id: "a", content: "1" },
          { id: "b", content: "2" },
          { id: "c", content: "3" },
          { id: "d", content: "4" },
        ],
        standardAnswer: ["b", "d"],
        attachments: [],
        score: 100,
        difficulty: 1,
        tags: [],
        gradingRule: {
          multiSelectScoring: "partial_half",
          fillBlankMatchMode: "exact",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.db.insert(schema.questions).values({
        id: tfQuestionId,
        organizationId: ctx.org.id,
        courseId,
        type: "true_false",
        content: "The sky is blue on a clear day",
        options: [
          { id: "true", content: "True" },
          { id: "false", content: "False" },
        ],
        standardAnswer: true,
        attachments: [],
        score: 100,
        difficulty: 1,
        tags: [],
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    async function buildGradedFlow(opts: {
      title: string;
      questionIds: string[];
    }): Promise<{ examId: string }> {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: opts.title,
          courseId,
          questionIds: opts.questionIds,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId = examRes.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId);
      return { examId };
    }

    async function startSaveSubmit(
      examId: string,
      qId: string,
      answer: unknown,
    ): Promise<{ attemptId: string; submitBody: Record<string, unknown> }> {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer,
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      return { attemptId, submitBody: submitRes.json() };
    }

    it("grades a correct single_choice submit at full score", async () => {
      const { examId } = await buildGradedFlow({
        title: "SC Graded Flow",
        questionIds: [questionId],
      });
      const { submitBody } = await startSaveSubmit(examId, questionId, "b");

      expect(submitBody).toMatchObject({
        status: "graded",
        score: 100,
        passed: true,
      });
    });

    it("grades a partial multiple_choice submit at half score (partial_half)", async () => {
      const { examId } = await buildGradedFlow({
        title: "MC Partial Graded Flow",
        questionIds: [mcPartialQuestionId],
      });
      // Select only one of two correct options, no wrong option → half score.
      const { submitBody } = await startSaveSubmit(
        examId,
        mcPartialQuestionId,
        ["b"],
      );

      expect(submitBody).toMatchObject({
        status: "graded",
        score: 50,
        passed: false, // 50 < passingScore 60
      });
    });

    it("grades a correct true_false submit at full score", async () => {
      const { examId } = await buildGradedFlow({
        title: "TF Graded Flow",
        questionIds: [tfQuestionId],
      });
      const { submitBody } = await startSaveSubmit(examId, tfQuestionId, true);

      expect(submitBody).toMatchObject({
        status: "graded",
        score: 100,
        passed: true,
      });
    });
  });

  describe("POST /attempts/:attemptId/submit — score strategy applies to enrollment via API", () => {
    // For each strategy the candidate takes two attempts on a max_attempts=2
    // exam: attempt #1 scores 0 (wrong answer), attempt #2 scores 100
    // (correct answer). We then read the enrollment row from the DB and
    // assert which attempt's score/attemptId is recorded as final.
    async function twoAttemptsAndRead(strategy: string): Promise<{
      finalScore: number | null;
      finalAttemptId: string | null;
      attempt1Id: string;
      attempt2Id: string;
    }> {
      // Build a dedicated exam for this strategy with 2 max attempts.
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: `Strategy ${strategy}`,
          courseId,
          questionIds: [questionId],
          scoreStrategy: strategy,
          retakePolicy: "max_attempts",
          maxAttempts: 2,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId2 = examRes.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId2}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId2);

      // Attempt 1: wrong answer → score 0.
      const start1 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId2}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attempt1Id = start1.json().id as string;
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attempt1Id}/answers/${questionId}`,
        payload: {
          attemptId: attempt1Id,
          questionId,
          answer: "a", // wrong (standard is "b")
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      const submit1 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attempt1Id}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(submit1.json().score).toBe(0);

      // Attempt 2: correct answer → score 100.
      const start2 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId2}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attempt2Id = start2.json().id as string;
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attempt2Id}/answers/${questionId}`,
        payload: {
          attemptId: attempt2Id,
          questionId,
          answer: "b", // correct
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      const submit2 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attempt2Id}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(submit2.json().score).toBe(100);

      const enrollmentRepo = createEnrollmentRepo(ctx.db);
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const enrollment = await enrollmentRepo.findByExamAndCandidate(
        candidateCtx,
        examId2,
        candidateProfileId,
      );
      return {
        finalScore: enrollment?.finalScore ?? null,
        finalAttemptId: enrollment?.finalAttemptId ?? null,
        attempt1Id,
        attempt2Id,
      };
    }

    it("latest strategy records the most recent attempt (score 100, attempt #2)", async () => {
      const { finalScore, finalAttemptId, attempt2Id } =
        await twoAttemptsAndRead("latest");
      expect(finalScore).toBe(100);
      // latest always overwrites → the second (most recent) attempt wins.
      expect(finalAttemptId).toBe(attempt2Id);
    });

    it("highest strategy records the higher-scoring attempt (score 100, attempt #2)", async () => {
      const { finalScore, finalAttemptId, attempt2Id } =
        await twoAttemptsAndRead("highest");
      expect(finalScore).toBe(100);
      // attempt #2 (100) > attempt #1 (0) → highest selects #2.
      expect(finalAttemptId).toBe(attempt2Id);
    });

    it("first strategy keeps the first attempt (score 0, attempt #1)", async () => {
      const { finalScore, finalAttemptId, attempt1Id } =
        await twoAttemptsAndRead("first");
      expect(finalScore).toBe(0);
      // first never overwrites once set → the initial attempt #1 stays.
      expect(finalAttemptId).toBe(attempt1Id);
    });
  });
});
