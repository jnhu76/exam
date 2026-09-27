import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import questionRoutes from "../question.js";
import courseRoutes from "../course.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
} from "./__tests__/attempts.testHelpers.js";

/**
 * Snapshot-boundary conformance (EXSEM-002/003/004/005, B6):
 *
 * 1. A referenced live Question may be HARD-DELETED after publish — deletion
 *    is not blocked, nothing is silently repaired — and both the published
 *    exam runtime (new attempts from ExamSnapshot) and an existing attempt
 *    (AttemptSnapshot, grading included) keep working from frozen snapshots.
 * 2. Unpublish restores draft authoring authority; the retained snapshot is
 *    non-authoritative residue. Republish must re-accept from current
 *    authoring input and must NOT reuse the residue to bypass a missing
 *    referenced question; the new publication reflects the new authoring
 *    state while a pre-existing attempt keeps its original presentation.
 */
describe("snapshot freeze boundary (EXSEM-002/003/004/005)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes, { prefix: "" });
      await fastify.register(questionRoutes, { prefix: "" });
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Snapshot Freeze Course",
        code: `SFC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;
    candidateProfileId = await ensureCandidateProfile(ctx);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Creates one true_false question; returns its id. */
  async function createTrueFalseQuestion(content: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content,
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  /** Creates + publishes + enrolls an open exam over the given questions. */
  async function publishExamWith(
    questionIds: string[],
    opts: { retakePolicy?: string; openAt?: string } = {},
  ): Promise<string> {
    const payload = buildExamPayload({
      title: `Snapshot Exam ${uniquePrefix()}`,
      courseId,
      questionIds,
      retakePolicy: opts.retakePolicy ?? "unlimited",
    });
    if (opts.openAt) payload.openAt = opts.openAt;
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(examRes.statusCode).toBe(201);
    const examId = examRes.json().id as string;
    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(pubRes.statusCode).toBe(200);
    await enrollCandidateForExam(ctx, candidateProfileId, examId);
    return examId;
  }

  it("published runtime and existing attempts stay frozen across a referenced-question hard delete", async () => {
    const questionId = await createTrueFalseQuestion("冻结边界判断题");
    const examId = await publishExamWith([questionId]);

    // Attempt A1 starts while the live question exists.
    const start1 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(start1.statusCode).toBe(201);
    const attempt1Id = start1.json().id as string;

    // EXSEM-002: deletion is allowed and blocks nothing downstream.
    const deleteRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/questions/${questionId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(deleteRes.statusCode).toBe(204);

    // EXSEM-005: the existing attempt keeps its AttemptSnapshot presentation.
    const take1 = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attempt1Id}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(take1.statusCode).toBe(200);
    expect(take1.json().questions[0].prompt).toBe("冻结边界判断题");

    // The attempt grades from its snapshot after the live row is gone.
    const submit1 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt1Id}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submit1.statusCode).toBe(200);
    expect(submit1.json().status).toBe("graded");
    expect(submit1.json().score).toBeDefined();

    // EXSEM-002: NEW attempts still start from the published ExamSnapshot.
    const start2 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(start2.statusCode).toBe(201);
    const snapshot2 = start2.json().questionSnapshot as Array<{
      content: string;
    }>;
    expect(snapshot2[0]!.content).toBe("冻结边界判断题");
  });

  it("unpublish → edit → republish rebuilds from current authoring; residue never bypasses validation; the old attempt is untouched", async () => {
    const q1Id = await createTrueFalseQuestion("撤回前原始题目");
    const q2Res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "重新发布后的新题目",
        options: [
          { id: "a", content: "选项甲" },
          { id: "b", content: "选项乙" },
        ],
        standardAnswer: "a",
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(q2Res.statusCode).toBe(201);
    const q2Id = q2Res.json().id as string;

    // Publish with a FUTURE window (only a still-`published` exam may
    // unpublish — ADR-005), then fabricate the pre-existing attempt from the
    // published snapshot as the previous window's frozen data.
    const examId = await publishExamWith([q1Id], {
      openAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const examRow = (
      await ctx.db
        .select()
        .from(schema.exams)
        .where(eq(schema.exams.id, examId))
    )[0]!;
    const attempt1Id = crypto.randomUUID();
    const now = new Date();
    const enrollmentRow = (
      await ctx.db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.examId, examId))
    )[0]!;
    // Keep the enrollment counter consistent with the fabricated attempt
    // (the start command derives attemptNo from attemptCount).
    await ctx.db
      .update(schema.examEnrollments)
      .set({ attemptCount: 1, status: "started", updatedAt: now })
      .where(eq(schema.examEnrollments.id, enrollmentRow.id));
    await ctx.db.insert(schema.examAttempts).values({
      id: attempt1Id,
      organizationId: ctx.org.id,
      examId,
      enrollmentId: enrollmentRow.id,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: examRow.questionSnapshot,
      answers: [],
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 3600_000),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const takeBefore = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attempt1Id}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(takeBefore.statusCode).toBe(200);
    expect(takeBefore.json().questions[0].prompt).toBe("撤回前原始题目");

    // Terminalize the old attempt before the unpublish cycle so a NEW start
    // after republish creates a fresh attempt (start is idempotent per
    // candidate+exam while an active attempt exists).
    const submit1 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt1Id}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submit1.statusCode).toBe(200);
    expect(submit1.json().status).toBe("graded");

    // EXSEM-004: unpublish restores draft authoring; the retained snapshot
    // becomes non-authoritative residue.
    const unpublishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/unpublish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(unpublishRes.statusCode).toBe(200);
    expect(unpublishRes.json().status).toBe("draft");

    // Hard-delete the still-referenced question while unpublished.
    const deleteRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/questions/${q1Id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Republish must fail closed: the residue snapshot still contains the
    // frozen copy of Q1, but re-acceptance reads CURRENT authoring input.
    const republishDangling = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(republishDangling.statusCode).toBe(400);

    // Draft edit swaps in a different question, then republish succeeds.
    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { questionIds: [q2Id] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(200);
    const republishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(republishRes.statusCode).toBe(200);

    // Open the window and start a new attempt: it materializes from the NEW
    // publication snapshot (current authoring), not the residue.
    const openRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { openAt: new Date(Date.now() - 60_000).toISOString() },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(openRes.statusCode).toBe(200);
    const start2 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(start2.statusCode).toBe(201);
    const snapshot2 = start2.json().questionSnapshot as Array<{
      content: string;
    }>;
    expect(snapshot2).toHaveLength(1);
    expect(snapshot2[0]!.content).toBe("重新发布后的新题目");

    // The pre-existing attempt still replays its ORIGINAL presentation.
    const takeAfter = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attempt1Id}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(takeAfter.statusCode).toBe(200);
    expect(takeAfter.json().questions[0].prompt).toBe("撤回前原始题目");
  });
});
