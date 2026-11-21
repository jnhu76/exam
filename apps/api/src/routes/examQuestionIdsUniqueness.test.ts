// #1039 (R-T2-1): duplicate questionIds must be rejected at every entry to
// the publish freeze pipeline. The frozen snapshot feeds the grading workset
// keyed by (attemptId, questionId); a duplicated id would freeze a duplicated
// snapshot item and collide with the attempt_grading_entries UNIQUE
// constraint at submit time. Covers create, draft PATCH, the publish freeze
// boundary against a historically persisted dirty row, and the intact legal
// [Q1,Q2] flow (create → publish → attempt → submit → unique workset).

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import { schema } from "@exam/db/schema/pg";
import { eq } from "drizzle-orm";
import {
  buildTestApp,
  uniquePrefix,
  submitExamAsCandidate,
} from "./testHelpers.js";

describe("exam questionIds uniqueness (#1039)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let q1: string;
  let q2: string;

  async function createQuestion(): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Uniqueness guard question.",
        standardAnswer: true,
        score: 50,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    if (res.statusCode !== 201) {
      throw new Error(`question create failed: ${res.statusCode} ${res.body}`);
    }
    return res.json().id;
  }

  function createExamPayload(questionIds: string[]) {
    return {
      title: "Uniqueness Guard Exam",
      courseId,
      durationMinutes: 60,
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 86400000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionIds,
    };
  }

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Uniqueness Course",
        code: `UG-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;
    q1 = await createQuestion();
    q2 = await createQuestion();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("POST /api/exams rejects a duplicate id in questionIds", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: createExamPayload([q1, q1]),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/exams accepts distinct ids (control)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: createExamPayload([q1, q2]),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
  });

  it("PATCH /api/exams/:id rejects a duplicate id in questionIds on a draft", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: createExamPayload([q1, q2]),
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${created.id}`,
      payload: { questionIds: [q1, q1], totalScore: 100 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /api/exams/:id accepts distinct ids on a draft (control)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: createExamPayload([q1, q2]),
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${created.id}`,
      payload: { questionIds: [q2, q1] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().questionIds).toEqual([q2, q1]);
  });

  it("publish fails closed on a historically persisted duplicate and leaves no half-frozen snapshot", async () => {
    // Dirty historical row: the write boundary now rejects duplicates, but a
    // pre-fix row persists. totalScore is the duplicate sum (50+50=100) so
    // ONLY the uniqueness guard can reject at publish — the totalScore match
    // cannot mask it.
    const now = new Date();
    const dirtyExamId = randomUUID();
    await ctx.db.insert(schema.exams).values({
      id: dirtyExamId,
      organizationId: ctx.org.id,
      title: "Dirty duplicate-questionIds draft",
      description: "",
      courseId,
      status: "draft",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86400_000),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [q1, q1],
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
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${dirtyExamId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishRes.statusCode).toBe(400);
    expect(publishRes.json().error?.code).toBe("VALIDATION_ERROR");

    // No half-frozen snapshot: the exam stays draft with an empty snapshot.
    const row = await ctx.db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, dirtyExamId));
    expect(row[0]?.status).toBe("draft");
    expect(row[0]?.questionSnapshot).toEqual([]);
  });

  it("legal [Q1,Q2] exam publishes, runs, and materializes a unique grading workset (regression)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: createExamPayload([q1, q2]),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishRes.statusCode).toBe(200);
    expect(publishRes.json().status).toBe("published");

    const submitted = await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      examId,
      `ug-candidate-${uniquePrefix()}`,
    );
    // All-objective exam: submit immediately auto-grades to `graded`.
    expect(submitted.status).toBe("graded");

    // Workset regression: exactly one entry per question, unique
    // (attemptId, questionId) — the invariant a duplicated snapshot would
    // break.
    const entries = await ctx.db
      .select()
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, submitted.id));
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.questionId)).size).toBe(2);
  });
});
