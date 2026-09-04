import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
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
 * The answer save protocol with rich content: INVALID_ANSWER rejection,
 * canonicalization-before-idempotency, and draft isolation.
 */
describe("rich answer save protocol", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let richQuestionId: string;
  let choiceQuestionId: string;
  let attemptId: string;
  let richQId: string;

  const RICH_DOC = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "my rich answer" }],
      },
    ],
  };

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(questionRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });

    courseId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Rich Answer Course",
      code: `RA-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    async function createQuestion(payload: Record<string, unknown>) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/questions",
        payload: { courseId, score: 50, difficulty: 1, ...payload },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().id as string;
    }

    richQuestionId = await createQuestion({
      type: "text_response",
      contentDocument: {
        docVersion: 1,
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Explain" }] },
        ],
      },
      answerMode: "rich",
      options: [],
      standardAnswer: null,
      rubric: "按要点给分",
    });

    choiceQuestionId = await createQuestion({
      type: "single_choice",
      content: "Pick one",
      options: [
        { id: "a", content: "1" },
        { id: "b", content: "2" },
      ],
      standardAnswer: "a",
    });

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: "Rich Answer Exam",
        courseId,
        questionIds: [richQuestionId, choiceQuestionId],
        totalScore: 100,
        passingScore: 60,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = examRes.json().id as string;
    const pub = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(pub.statusCode, pub.body).toBe(200);
    const candidateProfileId = await ensureCandidateProfile(ctx);
    await enrollCandidateForExam(ctx, candidateProfileId, examId);
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    attemptId = startRes.json().id as string;
    const snapshot = startRes.json().questionSnapshot as Array<{
      originalQuestionId: string;
      type: string;
      answerMode: string | null;
      contentDocument: unknown;
    }>;
    richQId = snapshot.find(
      (q) => q.type === "text_response",
    )!.originalQuestionId;
    expect(snapshot.find((q) => q.type === "text_response")!.answerMode).toBe(
      "rich",
    );
    expect(
      snapshot.find((q) => q.type === "text_response")!.contentDocument,
    ).toEqual({
      docVersion: 1,
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Explain" }] },
      ],
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function savePayload(
    questionId: string,
    answer: unknown,
    clientSeq: number,
    baseVersion: number,
  ) {
    return {
      attemptId,
      questionId,
      answer,
      clientSeq,
      clientSavedAt: new Date().toISOString(),
      baseVersion,
    };
  }

  async function save(questionId: string, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload,
      cookies: { "auth-token": ctx.candidateToken },
    });
  }

  async function draftAnswer(questionId: string): Promise<unknown> {
    const rows = await ctx.db
      .select({ answers: schema.examAttempts.answers })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    const answer = (rows[0]?.answers ?? []).find(
      (a: { questionId: string }) => a.questionId === questionId,
    );
    return answer?.answer ?? null;
  }

  it("accepts a valid rich document and persists the canonical value", async () => {
    const res = await save(richQId, savePayload(richQId, RICH_DOC, 1, 0));
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
    expect(res.json().serverVersion).toBe(1);
    expect(await draftAnswer(richQId)).toEqual(RICH_DOC);
  });

  it("replays the same clientSeq with a transient equivalent form idempotently", async () => {
    // Different transient decomposition, same canonical document: the
    // idempotency comparison must see canonical values, not raw payloads.
    const transientForm = {
      ...RICH_DOC,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "my rich " },
            { type: "text", text: "" },
            { type: "text", text: "answer" },
          ],
        },
      ],
    };
    const res = await save(richQId, savePayload(richQId, transientForm, 1, 1));
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
    expect(res.json().serverVersion).toBe(1);
  });

  it("rejects the same clientSeq with a semantically different document (CONFLICTING_PAYLOAD)", async () => {
    const differentDoc = {
      ...RICH_DOC,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "DIFFERENT" }] },
      ],
    };
    const res = await save(richQId, savePayload(richQId, differentDoc, 1, 1));
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(false);
    expect(res.json().reason).toBe("CONFLICTING_PAYLOAD");
  });

  it("rejects a plain string for a rich text_response with INVALID_ANSWER and no draft write", async () => {
    const before = await draftAnswer(richQId);
    const res = await save(richQId, savePayload(richQId, "plain text", 2, 1));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe("INVALID_ANSWER");
    expect(body.message).toBe("答案格式不符合此题要求，请检查作答内容");
    expect(body.serverVersion).toBe(1);
    expect(await draftAnswer(richQId)).toEqual(before);
  });

  it("rejects a hostile-depth grammar bomb at the save seam in a controlled way", async () => {
    // Real grammar bomb — bulletList → listItem → bulletList → … — only the
    // depth/length preflight can stop it. Must be a controlled 200
    // INVALID_ANSWER (preflight through the canonicalizer) or Fastify 400,
    // never a 500/RangeError from z.lazy recursion.
    let block: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "leaf" }],
    };
    for (let i = 0; i < 500; i++) {
      block = {
        type: "bulletList",
        content: [{ type: "listItem", content: [block] }],
      };
    }
    const res = await save(
      richQId,
      savePayload(
        richQId,
        { docVersion: 1, type: "doc", content: [block] },
        10_000 + 500,
        0,
      ),
    );
    if (res.statusCode === 200) {
      expect(res.json().accepted).toBe(false);
      expect(res.json().reason).toBe("INVALID_ANSWER");
    } else {
      expect(res.statusCode).toBe(400);
    }
  });
});
