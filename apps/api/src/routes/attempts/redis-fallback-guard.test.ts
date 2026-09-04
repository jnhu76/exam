import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSharedAttemptFixture,
  type SharedAttemptFixture,
} from "./__tests__/attempts.testHelpers.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";

/**
 * P3-M7-REDIS-FALLBACK-GUARD
 *
 * Guardrail tests proving that Redis failure/absence does NOT corrupt
 * PostgreSQL authoritative candidate state. Per the M7 audit
 * (`docs/archive/phase3/audit-redis-fallback-guard-m7.md`), Redis is
 * diagnostics-only today: no candidate/answer/score/submit/attempt code path
 * reads or writes Redis. These tests make that invariant explicit so a future
 * regression (someone wiring Redis into a candidate flow) fails loudly.
 *
 * The shared fixture's test app does NOT register the Redis plugin
 * (`fastify.redis === undefined`), so every candidate call below runs under
 * the "Redis absent" condition. We then assert PostgreSQL is the sole source
 * of truth by querying the attempt repo directly (bypassing the API).
 */
describe("P3-M7 redis fallback guard — candidate PG state with Redis absent", () => {
  let fixture: SharedAttemptFixture;

  beforeAll(async () => {
    fixture = await buildSharedAttemptFixture();
  });

  afterAll(async () => {
    await fixture.ctx.cleanup();
  });

  it("the test app runs with Redis absent (fastify.redis falsy)", () => {
    // Sanity: if a future change registers the redis plugin in the test app,
    // these guardrail tests would no longer exercise the Redis-absent path.
    // Fail loudly so a maintainer notices.
    expect(fixture.ctx.app.redis).toBeFalsy();
  });

  it("candidate start succeeds with Redis absent and PG holds the authoritative attempt", async () => {
    const { ctx, examId, candidateProfileId } = fixture;

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    expect(res.statusCode).toBe(201);
    const attempt = res.json();
    expect(attempt.status).toBe("in_progress");

    // PostgreSQL is the source of truth: query the repo directly (not the API)
    // and confirm the authoritative row matches what the API returned.
    const candidateCtx = {
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      role: "Candidate" as const,
      permissions: [],
      sessionId: "test",
    };
    const repoRow = await createAttemptRepo(ctx.db).findByExamAndCandidate(
      candidateCtx,
      examId,
      candidateProfileId,
    );
    expect(repoRow).toHaveLength(1);
    const row = repoRow[0];
    expect(row).toBeDefined();
    expect(row!.id).toBe(attempt.id);
    expect(row!.status).toBe("in_progress");
    expect(row!.candidateId).toBe(candidateProfileId);
  });

  it("candidate save + submit succeed with Redis absent; PG holds final status", async () => {
    const { ctx, examId, questionId, candidateProfileId } = fixture;

    // Start.
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const attemptId = startRes.json().id as string;

    // Save an answer (Redis absence must not block the PG-backed answer write).
    const saveRes = await ctx.app.inject({
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
    expect(saveRes.statusCode).toBe(200);

    // Submit (Redis absence must not block the PG-backed submit).
    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submitRes.statusCode).toBe(200);

    // PG is authoritative: the attempt status reflects the submitted terminal
    // state, read directly from the repo (not the API response).
    const candidateCtx = {
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      role: "Candidate" as const,
      permissions: [],
      sessionId: "test",
    };
    const rows = await createAttemptRepo(ctx.db).findByExamAndCandidate(
      candidateCtx,
      examId,
      candidateProfileId,
    );
    const submitted = rows.find((r) => r.id === attemptId);
    expect(submitted).toBeDefined();
    // After submit the attempt is no longer in_progress (submitted or graded).
    expect(submitted!.status).not.toBe("in_progress");
  });
});
