import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCandidateViaApi,
  uniquePrefix,
} from "./testHelpers.js";
import authRoutes from "./auth.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";

// P0-4 — Submit freeze barrier (ADR-008).
//
// Reproduces the real save-vs-submit race and enforces the invariants the
// CURRENT contract can actually guarantee. /submit carries no final-answer
// payload, so when a legal currentVersion save races with submit the Postgres
// row lock serializes them and whichever request locks first wins:
//   - save first  → false persisted → submit grades false → score 0
//   - submit first → row flips to submitted → later saves rejected → score 100
// Both outcomes are protocol-legitimate. What is NOT legitimate (and what J1
// prevents) is grading against a stale, out-of-transaction answer snapshot —
// i.e. the score diverging from the answer set the row actually ended with.
//
// This test asserts the true invariants (graded + no 5xx + each save accepted
// or deterministically rejected + score CONSISTENT with the final persisted
// answer), not a fixed score===100. See ADR-008 for the full reasoning and
// Option D (the WYSIWYG submit that would require a contract change) as the
// follow-up.
//
// Real-Postgres integration test (no fake repos, no DB mocking). Loops the
// race N times to prove the invariants hold across interleavings.

const RACE_ITERATIONS = 5;

async function saveAnswer(
  app: Awaited<ReturnType<typeof buildTestApp>>["app"],
  token: string,
  attemptId: string,
  questionId: string,
  answer: boolean,
  clientSeq: number,
  baseVersion: number,
) {
  return app.inject({
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
    cookies: { "auth-token": token },
  });
}

async function submitAttempt(
  app: Awaited<ReturnType<typeof buildTestApp>>["app"],
  token: string,
  attemptId: string,
) {
  return app.inject({
    method: "POST",
    url: `/api/attempts/${attemptId}/submit`,
    cookies: { "auth-token": token },
  });
}

async function getAttempt(
  app: Awaited<ReturnType<typeof buildTestApp>>["app"],
  token: string,
  attemptId: string,
) {
  const res = await app.inject({
    method: "GET",
    url: `/api/attempts/${attemptId}`,
    cookies: { "auth-token": token },
  });
  if (res.statusCode !== 200) {
    throw new Error(`GET attempt failed: ${res.statusCode} ${res.body}`);
  }
  return res.json() as {
    status: string;
    score?: number;
    passed?: boolean;
    answers: Array<{ questionId: string; answer: unknown; version: number }>;
  };
}

