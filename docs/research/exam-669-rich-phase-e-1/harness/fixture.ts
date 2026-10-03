/**
 * Shared L4 fixture for the wire-level campaigns (D, H, I, K): a real
 * PostgreSQL-backed app (buildTestApp) with course/question/exam/attempt
 * routes, one rich text_response question, one published exam, one enrolled
 * candidate, one started attempt. Harness-internal only — production test
 * support stays in apps/api.
 */
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import type { ContentDocumentV1 } from "@exam/domain";
import {
  buildTestApp,
  uniquePrefix,
  type TestContext,
} from "@exam/api/src/routes/testHelpers.js";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import courseRoutes from "@exam/api/src/routes/course.js";
import questionRoutes from "@exam/api/src/routes/question.js";
import examRoutes from "@exam/api/src/routes/exam.js";
import attemptRoutes from "@exam/api/src/routes/attempts.js";

export const allAttemptRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(courseRoutes, { prefix: "" });
  await fastify.register(questionRoutes, { prefix: "" });
  await fastify.register(examRoutes, { prefix: "" });
  await fastify.register(attemptRoutes, { prefix: "" });
};

export type RichAttemptFixture = {
  ctx: Awaited<ReturnType<typeof buildTestApp>>;
  courseId: string;
  questionId: string;
  examId: string;
  attemptId: string;
  /** Starts the next attempt (retake) and re-points all helpers at it. */
  startNewAttempt(): Promise<string>;
  postAnswer(
    answer: unknown,
    clientSeq: number,
    baseVersion: number,
    app?: FastifyInstance,
  ): Promise<ReturnType<FastifyInstance["inject"]>>;
  getAttemptBody(app?: FastifyInstance): Promise<Record<string, unknown>>;
  getAttemptRaw(
    app?: FastifyInstance,
  ): Promise<ReturnType<FastifyInstance["inject"]>>;
  slotOf(body: Record<string, unknown>): Record<string, unknown> | undefined;
};

export async function buildRichAttemptFixture(
  questionPrompt = "Answer with structure.",
  opts: { answerMode?: "rich" | "plain" } = {},
): Promise<RichAttemptFixture> {
  const answerMode = opts.answerMode ?? "rich";
  const ctx = await buildTestApp(allAttemptRoutes);

  const courseRes = await ctx.app.inject({
    method: "POST",
    url: "/api/courses",
    payload: {
      name: "Phase E Course",
      code: `PE-${uniquePrefix()}`,
      description: "",
    },
    cookies: { "auth-token": ctx.adminToken },
  });
  const courseId = courseRes.json().id as string;

  const contentDocument: ContentDocumentV1 = {
    docVersion: 1,
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: questionPrompt }] },
    ],
  };
  const questionRes = await ctx.app.inject({
    method: "POST",
    url: "/api/questions",
    payload: {
      courseId,
      type: "text_response",
      answerMode,
      contentDocument,
      options: [],
      standardAnswer: null,
      score: 10,
      difficulty: 1,
      rubric: "r",
    },
    cookies: { "auth-token": ctx.adminToken },
  });
  const questionId = questionRes.json().id as string;

  const existing = await ctx.db
    .select({ id: schema.candidateProfiles.id })
    .from(schema.candidateProfiles)
    .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
  const candidateProfileId = existing[0]?.id ?? crypto.randomUUID();
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
      title: "Phase E Exam",
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
      maxAttempts: 10,
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

  // Mutable: the helpers always target the CURRENT attempt; retakes re-point
  // them via startNewAttempt().
  let currentAttemptId = "";
  const startNewAttempt = async (): Promise<string> => {
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    if (startRes.statusCode !== 200 && startRes.statusCode !== 201) {
      throw new Error(
        `start attempt failed: ${startRes.statusCode} ${startRes.body.slice(0, 200)}`,
      );
    }
    currentAttemptId = startRes.json().id as string;
    return currentAttemptId;
  };
  await startNewAttempt();

  const postAnswer = (
    answer: unknown,
    clientSeq: number,
    baseVersion: number,
    app?: FastifyInstance,
  ) =>
    (app ?? ctx.app).inject({
      method: "POST",
      url: `/api/attempts/${currentAttemptId}/answers/${questionId}`,
      payload: {
        attemptId: currentAttemptId,
        questionId,
        answer,
        clientSeq,
        clientSavedAt: new Date().toISOString(),
        baseVersion,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });

  const getAttemptRaw = (app?: FastifyInstance) =>
    (app ?? ctx.app).inject({
      method: "GET",
      url: `/api/attempts/${currentAttemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });

  const getAttemptBody = async (app?: FastifyInstance) => {
    const res = await getAttemptRaw(app);
    if (res.statusCode !== 200) {
      throw new Error(
        `GET attempt failed: ${res.statusCode} ${res.body.slice(0, 200)}`,
      );
    }
    return res.json() as Record<string, unknown>;
  };

  const slotOf = (body: Record<string, unknown>) =>
    (body.answers as Array<Record<string, unknown>>).find(
      (a) => a.questionId === questionId,
    );

  return {
    ctx,
    courseId,
    questionId,
    examId,
    get attemptId(): string {
      return currentAttemptId;
    },
    startNewAttempt,
    postAnswer,
    getAttemptBody,
    getAttemptRaw,
    slotOf,
  };
}
