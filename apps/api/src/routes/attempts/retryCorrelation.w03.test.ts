/**
 * #1006 — W03 answer-save transaction retry correlation (D6.1), real HTTP seam.
 *
 * Owner-frozen contract (issue #1006 comment 6943590527): the existing
 * `transaction retry` WARN must carry a CLOSED `correlation` object whose
 * `requestId` is the same server-minted identity as the response
 * `x-request-id` header (ADR-025 + setupRequestIdHeader) and as the
 * framework's `request completed` line `reqId`. That join is the only
 * mechanism D6.1 allows: the terminal 409 of a 40001 exhaustion is silent
 * (`plugins/errors.ts:118-121`) and "3 warn + 409" does NOT prove exhaustion
 * (a 4th-attempt 23505 looks identical), so these tests pin observable facts
 * and never a cause verdict.
 *
 * The DB transaction boundary is fault-injected (an architecture boundary);
 * retry classification, backoff, logging, request identity and the HTTP
 * mapping are the real implementation.
 *
 * Wiring note: production wires `setTransactionRetryLogger(fastify.log)` in
 * `plugins/db.ts:35`; `buildTestApp`'s reduced db plugin only decorates
 * `fastify.db`, so this file wires the same seam explicitly.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Writable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import { setTransactionRetryLogger } from "@exam/db/types";
import { schema } from "@exam/db/schema/pg";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { setupRequestIdHeader } from "../../plugins/requestIdHeader.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
} from "./__tests__/attempts.testHelpers.js";

type LogLine = Record<string, unknown>;

const RETRY_MSG = "transaction retry";
const COMPLETED_MSG = "request completed";

describe("POST /attempts/:attemptId/answers — transaction retry correlation (#1006)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let attemptId: string;
  let questionId: string;
  let restoreTransaction: (() => void) | undefined;

  // Captured pino output at info level: retry WARNs and the framework
  // `request completed` trace must land in the SAME stream to prove the join.
  const logChunks: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc: unknown, cb: (err?: Error | null) => void) {
      logChunks.push(chunk.toString());
      cb();
    },
  });

  function lines(): LogLine[] {
    return logChunks
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line) as LogLine);
  }

  function correlationOf(line: LogLine): { requestId?: string } | undefined {
    return line.correlation as { requestId?: string } | undefined;
  }

  function retryWarns(requestId: string): LogLine[] {
    return lines().filter(
      (line) =>
        line.msg === RETRY_MSG && correlationOf(line)?.requestId === requestId,
    );
  }

  function completed(requestId: string): LogLine | undefined {
    return lines().find(
      (line) => line.msg === COMPLETED_MSG && line.reqId === requestId,
    );
  }

  /**
   * Fault-injects the DB transaction boundary: the first `count` transaction
   * attempts throw the given SQLSTATE before the callback runs. `"all"`
   * exhausts the retry ceiling (1 initial attempt + MAX_RETRIES = 4).
   */
  function failTransactions(
    count: number | "all",
    sqlstate = "40001",
  ): () => void {
    const db = ctx.db as unknown as Record<string, unknown>;
    const original = (
      db.transaction as (...args: unknown[]) => Promise<unknown>
    ).bind(db);
    let remaining = count;
    db.transaction = async (fn: unknown, config: unknown) => {
      if (remaining === "all" || remaining > 0) {
        if (remaining !== "all") remaining -= 1;
        throw Object.assign(new Error("could not serialize access"), {
          code: sqlstate,
        });
      }
      return original(fn, config);
    };
    return () => {
      Reflect.deleteProperty(db, "transaction");
    };
  }

  function saveAnswer(payload: {
    answer: string;
    clientSeq: number;
    baseVersion: number;
  }) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        clientSavedAt: new Date().toISOString(),
        ...payload,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
  }

  beforeAll(async () => {
    const combinedPlugin: FastifyPluginAsync = async (fastify) => {
      setupRequestIdHeader(fastify);
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    };
    ctx = await buildTestApp(combinedPlugin, {
      logger: { level: "info", stream: logStream },
    });
    // Production wiring owner: plugins/db.ts:35 (see file doclet).
    setTransactionRetryLogger(ctx.app.log);

    const courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Retry Correlation Course",
      code: `RCC-${crypto.randomUUID().slice(0, 8)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.questions).values({
      id: questionId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "retry correlation question",
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
        title: "Retry Correlation Exam",
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
    setTransactionRetryLogger(null);
    await ctx.cleanup();
  });

  beforeEach(() => {
    logChunks.length = 0;
    restoreTransaction = undefined;
  });

  afterEach(() => {
    restoreTransaction?.();
    restoreTransaction = undefined;
  });

  it("first-try success: 200 with zero retry warns for that requestId (D6.1 row 1)", async () => {
    const res = await saveAnswer({
      answer: "b",
      clientSeq: 1,
      baseVersion: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);

    const requestId = res.headers["x-request-id"] as string;
    expect(requestId).toBeTruthy();
    expect(retryWarns(requestId)).toHaveLength(0);
    const trace = completed(requestId);
    expect(trace).toBeDefined();
    expect((trace?.res as { statusCode?: number }).statusCode).toBe(200);
  });

  it("success after retries: every warn carries the SAME request identity as the header and the request trace (D6.1 row 2 + T1)", async () => {
    restoreTransaction = failTransactions(2);

    const res = await saveAnswer({
      answer: "c",
      clientSeq: 2,
      baseVersion: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);

    const requestId = res.headers["x-request-id"] as string;
    expect(requestId).toBeTruthy();

    const warns = retryWarns(requestId);
    expect(warns.map((line) => line.attempt)).toEqual([1, 2]);
    for (const warn of warns) {
      expect(warn.sqlstate).toBe("40001");
      const correlation = warn.correlation as Record<string, unknown>;
      // Closed correlation object: exact key set, no ambient identity.
      expect(Object.keys(correlation).sort()).toEqual([
        "attemptId",
        "operation",
        "organizationId",
        "requestId",
      ]);
      expect(correlation.requestId).toBe(requestId);
      expect(correlation.attemptId).toBe(attemptId);
      expect(correlation.organizationId).toBe(ctx.org.id);
      expect(correlation.operation).toBe("attempt.answer.save");
    }

    // The three-way identity is one authority: response header (request.id),
    // retry WARN correlation.requestId and `request completed` reqId.
    const trace = completed(requestId);
    expect(trace).toBeDefined();
    expect(trace?.reqId).toBe(requestId);
    expect((trace?.res as { statusCode?: number }).statusCode).toBe(200);
  });

  it("terminal exhaustion: 3 warns + silent 409, identity still joins (D6.1 row 3 + T2)", async () => {
    restoreTransaction = failTransactions("all");

    const res = await saveAnswer({
      answer: "a",
      clientSeq: 3,
      baseVersion: 2,
    });
    // 40001 exhaustion maps to 409 RESOURCE_CONFLICT in the global boundary;
    // the terminal line is silent, so only the request trace records the outcome.
    expect(res.statusCode).toBe(409);

    const requestId = res.headers["x-request-id"] as string;
    expect(requestId).toBeTruthy();

    const warns = retryWarns(requestId);
    expect(warns.map((line) => line.attempt)).toEqual([1, 2, 3]);
    expect(warns.every((line) => line.sqlstate === "40001")).toBe(true);
    for (const warn of warns) {
      expect(correlationOf(warn)?.requestId).toBe(requestId);
    }

    const trace = completed(requestId);
    expect(trace).toBeDefined();
    expect(trace?.reqId).toBe(requestId);
    expect((trace?.res as { statusCode?: number }).statusCode).toBe(409);
  });

  it("non-retryable unique violation: 0 warns + 409, so warn count separates it from exhaustion (D6.1 row 4 + T5)", async () => {
    restoreTransaction = failTransactions(1, "23505");

    const res = await saveAnswer({
      answer: "a",
      clientSeq: 4,
      baseVersion: 2,
    });
    expect(res.statusCode).toBe(409);

    const requestId = res.headers["x-request-id"] as string;
    expect(requestId).toBeTruthy();
    expect(retryWarns(requestId)).toHaveLength(0);
    const trace = completed(requestId);
    expect(trace?.reqId).toBe(requestId);
    expect((trace?.res as { statusCode?: number }).statusCode).toBe(409);
  });
});
