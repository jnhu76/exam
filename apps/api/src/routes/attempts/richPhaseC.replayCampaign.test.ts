/**
 * Phase-C Campaign F (#669) — mutable-attempt replay guarantee (L4).
 *
 * Frozen semantics (contract §12): during the mutable lifetime of an Attempt,
 * an accepted clientSeq MUST NOT silently become unknown. Current
 * implementation: full-history receipts (clientSeqHistory) — every accepted
 * save folds the prior answer into an unbounded receipt list.
 *
 * Drives the REAL production route composition (transaction + EA lock +
 * deadline reconciliation + saveAnswer + validateAnswerForQuestion) against
 * real PostgreSQL:
 *   save seq 1..N → replay old accepted seq k (same payload) → prior ACK
 *   replay seq k with different payload → CONFLICTING_PAYLOAD
 * Resource behavior (C5 evidence) is measured and reported separately from
 * the semantic verdicts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { emitLedgerLine } from "../../rich-phase-c/generators";
import questionRoutes from "../question.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
} from "./__tests__/attempts.testHelpers.js";

function richDoc(marker: string): unknown {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: `save ${marker}` }],
      },
    ],
  };
}

describe("Phase-C Campaign F — replay across the full mutable lifetime (L4)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let richQuestionId: string;
  let examId: string;
  let attemptId: string;
  let richQId: string;

  const N = 30; // bounded save count (C5 evidence horizon)
  const savedAtBySeq = new Map<number, string>();
  const jsonbBytesAt: Array<{ seq: number; bytes: number }> = [];

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
      name: "Replay Campaign Course",
      code: `RC-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        score: 50,
        difficulty: 1,
        type: "text_response",
        contentDocument: richDoc("prompt"),
        answerMode: "rich",
        options: [],
        standardAnswer: null,
        rubric: "按要点给分",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, res.body).toBe(201);
    richQuestionId = res.json().id as string;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: "Replay Campaign Exam",
        courseId,
        questionIds: [richQuestionId],
        totalScore: 50,
        passingScore: 30,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(examRes.statusCode, examRes.body).toBe(201);
    examId = examRes.json().id as string;
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
    expect(startRes.statusCode, startRes.body).toBe(201);
    attemptId = startRes.json().id as string;
    const snapshot = startRes.json().questionSnapshot as Array<{
      originalQuestionId: string;
    }>;
    richQId = snapshot[0]?.originalQuestionId as string;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function save(
    seq: number,
    answer: unknown,
    baseVersion: number,
  ): Promise<ReturnType<typeof ctx.app.inject>> {
    return ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${richQId}`,
      payload: {
        attemptId,
        questionId: richQId,
        answer,
        clientSeq: seq,
        clientSavedAt: new Date().toISOString(),
        baseVersion,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
  }

  async function rawAnswers(): Promise<{
    json: string;
    row: Record<string, unknown> | undefined;
  }> {
    const rows = await ctx.db
      .select({ answers: schema.examAttempts.answers })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    const row = rows[0]?.answers as unknown;
    return { json: JSON.stringify(row), row: row as Record<string, unknown> };
  }

  it("save seq 1..N: every save accepted; receipts grow unboundedly (C5 resource evidence)", async () => {
    for (let seq = 1; seq <= N; seq++) {
      const res = await save(seq, richDoc(String(seq)), seq - 1);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(true);
      expect(body.serverVersion).toBe(seq);
      savedAtBySeq.set(seq, body.savedAt as string);
      if (seq === 1 || seq === 10 || seq === N) {
        const { json } = await rawAnswers();
        jsonbBytesAt.push({ seq, bytes: json.length });
      }
    }
    const { row } = await rawAnswers();
    const answerRow = (row as unknown as Array<Record<string, unknown>>)?.find(
      (a) => a.questionId === richQId,
    );
    const history = answerRow?.clientSeqHistory as Array<{ clientSeq: number }>;
    // Frozen observation: after N accepted saves the receipt list holds N-1
    // full-payload entries (the live row carries seq N).
    expect(history).toHaveLength(N - 1);
    expect(history.map((h) => h.clientSeq)).toEqual(
      Array.from({ length: N - 1 }, (_, i) => i + 1),
    );
    emitLedgerLine("PHASE-C-F-GROWTH", {
      jsonbBytesAt,
      historyLength: N - 1,
    });
  });

  it("replay of the OLDEST accepted seq (1) with the same payload → original acknowledgement, zero new write", async () => {
    const before = await rawAnswers();
    const res = await save(1, richDoc("1"), N);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.serverVersion).toBe(1);
    expect(body.savedAt).toBe(savedAtBySeq.get(1));
    const after = await rawAnswers();
    expect(after.json).toBe(before.json);
  });

  it("replay of a MID-HISTORY seq (17) with the same payload → original acknowledgement", async () => {
    const res = await save(17, richDoc("17"), N);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.serverVersion).toBe(17);
    expect(body.savedAt).toBe(savedAtBySeq.get(17));
  });

  it("replay with a different payload under an old seq → CONFLICTING_PAYLOAD; wire carries NO latestAnswer", async () => {
    const before = await rawAnswers();
    const res = await save(17, richDoc("tampered"), N);
    // Wire mapping: every save outcome is HTTP 200; rejections carry
    // accepted:false + reason (the route returns the body without a status).
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe("CONFLICTING_PAYLOAD");
    // Route-level observation: the engine builds latestAnswer, but the wire
    // mapping drops it (only STALE_VERSION carries details.serverAnswer).
    expect(JSON.stringify(body)).not.toContain("latestAnswer");
    const after = await rawAnswers();
    expect(after.json).toBe(before.json);
  });

  it("unknown seq still follows CAS semantics (not swallowed by receipts)", async () => {
    const res = await save(N + 1, richDoc(String(N + 1)), N);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().accepted).toBe(true);
    expect(res.json().serverVersion).toBe(N + 1);
  });
});
