import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { ContentDocumentV1Schema } from "@exam/contracts";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";

/**
 * Rich canonical closure at the SaveAnswer wire (#669 Phase D1, RC-03).
 *
 * Phase C proved the merge class (PC-F01) at the engine seam and inferred
 * route reachability; these tests drive the real route: a legal input whose
 * canonical form violates CONTENT_LIMITS must be rejected before durable
 * acceptance (INVALID_ANSWER), while the exactly-at-limit canonical form is
 * accepted, replayed, and served back as a schema-legal canonical value.
 */
describe("rich answer canonical closure (save-answer route)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;
  let attemptId: string;

  const MERGE_SEED = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a".repeat(20000) },
          { type: "text", text: "b" },
        ],
      },
    ],
  };

  const AT_LIMIT_SEED = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a".repeat(19999) },
          { type: "text", text: "b" },
        ],
      },
    ],
  };

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
        name: "Closure Course",
        code: `CL-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id as string;

    const questionRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "text_response",
        answerMode: "rich",
        contentDocument: {
          docVersion: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Describe in detail." }],
            },
          ],
        },
        options: [],
        standardAnswer: null,
        score: 10,
        difficulty: 1,
        rubric: "r",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = questionRes.json().id as string;

    const existing = await ctx.db
      .select({ id: schema.candidateProfiles.id })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
    candidateProfileId = existing[0]?.id ?? crypto.randomUUID();
    if (!existing[0]) {
      await ctx.db.insert(schema.candidateProfiles).values({
        id: candidateProfileId,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Rich Closure Exam",
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3600000).toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
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
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 3,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = examRes.json().id as string;
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
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    attemptId = startRes.json().id as string;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function saveAnswer(answer: unknown, clientSeq: number, baseVersion = 0) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer,
        clientSeq,
        clientSavedAt: new Date().toISOString(),
        baseVersion,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
  }

  it("rejects the merge-class seed at the wire with INVALID_ANSWER (PC-F01)", async () => {
    const res = await saveAnswer(MERGE_SEED, 1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accepted: false,
      reason: "INVALID_ANSWER",
    });
  });

  it("accepts the exactly-at-limit canonical form, replays it, and serves it back schema-legal", async () => {
    const first = await saveAnswer(AT_LIMIT_SEED, 10);
    expect(first.statusCode, first.body).toBe(200);
    const accepted = first.json();
    expect(accepted, first.body).toMatchObject({
      accepted: true,
      serverVersion: 1,
    });

    // §12 replay: same clientSeq + same canonical identity → same prior
    // acknowledgement, zero new write (serverVersion unchanged).
    const replay = await saveAnswer(AT_LIMIT_SEED, 10);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      accepted: true,
      serverVersion: accepted.serverVersion,
    });

    // The served canonical answer (stale-version probe) is the merged
    // at-limit form and passes the schema it must satisfy on every read.
    const probe = await saveAnswer(
      {
        docVersion: 1,
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "new" }] },
        ],
      },
      11,
      0,
    );
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({
      accepted: false,
      reason: "STALE_VERSION",
    });
    const served = probe.json().details?.serverAnswer;
    expect(
      ContentDocumentV1Schema.safeParse(served).success,
      JSON.stringify(served)?.slice(0, 200),
    ).toBe(true);
    expect(served).toEqual({
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "a".repeat(19999) + "b" }],
        },
      ],
    });
  });

  // D-F01 regression (#669 Phase F): the authority used to accept these
  // strings and fail at the PostgreSQL jsonb write as HTTP 500. The schema
  // intake now rejects them, so the wire answer is the structured
  // INVALID_ANSWER rejection with zero durable write.
  async function durableState() {
    const [attempt] = await ctx.db
      .select({ answers: schema.examAttempts.answers })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    // exam_answer_save_receipts has a composite PK (org, attempt, question,
    // clientSeq) — no id column; select a real column.
    const receipts = await ctx.db
      .select({ questionId: schema.examAnswerSaveReceipts.questionId })
      .from(schema.examAnswerSaveReceipts)
      .where(eq(schema.examAnswerSaveReceipts.attemptId, attemptId));
    return { answers: attempt?.answers ?? null, receiptCount: receipts.length };
  }

  // D-F01 at the wire: both unrepresentable families (U+0000, lone
  // surrogates) go through the same structured INVALID_ANSWER + zero
  // durable write mechanism, so the route-level rejection is table-driven.
  it.each([
    ["U+0000", "a\u0000b", 20],
    ["lone high surrogate", "\uD800", 21],
    ["lone low surrogate", "\uDC00", 22],
  ] as const)(
    "rejects a rich answer carrying %s with structured INVALID_ANSWER and zero durable write (D-F01)",
    async (_family, bad, clientSeq) => {
      const before = await durableState();
      const res = await saveAnswer(
        {
          docVersion: 1,
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: bad }] },
          ],
        },
        clientSeq,
      );
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        accepted: false,
        reason: "INVALID_ANSWER",
      });
      expect(await durableState()).toEqual(before);
    },
  );

  it("still accepts well-formed exotic scalars — representability, not ASCII-ness", async () => {
    const res = await saveAnswer(
      {
        docVersion: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "答案 🚀 \uFFFD" }],
          },
        ],
      },
      23,
      1,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true });
  });
});
