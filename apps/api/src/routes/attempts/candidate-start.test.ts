import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import {
  buildExamPayload,
  DEFAULT_CONTROL_FLAGS,
  enrollCandidateForExam,
  buildSharedAttemptFixture,
  disruptAttempt,
} from "./__tests__/attempts.testHelpers.js";

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

  describe("POST /attempts/:examId/start — minSubmitAfterStartMinutes feasibility (#395)", () => {
    it("rejects an impossible late start with 409 ATTEMPT_START_SUBMIT_INFEASIBLE and leaves zero mutation", async () => {
      // closeAt binds 5min out while minSubmit needs 30min — no reachable
      // candidate manual-submit instant.
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Infeasible Late Exam",
          courseId,
          questionIds: [questionId],
          minSubmitAfterStartMinutes: 30,
          closeAt: new Date(Date.now() + 300_000).toISOString(),
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const infeasibleExamId = examRes.json().id as string;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${infeasibleExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, infeasibleExamId);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${infeasibleExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("ATTEMPT_START_SUBMIT_INFEASIBLE");

      // Zero side effects: no attempt row, no enrollment attemptCount/status
      // mutation (the engine rejects before the create/update inside the
      // route's transaction).
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
      ).findByExamAndCandidate(
        candidateCtx,
        infeasibleExamId,
        candidateProfileId,
      );
      expect(allAttempts).toHaveLength(0);
      const enrollment = await ctx.db
        .select()
        .from(schema.examEnrollments)
        .where(
          and(
            eq(schema.examEnrollments.examId, infeasibleExamId),
            eq(schema.examEnrollments.candidateId, candidateProfileId),
          ),
        );
      expect(enrollment).toHaveLength(1);
      expect(enrollment[0]!.attemptCount).toBe(0);
      expect(enrollment[0]!.status).toBe("assigned");
    });
  });

  describe("CandidateExamSummary availabilityStatus derivation", () => {
    // Built lazily at call time: `questionId` is assigned in beforeAll, which
    // runs after describe collection — a describe-scope const would capture
    // it as undefined and produce an invalid snapshot.
    const buildSnapshot = () => [
      {
        originalQuestionId: questionId,
        type: "single_choice" as const,
        content: "Q",
        contentDocument: null,
        answerMode: null,
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

    async function createAndEnrollExam(
      opts: {
        title?: string;
        status?: "draft" | "published" | "open" | "closed";
        retakePolicy?: string;
        maxAttempts?: number;
        openOffsetMs?: number;
        closeOffsetMs?: number;
        enroll?: boolean;
        now?: Date;
        questionIds?: string[];
        questionSnapshot?: ReturnType<typeof buildSnapshot>;
      } = {},
    ): Promise<string> {
      const now = opts.now ?? new Date();
      const id = crypto.randomUUID();
      await ctx.db.insert(schema.exams).values({
        id,
        organizationId: ctx.org.id,
        title: opts.title ?? `Summary-${uniquePrefix()}`,
        description: "",
        courseId,
        status: opts.status ?? "open",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(now.getTime() + (opts.openOffsetMs ?? -3600000)),
        closeAt: new Date(now.getTime() + (opts.closeOffsetMs ?? 86400000)),
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: opts.questionIds ?? [questionId],
        questionSnapshot: opts.questionSnapshot ?? buildSnapshot(),
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

    it("reports the authored question count for a draft exam (snapshot not frozen yet)", async () => {
      // A draft has no question snapshot; the candidate card must not claim 0
      // questions when the exam was authored with questions (MVP-P2-02). The
      // draft-only fallback is the whole point: questionIds are the current
      // authoring state only while the exam is still a draft.
      const draftId = crypto.randomUUID();
      await ctx.db.insert(schema.exams).values({
        id: draftId,
        organizationId: ctx.org.id,
        title: `Draft Summary-${uniquePrefix()}`,
        description: "",
        courseId,
        status: "draft",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() + 86400000),
        closeAt: new Date(Date.now() + 172800000),
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: [questionId, crypto.randomUUID()],
        questionSnapshot: [],
        controlFlags: { ...DEFAULT_CONTROL_FLAGS },
        retakePolicy: "max_attempts",
        scoreStrategy: "highest",
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await ctx.db.insert(schema.examEnrollments).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        examId: draftId,
        candidateId: candidateProfileId,
        status: "assigned",
        attemptCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const target = await getSummary(draftId);
      expect(target.availabilityStatus).toBe("unavailable");
      expect(target.totalQuestions).toBe(2);
    });

    it("does NOT fall back to authored ids for a published exam with an empty snapshot", async () => {
      // Deliberately inconsistent fixture: published exam whose frozen snapshot
      // is empty while questionIds still lists two authored questions. The
      // frozen snapshot is authoritative; the summary must report 0 (fail
      // closed) rather than silently masking the broken snapshot.
      const publishedId = await createAndEnrollExam({
        title: "Published Empty Snapshot Exam",
        status: "published",
        questionIds: [questionId, crypto.randomUUID()],
        questionSnapshot: [],
      });
      const target = await getSummary(publishedId);
      expect(target.totalQuestions).toBe(0);
    });

    it("reports the frozen snapshot length when it differs from authored ids (published)", async () => {
      // Published exam: questionIds was later edited (2 ids) but the snapshot
      // froze at publish time (1 question). The summary must follow the
      // snapshot, not the authored ids.
      const publishedId = await createAndEnrollExam({
        title: "Published Snapshot Wins Exam",
        status: "published",
        questionIds: [questionId, crypto.randomUUID()],
      });
      const target = await getSummary(publishedId);
      expect(target.totalQuestions).toBe(1);
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
      await disruptAttempt(ctx.db, ctx.org.id, startRes.json().id);
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
