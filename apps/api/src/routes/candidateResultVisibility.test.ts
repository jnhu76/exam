import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";

/**
 * Issue #324 — candidate result-visibility projection regression.
 *
 * Invariant under test: no candidate-facing response may reveal
 * score-derived result facts until the exam publication policy says the
 * result is visible. The canonical decision is the same one
 * /api/scores/attempts/:attemptId applies (P2D-J5a); every other candidate
 * projection must agree with it.
 *
 * Leak repros (manual mode + fully graded + resultsPublishedAt = null):
 *   L1 submit response, L2 GET /attempts/:id, L3 candidate exam list,
 *   L4 candidate exam detail, L5 pass_then_stop blockingReason.
 */
describe("P1 #324: candidate result visibility projection", () => {
  let ctx: TestContext;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
    courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    candidateProfileId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Course",
      code: `324-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
      id: questionId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "Choose A",
      options: [
        { id: "a", content: "A" },
        { id: "b", content: "B" },
      ],
      standardAnswer: "a",
      attachments: [],
      score: 10,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const existing = await ctx.db
      .select({ id: schema.candidateProfiles.id })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
    if (existing[0]) {
      candidateProfileId = existing[0].id;
    } else {
      await ctx.db.insert(schema.candidateProfiles).values({
        id: candidateProfileId,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function candidateCtx() {
    return {
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      role: "Candidate" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
  }

  async function forceGradingStatus(
    attemptId: string,
    status: "auto_graded" | "pending_manual" | "fully_graded",
  ) {
    await createAttemptRepo(ctx.db).update(candidateCtx(), attemptId, {
      gradingStatus: status,
    });
  }

  /**
   * Creates + publishes an exam with the given publication mode, enrolls the
   * candidate, starts an attempt, answers correctly (full score → passed),
   * and submits. Returns the graded attemptId and examId.
   */
  async function createGradedAttemptForMode(
    resultPublicationMode: "immediate" | "after_grading" | "manual",
    retakePolicy: "unlimited" | "pass_then_stop" = "unlimited",
  ): Promise<{ attemptId: string; examId: string }> {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `324-${resultPublicationMode}-${retakePolicy}`,
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionSelectionMode: "manual",
        questionIds: [questionId],
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
        retakePolicy,
        scoreStrategy: "highest",
        maxAttempts: 3,
        resultPublicationMode,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createResponse.statusCode).toBe(201);
    const examId = createResponse.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    const startResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const attemptId = startResponse.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: "a",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    const submitResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submitResponse.statusCode).toBe(200);
    return { attemptId: submitResponse.json().id as string, examId };
  }

  async function getCandidateAttempt(attemptId: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  async function getCandidateExamList() {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Array<Record<string, unknown>>;
  }

  async function getCandidateExamDetail(examId: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/exams/${examId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  async function getTakeSnapshot(attemptId: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  // ── Manual mode, pre-publish leak repros ─────────────────────────

  it("L1: manual + graded + unpublished — submit response must not expose score/passed", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.score).toBeUndefined();
    expect(body.passed).toBeUndefined();
  });

  it("L2: manual + graded + unpublished — GET /attempts/:id must not expose score/passed", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const body = await getCandidateAttempt(attemptId);
    expect(body.score).toBeUndefined();
    expect(body.passed).toBeUndefined();
  });

  it("L3: manual + graded + unpublished — candidate exam list must not expose bestScore/bestScorePercent", async () => {
    const { examId } = await createGradedAttemptForMode("manual");
    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBeUndefined();
    expect(entry!.bestScorePercent).toBeUndefined();
  });

  it("L4: manual + graded + unpublished — candidate exam detail must not expose bestScore/bestScorePercent", async () => {
    const { examId } = await createGradedAttemptForMode("manual");
    const detail = await getCandidateExamDetail(examId);
    expect(detail.bestScore).toBeUndefined();
    expect(detail.bestScorePercent).toBeUndefined();
  });

  it("L5: manual + passed + unpublished — pass_then_stop detail must not disclose already_passed", async () => {
    const { examId } = await createGradedAttemptForMode(
      "manual",
      "pass_then_stop",
    );
    const detail = await getCandidateExamDetail(examId);
    expect(detail.bestScore).toBeUndefined();
    expect(detail.blockingReason).not.toBe("already_passed");
    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBeUndefined();
  });

  it("take-snapshot: manual + graded + unpublished — resultVisibility stays hidden", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const snapshot = await getTakeSnapshot(attemptId);
    expect(snapshot.resultVisibility).toBe("hidden");
    expect(snapshot).not.toHaveProperty("score");
    expect(snapshot).not.toHaveProperty("passed");
  });

  it("standardAnswer isolation: candidate attempt response never carries standardAnswer", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const body = await getCandidateAttempt(attemptId);
    const snapshot = body.questionSnapshot as Array<Record<string, unknown>>;
    expect(snapshot.length).toBeGreaterThan(0);
    for (const question of snapshot) {
      expect(question).not.toHaveProperty("standardAnswer");
      expect(question).not.toHaveProperty("rubric");
    }
  });

  // ── Manual mode, post-publish restoration ────────────────────────

  it("manual + publish-results — all candidate surfaces expose intended results consistently", async () => {
    const { attemptId, examId } = await createGradedAttemptForMode("manual");
    const publishResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishResponse.statusCode).toBe(200);

    const attemptBody = await getCandidateAttempt(attemptId);
    expect(attemptBody.score).toBe(10);
    expect(attemptBody.passed).toBe(true);

    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBe(10);
    expect(entry!.bestScorePercent).toBe(100);

    const detail = await getCandidateExamDetail(examId);
    expect(detail.bestScore).toBe(10);
    expect(detail.bestScorePercent).toBe(100);

    const snapshot = await getTakeSnapshot(attemptId);
    expect(snapshot.resultVisibility).toBe("visible");
  });

  it("manual + publish-results + pass_then_stop — already_passed blocking reason restored", async () => {
    const { examId } = await createGradedAttemptForMode(
      "manual",
      "pass_then_stop",
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const detail = await getCandidateExamDetail(examId);
    expect(detail.blockingReason).toBe("already_passed");
    expect(detail.canStartNewAttempt).toBe(false);
    expect(detail.bestScore).toBe(10);
  });

  // ── immediate / after_grading semantics unchanged ────────────────

  it("immediate — submit response and list expose results (no regression)", async () => {
    const { attemptId, examId } = await createGradedAttemptForMode("immediate");
    const attemptBody = await getCandidateAttempt(attemptId);
    expect(attemptBody.score).toBe(10);
    expect(attemptBody.passed).toBe(true);

    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBe(10);

    const snapshot = await getTakeSnapshot(attemptId);
    expect(snapshot.resultVisibility).toBe("visible");
  });

  it("after_grading + auto_graded — result hidden on every candidate surface (converges with score endpoint)", async () => {
    const { attemptId, examId } =
      await createGradedAttemptForMode("after_grading");
    const attemptBody = await getCandidateAttempt(attemptId);
    expect(attemptBody.score).toBeUndefined();
    expect(attemptBody.passed).toBeUndefined();

    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBeUndefined();

    const detail = await getCandidateExamDetail(examId);
    expect(detail.bestScore).toBeUndefined();

    const snapshot = await getTakeSnapshot(attemptId);
    expect(snapshot.resultVisibility).toBe("hidden");

    const scoreResponse = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(scoreResponse.json().showResultImmediately).toBe(false);
  });

  it("after_grading + fully_graded — result visible on every candidate surface", async () => {
    const { attemptId, examId } =
      await createGradedAttemptForMode("after_grading");
    await forceGradingStatus(attemptId, "fully_graded");
    const attemptBody = await getCandidateAttempt(attemptId);
    expect(attemptBody.score).toBe(10);
    expect(attemptBody.passed).toBe(true);

    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBe(10);
  });

  // ── Admin all-view unaffected ────────────────────────────────────

  it("admin all-view — sees full result even when manual + unpublished", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.showResultImmediately).toBe(true);
    expect(body.totalScore).toBe(10);
  });
});
