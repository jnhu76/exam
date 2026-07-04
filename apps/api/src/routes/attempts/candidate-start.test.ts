import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import {
  buildExamPayload,
  DEFAULT_CONTROL_FLAGS,
  enrollCandidateForExam,
  buildSharedAttemptFixture,
} from "./attempts.testHelpers.js";

describe("attempt routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    const fixture = await buildSharedAttemptFixture();
    ctx = fixture.ctx;
    examId = fixture.examId;
    courseId = fixture.courseId;
    questionId = fixture.questionId;
    candidateProfileId = fixture.candidateProfileId;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("POST /attempts/:examId/start", () => {
    it("starts attempt for candidate", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe("in_progress");
      expect(body.examId).toBe(examId);
      expect(body.candidateId).toBe(candidateProfileId);
      expect(body.questionSnapshot).toBeDefined();
      expect(body.questionSnapshot).toHaveLength(1);
      expect(body.deadlineAt).toBeDefined();
      expect(body.startedAt).toBeDefined();
    });

    it("returns existing attempt on repeated start", async () => {
      const res1 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = res1.json().id;

      const res2 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res2.statusCode).toBe(200);
      expect(res2.json().id).toBe(attemptId);
    });

    it("double-click start creates only one active attempt in DB", async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "DoubleClick Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const dcExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${dcExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${dcExamId}/enrollments`,
        payload: { candidateIds: [candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });

      const [res1, res2] = await Promise.all([
        ctx.app.inject({
          method: "POST",
          url: `/api/attempts/${dcExamId}/start`,
          cookies: { "auth-token": ctx.candidateToken },
        }),
        ctx.app.inject({
          method: "POST",
          url: `/api/attempts/${dcExamId}/start`,
          cookies: { "auth-token": ctx.candidateToken },
        }),
      ]);

      const codes = [res1.statusCode, res2.statusCode].sort();
      expect(codes).toEqual([200, 201]);
      expect(res1.json().id).toBe(res2.json().id);

      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const allAttempts = await createAttemptRepo(
        ctx.db,
      ).findByExamAndCandidate(candidateCtx, dcExamId, candidateProfileId);
      const activeAttempts = allAttempts.filter(
        (a) => a.status === "in_progress",
      );
      expect(activeAttempts).toHaveLength(1);
    });

    it("returns 401 without auth", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects unassigned candidate (Phase 1 requires explicit enrollment)", async () => {
      const unassignedUserId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: unassignedUserId,
        organizationId: ctx.org.id,
        username: `unassigned-${uniquePrefix()}`,
        passwordHash: "$argon2id$dummy",
        name: "Unassigned Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await ctx.db.insert(schema.candidateProfiles).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId: unassignedUserId,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const unassignedToken = signJWT({
        actorId: unassignedUserId,
        role: "Candidate",
        organizationId: ctx.org.id,
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": unassignedToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });
  });

  describe("POST /attempts/:examId/start — latestStartOffsetMinutes guard (ADR-005 Slice 3)", () => {
    it("rejects new start after the late-entry cutoff with 409 ATTEMPT_LATE_ENTRY_CLOSED", async () => {
      // openAt = now - 2h; offset = 30min -> latestStartAt = now - 1.5h < now.
      const openAt = new Date(Date.now() - 7200_000).toISOString();
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "LateEntry Exam",
          courseId,
          questionIds: [questionId],
          latestStartOffsetMinutes: 30,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId = examRes.json().id;
      // Override openAt via PATCH (draft) — buildExamPayload hardcodes openAt.
      const patchRes = await ctx.app.inject({
        method: "PATCH",
        url: `/api/exams/${examId}`,
        payload: { openAt },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(patchRes.statusCode).toBe(200);
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, examId);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("ATTEMPT_LATE_ENTRY_CLOSED");
    });
  });

  describe("CandidateExamSummary availabilityStatus derivation", () => {
    async function createAndEnrollExam(
      opts: {
        title?: string;
        retakePolicy?: string;
        maxAttempts?: number;
        openOffsetMs?: number;
        closeOffsetMs?: number;
        enroll?: boolean;
        now?: Date;
      } = {},
    ): Promise<string> {
      const now = opts.now ?? new Date();
      const id = crypto.randomUUID();
      const snapshot = [
        {
          originalQuestionId: questionId,
          type: "single_choice" as const,
          content: "Q",
          attachments: [] as never[],
          options: [{ id: "a", content: "A" }],
          standardAnswer: "a",
          score: 100,
          gradingRule: {
            multiSelectScoring: "all_correct_full" as const,
            fillBlankMatchMode: "exact" as const,
          },
          order: 0,
          rubric: null,
        },
      ];
      await ctx.db.insert(schema.exams).values({
        id,
        organizationId: ctx.org.id,
        title: opts.title ?? `Summary-${uniquePrefix()}`,
        description: "",
        courseId,
        status: "open",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(now.getTime() + (opts.openOffsetMs ?? -3600000)),
        closeAt: new Date(now.getTime() + (opts.closeOffsetMs ?? 86400000)),
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: [questionId],
        questionSnapshot: snapshot,
        controlFlags: { ...DEFAULT_CONTROL_FLAGS },
        retakePolicy: (opts.retakePolicy ?? "max_attempts") as
          | "max_attempts"
          | "unlimited"
          | "pass_then_stop",
        scoreStrategy: "highest",
        maxAttempts: opts.maxAttempts ?? 3,
        createdAt: now,
        updatedAt: now,
      });

      if (opts.enroll !== false) {
        await ctx.db.insert(schema.examEnrollments).values({
          id: crypto.randomUUID(),
          organizationId: ctx.org.id,
          examId: id,
          candidateId: candidateProfileId,
          status: "assigned",
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      return id;
    }

    async function getSummary(
      examId: string,
    ): Promise<Record<string, unknown>> {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/exams",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      const exams = body as Array<Record<string, unknown>>;
      const found = exams.find((e) => e.examId === examId);
      expect(found).toBeDefined();
      return found!;
    }

    async function startAndSubmit(examId: string): Promise<string> {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(startRes.statusCode).toBe(201);
      const attemptId = startRes.json().id;
      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(submitRes.statusCode).toBe(200);
      return attemptId;
    }

    it("derives available/start when no attempts inside window", async () => {
      const freshExamId = await createAndEnrollExam({
        title: "Available Exam",
      });
      const target = await getSummary(freshExamId);
      expect(target.availabilityStatus).toBe("available");
      expect(target.primaryAction).toBe("start");
    });

    it("derives in_progress/resume when active attempt exists", async () => {
      const inProgressExamId = await createAndEnrollExam({
        title: "InProgress Exam",
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${inProgressExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const target = await getSummary(inProgressExamId);
      expect(target.availabilityStatus).toBe("in_progress");
      expect(target.primaryAction).toBe("resume");
    });

    it("derives resumable/resume when disrupted attempt exists", async () => {
      const disruptedExamId = await createAndEnrollExam({
        title: "Disrupted Exam",
      });
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${disruptedExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      await createAttemptRepo(ctx.db).update(candidateCtx, startRes.json().id, {
        status: "disrupted",
      });
      const target = await getSummary(disruptedExamId);
      expect(target.availabilityStatus).toBe("resumable");
      expect(target.primaryAction).toBe("resume");
    });

    it("derives max_attempts_exhausted/view_result after exhausting attempts", async () => {
      const exhaustExamId = await createAndEnrollExam({
        title: "Exhaust Exam",
        maxAttempts: 1,
      });
      await startAndSubmit(exhaustExamId);
      const target = await getSummary(exhaustExamId);
      expect(target.availabilityStatus).toBe("max_attempts_exhausted");
      expect(target.primaryAction).toBe("view_result");
    });

    it("rejects start API when maxAttempts exhausted", async () => {
      const exhaustExamId = await createAndEnrollExam({
        title: "Reject Exam",
        maxAttempts: 1,
      });
      await startAndSubmit(exhaustExamId);

      const rejectRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${exhaustExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(rejectRes.statusCode).toBe(409);
      expect(rejectRes.json().error.code).toBe("MAX_ATTEMPTS_REACHED");
    });

    it("rejects start API with 403 when candidate is not enrolled", async () => {
      const notEnrolledExamId = await createAndEnrollExam({
        title: "Not Enrolled Exam",
        enroll: false,
      });

      const rejectRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${notEnrolledExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(rejectRes.statusCode).toBe(403);
      expect(rejectRes.json().error.code).toBe("PERMISSION_DENIED");
    });

    it("derives graded/view_result when graded but attempts remain", async () => {
      const gradeExamId = await createAndEnrollExam({
        title: "Grade Exam",
        maxAttempts: 3,
      });
      await startAndSubmit(gradeExamId);
      const target = await getSummary(gradeExamId);
      expect(target.availabilityStatus).toBe("graded");
      expect(target.primaryAction).toBe("view_result");
      expect(target.bestScore).toBeDefined();
    });

    it("derives not_started_yet when before window", async () => {
      const futureExamId = await createAndEnrollExam({
        title: "Future Exam",
        openOffsetMs: 86400000,
        closeOffsetMs: 172800000,
      });
      const target = await getSummary(futureExamId);
      expect(target.availabilityStatus).toBe("not_started_yet");
      expect(target.primaryAction).toBe("none");
    });

    it("derives expired when after window with no attempts", async () => {
      const expiredExamId = await createAndEnrollExam({
        title: "Expired Exam",
        maxAttempts: 3,
        openOffsetMs: -172800000,
        closeOffsetMs: -86400000,
      });
      const target = await getSummary(expiredExamId);
      expect(target.availabilityStatus).toBe("expired");
      expect(target.primaryAction).toBe("none");
    });
  });
});
