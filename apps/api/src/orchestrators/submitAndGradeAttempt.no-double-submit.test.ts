import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildSharedAttemptFixture } from "../routes/attempts/__tests__/attempts.testHelpers.js";

/**
 * Regression: deadline reconciliation must not cause a second
 * orchestrator-level submitAttempt call.
 *
 * vi.mock hoists and intercepts the @exam/exam-engine module so that
 * submitAttempt calls are counted. On the normal (non-expired) path the
 * orchestrator calls submitAttempt exactly once. Before the fix the old
 * stale-`status` variable would cause a second call (caught by the
 * idempotency guard, but still an unnecessary FOR UPDATE + round-trip).
 */
let submitCallCount = 0;

vi.mock("@exam/exam-engine", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual: any = await importOriginal();
  return {
    ...actual,
    submitAttempt: async (...args: Parameters<typeof actual.submitAttempt>) => {
      submitCallCount++;
      return actual.submitAttempt(...args);
    },
  };
});

describe("no double submit on orchestrator submit path", () => {
  let fixture: Awaited<ReturnType<typeof buildSharedAttemptFixture>>;

  beforeAll(async () => {
    fixture = await buildSharedAttemptFixture();
  });

  afterAll(async () => {
    await fixture.ctx.cleanup();
  });

  it("calls submitAttempt exactly once for a normal submit", async () => {
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

    submitCallCount = 0;

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": token },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().status).toBe("graded");
    expect(submitCallCount).toBe(1);
  });
});
