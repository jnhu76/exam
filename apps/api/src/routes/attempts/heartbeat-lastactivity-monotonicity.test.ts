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
 * R-04 (#961) — `lastActivityAt` monotonicity under a late-committed older
 * heartbeat (targeted PostgreSQL evidence for the heartbeat/scanner boundary).
 *
 * The heartbeat route stamps `lastActivityAt` with its ADR-006 captured
 * instant via the atomic status-qualified write
 * (`attemptRepo.refreshLastActivityIfInProgress`). Two heartbeats can commit
 * out of capture order (H1 captured T0, stalls, then commits after H2 which
 * captured T1 > T0). A plain `SET last_activity_at = :now` lets the late H1
 * MOVE THE FACT BACKWARD, which the heartbeat scanner's staleness decision
 * (`markDisrupted`: `tickNow - lastActivityAt >= timeout`) reads as real
 * inactivity — a live client can be disrupted into an interruption episode.
 *
 * This test IS the targeted experiment: it drives the exact repo seam twice
 * with out-of-order captured instants against real PostgreSQL and pins that
 * the stored activity fact is monotone non-decreasing (high-water mark of
 * captured instants). It also doubles as the clock-step boundary: a backward
 * host-clock step between two heartbeats cannot regress the fact either.
 */
describe("heartbeat lastActivityAt monotonicity (R-04)", () => {
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

  async function createStartedAttempt(
    examTitle: string,
  ): Promise<IsolatedAttemptOrg & { attemptId: string }> {
    const t = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: "hb-monotonic-test-",
      label: "HM",
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
    return { ...t, attemptId: startRes.json().id as string };
  }

  async function readLastActivityAt(attemptId: string): Promise<Date | null> {
    const rows = await ctx.db
      .select({ lastActivityAt: schema.examAttempts.lastActivityAt })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    return rows[0]?.lastActivityAt ?? null;
  }

  it("a late-committed OLDER heartbeat must not move lastActivityAt backward", async () => {
    const t = await createStartedAttempt("Heartbeat Monotonicity Exam");
    const repo = createAttemptRepo(ctx.db);
    const ctx0 = candidateRequestContext(t);

    // Fix the baseline activity fact at T1 (the start route already stamped a
    // real-clock value; replace it through a direct fixture write so the
    // observed value is exact).
    const T1 = new Date(Date.now() - 60_000);
    await ctx.db
      .update(schema.examAttempts)
      .set({ lastActivityAt: T1 })
      .where(eq(schema.examAttempts.id, t.attemptId));
    expect((await readLastActivityAt(t.attemptId))?.getTime()).toBe(
      T1.getTime(),
    );

    // Older heartbeat (captured T0 < T1) — the delayed request — commits
    // afterward. The stored activity fact must keep the high-water mark.
    const T0 = new Date(T1.getTime() - 45_000);
    const older = await repo.refreshLastActivityIfInProgress(
      ctx0,
      t.attemptId,
      T0,
    );
    expect(older).not.toBeNull();
    expect((await readLastActivityAt(t.attemptId))?.getTime()).toBe(
      T1.getTime(),
    );

    // A heartbeat captured LATER than the high-water mark still advances it.
    const T2 = new Date(Date.now());
    const newer2 = await repo.refreshLastActivityIfInProgress(
      ctx0,
      t.attemptId,
      T2,
    );
    expect(newer2).not.toBeNull();
    expect((await readLastActivityAt(t.attemptId))?.getTime()).toBe(
      T2.getTime(),
    );
  });
});