describe("submit freeze barrier (ADR-008) — concurrent save vs submit", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("concurrent save vs submit yields a serialized, non-corrupting result where score matches the final persisted answer", async () => {
    // Current Phase-2 contract (ADR-008): /submit does NOT carry a final-answer
    // payload or version barrier, so the server cannot define "the answer the
    // candidate saw at the instant they clicked submit". When a legal
    // currentVersion save races with submit, the Postgres row lock serializes
    // them; whichever request acquires the lock first wins:
    //   - save first → false is persisted → submit grades false → score 0
    //   - submit first → row flips to submitted → later saves rejected → score 100
    // BOTH outcomes are protocol-legitimate. The real invariants this test
    // enforces are:
    //   1. no 5xx from any concurrent request
    //   2. submit succeeds and lands in `graded`
    //   3. every racing save is either accepted (serverVersion) or rejected
    //      with a deterministic conflict reason
    //   4. the final attempt is `graded` with NO half-written/corrupt state
    //   5. the score is CONSISTENT with the final persisted answer
    //      (true→100/passed, false→0/!passed) — i.e. grading read the same
    //      answer set the row ended with, never a stale/out-of-tx snapshot.
    // J1 guarantees #5: submitAndGradeAttempt computes the score inside the
    // locked transaction, so it cannot grade against a TX-external snapshot.
    for (let i = 0; i < RACE_ITERATIONS; i++) {
      // --- setup: course + true_false question (correct = true) + exam ---
      const courseRes = await ctx.app.inject({
        method: "POST",
        url: "/api/courses",
        payload: {
          name: `Freeze Course ${uniquePrefix()}`,
          code: `FREEZE-${uniquePrefix()}`,
          description: "",
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      const courseId = courseRes.json().id;

      const qRes = await ctx.app.inject({
        method: "POST",
        url: "/api/questions",
        payload: {
          courseId,
          type: "true_false",
          content: "correct answer is true",
          standardAnswer: true,
          score: 100,
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      const questionId = qRes.json().id;

      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: `Freeze Exam ${uniquePrefix()}`,
          courseId,
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600_000).toISOString(),
          closeAt: new Date(Date.now() + 86400_000).toISOString(),
          passingScore: 60,
          totalScore: 100,
          questionIds: [questionId],
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId = examRes.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const candidate = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `freeze-cand-${uniquePrefix()}-${i}`,
        ctx.org.id,
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [candidate.candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": candidate.token },
      });
      expect(startRes.statusCode).toBe(201);
      const attemptId = startRes.json().id;

      // --- save the CORRECT answer (true) and confirm it landed ---
      const saveTrue = await saveAnswer(
        ctx.app,
        candidate.token,
        attemptId,
        questionId,
        true,
        1,
        0,
      );
      expect(saveTrue.statusCode).toBe(200);

      const before = await getAttempt(ctx.app, candidate.token, attemptId);
      const currentVersion = before.answers[0]?.version ?? 0;
      expect(currentVersion).toBeGreaterThanOrEqual(1);

      // --- the race: 1 submit + 3 saves with the WRONG answer (false),
      //     each using the LEGAL currentVersion as baseVersion ---
      const race = await Promise.all([
        submitAttempt(ctx.app, candidate.token, attemptId),
        saveAnswer(
          ctx.app,
          candidate.token,
          attemptId,
          questionId,
          false,
          9001,
          currentVersion,
        ),
        saveAnswer(
          ctx.app,
          candidate.token,
          attemptId,
          questionId,
          false,
          9002,
          currentVersion,
        ),
        saveAnswer(
          ctx.app,
          candidate.token,
          attemptId,
          questionId,
          false,
          9003,
          currentVersion,
        ),
      ]);

      const [submitResult, ...saveResults] = race;

      // Invariant 2: submit must succeed (2xx) and land in `graded`.
      expect(submitResult.statusCode).toBeGreaterThanOrEqual(200);
      expect(submitResult.statusCode).toBeLessThan(300);
      expect(submitResult.json().status).toBe("graded");

      // Invariants 1 & 3: every racing save is 2xx-4xx (never 5xx) and is
      // either accepted (idempotent, serverVersion) or rejected with a known
      // deterministic conflict reason.
      for (const s of saveResults) {
        expect(s.statusCode).toBeGreaterThanOrEqual(200);
        expect(s.statusCode).toBeLessThan(500);
        if (s.statusCode === 200) {
          expect(s.json()).toHaveProperty("serverVersion");
        } else {
          const reason = s.json().reason as string | undefined;
          expect([
            "ATTEMPT_ALREADY_SUBMITTED",
            "STALE_VERSION",
            "CONFLICTING_PAYLOAD",
            "DEADLINE_EXCEEDED",
            "ATTEMPT_CLOSED",
          ]).toContain(reason);
        }
      }

      // Invariants 4 & 5: final attempt is graded, and the score is
      // CONSISTENT with the final persisted answer. J1 guarantees grading read
      // the answer set the row ended with (no out-of-tx stale snapshot), so a
      // mismatch here would indicate the freeze barrier regressed.
      const final = await getAttempt(ctx.app, candidate.token, attemptId);
      expect(final.status).toBe("graded");
      const finalAnswer = final.answers[0]?.answer;
      const expectedScore = finalAnswer === true ? 100 : 0;
      expect(final.score).toBe(expectedScore);
      expect(final.passed).toBe(expectedScore >= 60);
    }
  }, 60_000);
});
