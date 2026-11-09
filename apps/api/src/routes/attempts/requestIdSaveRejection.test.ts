import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { setupRequestIdHeader } from "../../plugins/requestIdHeader.js";
import { schema } from "@exam/db/schema/pg";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
} from "./__tests__/attempts.testHelpers.js";

/**
 * #924 F2 correlation, closed end-to-end at the wire: a REAL 200 business
 * rejection (`accepted: false`) carries the same server request id on the
 * `x-request-id` response header as on the `Answer save rejected` WARN line's
 * `reqId` — so a candidate-reported 请求编号 from the rejection alert joins
 * the server-side log line for the rejection verdict (the 200 body itself
 * still carries no requestId; that wire contract is unchanged).
 *
 * The production hook is registered here explicitly because buildTestApp
 * does not install setupRequestIdHeader (see requestIdStatusMatrix.test.ts
 * for the same composition note).
 */
describe("POST /attempts/:attemptId/answers — 200 rejection requestId correlation (#924)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let attemptId: string;
  let questionId: string;

  // Captured pino output (same pattern as candidate-save-submit.test.ts):
  // level "warn" so only the rejection WARN lines are collected.
  const logLines: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc: unknown, cb: (err?: Error | null) => void) {
      logLines.push(chunk.toString());
      cb();
    },
  });

  beforeAll(async () => {
    const combinedPlugin: FastifyPluginAsync = async (fastify) => {
      setupRequestIdHeader(fastify);
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    };
    ctx = await buildTestApp(combinedPlugin, {
      logger: { level: "warn", stream: logStream },
    });

    const courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "RequestId Rejection Course",
      code: `RRC-${crypto.randomUUID().slice(0, 8)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.questions).values({
      id: questionId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "requestid rejection question",
      options: [
        { id: "a", content: "1" },
        { id: "b", content: "2" },
        { id: "c", content: "3" },
      ],
      standardAnswer: "b",
      attachments: [],
      score: 100,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      createdAt: now,
      updatedAt: now,
    });
    const candidateProfileId = await ensureCandidateProfile(ctx);

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: "RequestId Rejection Exam",
        courseId,
        questionIds: [questionId],
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(examRes.statusCode).toBe(201);
    const examId = examRes.json().id as string;
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
    expect(startRes.statusCode).toBe(201);
    attemptId = startRes.json().id as string;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("an accepted save carries the x-request-id header too (positive control)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: "b",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
    expect(typeof res.headers["x-request-id"]).toBe("string");
  });

  it("a real 200 business rejection: header == rejection WARN reqId, body carries no requestId", async () => {
    logLines.length = 0;
    // Stale baseVersion + different content → real STALE_VERSION verdict.
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: "a",
        clientSeq: 2,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe("STALE_VERSION");
    // Wire contract unchanged: the 200 rejection body has no requestId —
    // the header is the ONLY client-visible carrier of this request's id.
    expect(body).not.toHaveProperty("requestId");
    expect(body).not.toHaveProperty("error");

    const header = res.headers["x-request-id"] as string;
    expect(header).toBeTruthy();

    const parsed = logLines
      .flatMap((line) => line.split("\n"))
      .filter((line) => line.includes("Answer save rejected"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed).toHaveLength(1);
    const entry = parsed[0]!;
    expect(entry.attemptId).toBe(attemptId);
    expect(entry.questionId).toBe(questionId);
    expect(entry.clientSeq).toBe(2);
    expect(entry.reason).toBe("STALE_VERSION");
    // The F2 correlation closes: the header the candidate can report is the
    // same request id that keys the server's rejection log line.
    expect(entry.reqId).toBe(header);
  });
});
