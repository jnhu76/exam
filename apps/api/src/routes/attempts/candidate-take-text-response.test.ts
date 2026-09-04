import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildTestApp, type TestContext } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import questionRoutes from "../question.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
} from "./__tests__/attempts.testHelpers.js";

/**
 * P2 authoring closeout — candidate information isolation for text_response.
 *
 * CandidateTakeSnapshot is the candidate-facing authority for the take page.
 * Its contract (CandidateTakeQuestionSchema) intentionally omits rubric,
 * standardAnswer (the optional reference answer), gradingMode, correctOption,
 * and any internal grading metadata — those are grader/admin-only fields.
 *
 * The structural leak guards already exist for objective questions
 * (attempts/candidate-take.test.ts). This file proves the SAME projection is
 * leak-free for a text_response question that carries BOTH a non-empty rubric
 * AND a non-empty reference answer — the exact subjective grading metadata a
 * candidate must never see, and must not be inferable via serialized nested
 * objects.
 *
 * These are API-level leak tests: they assert on the raw JSON body, not on
 * what a page chooses to render. "The page does not show it" is not security.
 */
describe("P2: candidate take leak protection for text_response", () => {
  let ctx: TestContext;
  let examId: string;
  let textQuestionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(questionRoutes, { prefix: "" });
    });

    const courseId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Subjective Test Course",
      code: `SUB-${randomUUID().slice(0, 8)}`,
      description: "Subjective leak test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // A text_response question carrying BOTH grading-basis fields: a
    // multiline rubric and a multiline reference answer. If either leaks to
    // the candidate the integrity of manual grading is compromised.
    textQuestionId = randomUUID();
    await ctx.db.insert(schema.questions).values({
      id: textQuestionId,
      organizationId: ctx.org.id,
      courseId,
      type: "text_response",
      content: "请阐述闭卷考试的安全边界。",
      options: [],
      standardAnswer: "参考要点一\n参考要点二\n参考要点三",
      attachments: [],
      score: 30,
      difficulty: 3,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: "关键概念正确：10 分\n论证完整且逻辑清晰：10 分\n结合实际：10 分",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    candidateProfileId = await ensureCandidateProfile(ctx);

    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: "Subjective Leak Test Exam",
        courseId,
        questionIds: [textQuestionId],
        totalScore: 30,
        passingScore: 15,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    if (createRes.statusCode !== 201) {
      throw new Error(
        `Failed to create exam: ${createRes.statusCode} ${JSON.stringify(createRes.json())}`,
      );
    }
    examId = createRes.json().id;

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    // Retain + assert the publish response so a silent publish failure cannot
    // masquerade as a green run (mirrors the exam-creation assertion above).
    if (publishRes.statusCode !== 200) {
      throw new Error(
        `Failed to publish exam: ${publishRes.statusCode} ${JSON.stringify(publishRes.json())}`,
      );
    }
    await enrollCandidateForExam(ctx, candidateProfileId, examId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("does not leak rubric, standardAnswer, or grading internals on the take snapshot (in_progress)", async () => {
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect([200, 201]).toContain(startRes.statusCode);
    const attemptId = startRes.json().id as string;

    const takeRes = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(takeRes.statusCode).toBe(200);
    expect(takeRes.headers["cache-control"]).toBe("no-store");

    const body = takeRes.json();
    expect(body.questions).toHaveLength(1);
    const q = body.questions[0];

    // The candidate question carries only what is needed to answer.
    expect(q.id).toBe(textQuestionId);
    expect(q.type).toBe("text_response");
    expect(q.prompt).toBe("请阐述闭卷考试的安全边界。");
    expect(q.maxScore).toBe(30);

    // API-level leak guards: the subjective grading metadata must NOT be
    // present on the candidate-facing object, neither as top-level keys nor
    // smuggled inside the question payload.
    expect(q).not.toHaveProperty("rubric");
    expect(q).not.toHaveProperty("standardAnswer");
    expect(q).not.toHaveProperty("gradingMode");
    expect(q).not.toHaveProperty("correctOption");
    expect(q).not.toHaveProperty("answerKey");
    expect(q).not.toHaveProperty("gradingRule");

    // The raw serialized body must not contain the rubric / reference text
    // anywhere — a candidate must not be able to infer grading metadata by
    // inspecting nested fields or the full payload.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("关键概念正确");
    expect(serialized).not.toContain("参考要点一");
  });

  it("does not leak grading metadata after the candidate submits a text answer", async () => {
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const attemptId = startRes.json().id as string;

    // Save a text answer, then submit. Assert each step's response status
    // to avoid false-green where save/submit silently failed and the
    // attempt remains in_progress (which would also pass the leak check).
    const saveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${textQuestionId}`,
      payload: {
        attemptId,
        questionId: textQuestionId,
        answer: "这是考生的作答内容。",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(saveRes.statusCode).toBe(200);

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submitRes.statusCode).toBe(200);
    const submitBody = submitRes.json();
    expect(submitBody.status).toBe("submitted");

    const takeRes = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(takeRes.statusCode).toBe(200);
    const body = takeRes.json();
    const q = body.questions[0];

    // After submit the attempt is locked; the candidate may re-read their own
    // submitted answer, but the grading metadata must still be absent.
    expect(q.answerValue).toBe("这是考生的作答内容。");
    expect(q).not.toHaveProperty("rubric");
    expect(q).not.toHaveProperty("standardAnswer");
    expect(q).not.toHaveProperty("gradingMode");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("关键概念正确");
    expect(serialized).not.toContain("参考要点一");
  });

  it("admin grading-details DO carry the frozen rubric and reference answer (negative control)", async () => {
    // Negative control: prove the rubric/reference data DOES exist for the
    // grader. This guards against a false-green where the leak test passes
    // simply because the data was never stored. The admin grading-details
    // projection must surface the frozen rubric and reference answer.
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const attemptId = startRes.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    const detailsRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/grading-details`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(detailsRes.statusCode).toBe(200);
    const details = detailsRes.json();
    const serialized = JSON.stringify(details);
    // The grader-facing projection DOES contain the grading basis.
    expect(serialized).toContain("关键概念正确");
    expect(serialized).toContain("参考要点一");
  });
});

/**
 * Dedicated snapshot-freeze integration test with isolated entities.
 *
 * This test creates its own course, question, exam, and enrollment to avoid
 * any dependency on the shared fixture above. It proves the stronger boundary:
 * publish → PATCH live question → start NEW attempt (after patch) → save →
 * submit → grading-details shows frozen (original) values.
 */
describe("snapshot freeze: post-publish live edit does not affect grading", () => {
  let ctx: TestContext;
  let snapshotExamId: string;
  let snapshotQuestionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(questionRoutes, { prefix: "" });
    });

    // Create dedicated course.
    const courseId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Snapshot Freeze Course",
      code: `SFRZ-${randomUUID().slice(0, 8)}`,
      description: "Snapshot freeze test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create dedicated text_response question with original rubric/reference.
    snapshotQuestionId = randomUUID();
    await ctx.db.insert(schema.questions).values({
      id: snapshotQuestionId,
      organizationId: ctx.org.id,
      courseId,
      type: "text_response",
      content: "快照冻结测试题",
      options: [],
      standardAnswer: "原始参考答案",
      attachments: [],
      score: 20,
      difficulty: 2,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: "原始评分标准",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create and publish exam.
    const candidateProfileId = await ensureCandidateProfile(ctx);
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: "Snapshot Freeze Exam",
        courseId,
        questionIds: [snapshotQuestionId],
        totalScore: 20,
        passingScore: 10,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    snapshotExamId = createRes.json().id as string;

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${snapshotExamId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishRes.statusCode).toBe(200);

    await enrollCandidateForExam(ctx, candidateProfileId, snapshotExamId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("publish → PATCH live → start NEW attempt → submit → grading-details shows frozen values", async () => {
    // 1. PATCH the live question AFTER publish but BEFORE starting an attempt.
    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${snapshotQuestionId}`,
      payload: {
        rubric: "已被修改的评分标准",
        standardAnswer: "已被修改的参考答案",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(200);

    // 2. Verify the live question now carries the patched values.
    const liveQRes = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${snapshotQuestionId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(liveQRes.statusCode).toBe(200);
    const liveQ = liveQRes.json();
    expect(liveQ.rubric).toBe("已被修改的评分标准");
    expect(liveQ.standardAnswer).toBe("已被修改的参考答案");

    // 3. Start a NEW attempt only after the live edit.
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${snapshotExamId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect([200, 201]).toContain(startRes.statusCode);
    const attemptId = startRes.json().id as string;

    // 4. Save + submit.
    const saveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${snapshotQuestionId}`,
      payload: {
        attemptId,
        questionId: snapshotQuestionId,
        answer: "考生作答内容",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(saveRes.statusCode).toBe(200);
    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submitRes.statusCode).toBe(200);

    // 5. Grading-details must show the FROZEN (original, pre-patch) values,
    // not the live-edit values — proving the snapshot was frozen at publish.
    const detailsRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/grading-details`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(detailsRes.statusCode).toBe(200);
    const details = detailsRes.json();
    const serialized = JSON.stringify(details);

    expect(serialized).toContain("原始评分标准");
    expect(serialized).toContain("原始参考答案");
    expect(serialized).not.toContain("已被修改的评分标准");
    expect(serialized).not.toContain("已被修改的参考答案");
  });
});
