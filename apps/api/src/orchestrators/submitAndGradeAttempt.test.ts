import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSharedAttemptFixture } from "../routes/attempts/__tests__/attempts.testHelpers.js";
import { randomUUID } from "node:crypto";

describe("submitAndGradeAttempt (via route)", () => {
  let fixture: Awaited<ReturnType<typeof buildSharedAttemptFixture>>;

  beforeAll(async () => {
    fixture = await buildSharedAttemptFixture();
  });

  afterAll(async () => {
    await fixture.ctx.cleanup();
  });

  describe("POST /attempts/:attemptId/submit", () => {
    it("submits and auto-grades a correct answer", async () => {
      const { ctx, examId, questionId } = fixture;
      const token = ctx.candidateToken;

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": token },
      });
      expect([200, 201]).toContain(startRes.statusCode);
      const attempt = startRes.json();
      const attemptId = attempt.id;

      if (attempt.status === "in_progress") {
        await ctx.app.inject({
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
          cookies: { "auth-token": token },
        });
      }

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": token },
      });
      expect(submitRes.statusCode).toBe(200);
      const body = submitRes.json();
      expect(body.status).toBe("graded");
    });

    it("is idempotent for already-graded attempt", async () => {
      const { ctx, examId } = fixture;
      const token = ctx.candidateToken;

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": token },
      });
      expect([200, 201]).toContain(startRes.statusCode);
      const attempt = startRes.json();
      const attemptId = attempt.id;

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": token },
      });
      expect(submitRes.statusCode).toBe(200);
      const firstSubmit = submitRes.json();
      expect(firstSubmit.status).toBe("graded");

      const secondSubmitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": token },
      });
      expect(secondSubmitRes.statusCode).toBe(200);
      const secondSubmit = secondSubmitRes.json();
      expect(secondSubmit.status).toBe("graded");
      expect(secondSubmit.score).toBe(firstSubmit.score);
    });

    it("submits without answers and grades as zero", async () => {
      const { ctx, examId } = fixture;
      const token = ctx.candidateToken;

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": token },
      });
      expect([200, 201]).toContain(startRes.statusCode);
      const attempt = startRes.json();
      const attemptId = attempt.id;

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": token },
      });
      expect(submitRes.statusCode).toBe(200);
      const body = submitRes.json();
      expect(body.status).toBe("graded");
      expect(body.score).toBe(0);
    });

    it("returns 404 for non-existent attempt", async () => {
      const { ctx } = fixture;
      const fakeId = randomUUID();

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${fakeId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
