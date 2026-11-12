import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/schema/pg";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import {
  buildExamPayload,
  candidateRequestContext,
  createIsolatedAttemptOrg,
  type IsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";

/**
 * Temporal sampling semantics of GET /candidate/attempts/:attemptId/take —
 * characterization evidence for the R-01 decision record (#961).
 *
 * As-built, one /take request reads the ADR-006 authority clock at TWO
 * distinct points (attempts.candidate.ts):
 *
 *   1. INSIDE the reconciliation transaction callback, after the EA lock —
 *      the deadline-expiry decision instant (`ensureAttemptDeadlineReconciled`);
 *      because the read is inside the `executeInTransaction` callback, a
 *      40001/40P01 retry re-samples it (mechanism proof:
 *      packages/db/src/transactionRetryClockSampling.test.ts);
 *   2. AFTER the transaction commits — the snapshot observation instant that
 *      the response reports as `serverNow` (exam-runtime.md §6.1: the
 *      candidate countdown's truth anchor; it also feeds the server-computed
 *      `isEditable`/`canSubmit` projection).
 *
 * A NEW HTTP request always re-samples both points. These tests pin all
 * three distinctions with a scripted queue clock (each `fastify.now()` call
 * consumes the next scripted instant; exhausting the queue fails loudly, so
 * an unexpected extra consumer cannot pass silently).
 *
 * NORMATIVE STATUS: deliberately NOT converged. ADR-006's letter ("exactly
 * once per request") collides with the absence of any accepted definition of
 * the observation instant for a command-style GET, and moving either instant
 * changes candidate-visible behavior (the freeze timing on the retry path;
 * the `serverNow` countdown anchor). The unification decision is recorded as
 * BLOCKED in the #961 fix PR; these tests keep the as-built semantics
 * characterized so the decision lands on pinned ground.
 */

describe("GET /take temporal sampling semantics (characterization)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Fixed base instant; every scripted sample is an exact epoch value. */
  const BASE = 1_700_000_000_000;
  const at = (ms: number) => new Date(BASE + ms);

  /**
   * Scripted queue clock: each `fastify.now()` call shifts the next instant;
   * an unexpected extra consumer exhausts the queue and the thrown error
   * surfaces as a loud 500 instead of a silently green assertion.
   */
  function useQueueClock(instants: Date[]): void {
    let index = 0;
    ctx.app.setNowOverride(() => {
      const instant = instants[index];
      index += 1;
      if (!instant) {
        throw new Error(
          `queue clock exhausted after ${index - 1} sample(s) — the request path consumed more clock samples than this test scripted`,
        );
      }
      return instant;
    });
  }

  function releaseClock(): void {
    ctx.setNow(null);
  }

  async function createStartedAttempt(
    examTitle: string,
  ): Promise<IsolatedAttemptOrg & { attemptId: string; examId: string }> {
    const t = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: "take-temporal-test-",
      label: "TT",
    });
    const exam = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: examTitle,
        courseId: t.courseId,
        questionIds: [t.questionId],
        durationMinutes: 60,
      }),
      cookies: { "auth-token": t.adminToken },
    });
    const examId = exam.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": t.adminToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [t.candidateProfileId] },
      cookies: { "auth-token": t.adminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": t.candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    return { ...t, attemptId: startRes.json().id as string, examId };
  }

  async function setDeadline(attemptId: string, deadline: Date): Promise<void> {
    await ctx.db
      .update(schema.examAttempts)
      .set({ deadlineAt: deadline, status: "in_progress" })
      .where(eq(schema.examAttempts.id, attemptId));
  }

  async function getTake(t: IsolatedAttemptOrg, attemptId: string) {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      cookies: { "auth-token": t.candidateToken },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    return res.json();
  }

  it("one request consumes two samples: the freeze decision runs on the in-transaction instant, the snapshot reports the later observation instant", async () => {
    const t = await createStartedAttempt("Take Sampling Two Instants Exam");
    // T1 < D < T2: expired at the observation instant, NOT at the decision
    // instant. If the freeze decision used the observation sample instead,
    // the attempt would come back frozen.
    const D = at(60_000);
    await setDeadline(t.attemptId, D);
    useQueueClock([at(0), at(120_000)]);

    try {
      const body = await getTake(t, t.attemptId);

      // Freeze decision used sample 1 (T1 < D) → the attempt stays live…
      expect(body.attemptStatus).toBe("in_progress");
      const row = await createAttemptRepo(ctx.db).findById(
        candidateRequestContext(t),
        t.attemptId,
      );
      expect(row?.status).toBe("in_progress");
      expect(row?.submittedAt).toBeNull();
      // …while serverNow is sample 2, the distinct post-transaction
      // observation instant the snapshot was built at.
      expect(body.serverNow).toBe(at(120_000).toISOString());
    } finally {
      releaseClock();
    }
  });

  it("when the in-transaction instant is at/after the deadline the request freezes at D, and serverNow is still the separate observation instant", async () => {
    const t = await createStartedAttempt(
      "Take Sampling Freeze At Deadline Exam",
    );
    // Sample 1 === D exactly: equality is expiry (strict `>=` deadline
    // comparison, isAttemptDeadlineExpired), so the request itself freezes.
    const D = at(60_000);
    await setDeadline(t.attemptId, D);
    useQueueClock([D, at(120_000)]);

    try {
      const body = await getTake(t, t.attemptId);

      expect(["submitted", "graded"]).toContain(body.attemptStatus);
      // Business valid submission time: the lazy reconciliation path backdates
      // submittedAt to the effective deadline, not to either clock sample.
      expect(body.submittedAt).toBe(D.toISOString());
      // The response's serverNow is the post-freeze observation instant
      // (sample 2) — NOT the instant the freeze decision ran at.
      expect(body.serverNow).toBe(at(120_000).toISOString());

      const row = await createAttemptRepo(ctx.db).findById(
        candidateRequestContext(t),
        t.attemptId,
      );
      expect(row?.submissionReason).toBe("deadline");
      expect(row?.submittedAt?.getTime()).toBe(D.getTime());
    } finally {
      releaseClock();
    }
  });

  it("a new HTTP request re-samples both points — the second request reports a fresh observation instant, not a cached one", async () => {
    const t = await createStartedAttempt("Take Sampling Per Request Exam");
    // Deadline far in the scripted future: no freeze on either request; both
    // requests stay inside the same scripted queue to prove per-request
    // capture (two samples each, consumed in request order).
    await setDeadline(t.attemptId, at(3_600_000));
    useQueueClock([at(0), at(1_000), at(2_000), at(3_000)]);

    try {
      const first = await getTake(t, t.attemptId);
      expect(first.attemptStatus).toBe("in_progress");
      expect(first.serverNow).toBe(at(1_000).toISOString());

      const second = await getTake(t, t.attemptId);
      expect(second.attemptStatus).toBe("in_progress");
      // A new request captured its own reconciliation instant (sample 3) and
      // its own observation instant (sample 4) — nothing process-global.
      expect(second.serverNow).toBe(at(3_000).toISOString());
    } finally {
      releaseClock();
    }
  });
});
