/**
 * Lazy deadline reconciliation (H-04 review): the submit's business effective
 * instant `submittedAt = D` and the interruption terminalization's observation
 * instant are distinct facts.
 *
 * `ensureAttemptDeadlineReconciled(..., now, resolution)` receives the request
 * capture / observation instant as `now`. When it reconciles an expired
 * DISRUPTED attempt, the `terminalized` event must record that observation
 * instant, not the effective deadline D — otherwise an episode detected after
 * D would end up with a `terminalized.occurredAt` earlier than its own
 * `detected.occurredAt`, inverting the episode's event order.
 *
 * Real PostgreSQL; time is injected explicitly (no sleeps).
 */
import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/schema/pg";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { createExamRepo } from "@exam/db/repository/examRepo";
import { createEnrollmentRepo } from "@exam/db/repository/enrollmentRepo";
import { createAttemptGradingEntryRepo } from "@exam/db/repository/attemptGradingEntryRepo";
import { createAttemptInterruptionRepo } from "@exam/db/repository/attemptInterruptionRepo";
import { createAttemptInterruptionEventRepo } from "@exam/db/repository/attemptInterruptionEventRepo";
import { executeInTransaction } from "@exam/db/types";
import {
  ensureAttemptDeadlineReconciled,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import { cleanupOrganizationTestData } from "@exam/db/testCleanup";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../../adapters/repoAdapters.js";
import {
  buildExamPayload,
  candidateRequestContext,
  createIsolatedAttemptOrg,
  disruptAttempt,
  type IsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";

const PREFIX = "deadline-terminalization-observed-test-";

describe("lazy deadline reconciliation — interruption terminalization time", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });
  });

  afterAll(async () => {
    await ctx.drainAuditWritesStrict();
    await cleanupStaleOrgs();
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.drainAuditWritesStrict();
    await cleanupStaleOrgs();
  });

  async function cleanupStaleOrgs(): Promise<void> {
    const stale = await ctx.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(like(schema.organizations.slug, `${PREFIX}%`));
    for (const org of stale) {
      await cleanupOrganizationTestData(ctx.db, org.id);
    }
  }

  async function createStartedAttempt(
    t: IsolatedAttemptOrg,
    title: string,
  ): Promise<string> {
    const exam = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title,
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
    return startRes.json().id as string;
  }

  it("freezes submittedAt at D while the terminalized event records the reconciliation observation instant", async () => {
    const t = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: PREFIX,
      label: "LT",
    });
    const attemptId = await createStartedAttempt(
      t,
      "Lazy Deadline Reconciliation Interruption Exam",
    );

    // Episode detected at t1, strictly AFTER the business deadline D — the
    // regression scenario: a deadline backdated terminalization would land
    // before the detected event.
    const effectiveDeadline = new Date(Date.now() - 120_000);
    const detectedAt = new Date(Date.now() - 60_000);
    await ctx.db
      .update(schema.examAttempts)
      .set({ deadlineAt: effectiveDeadline })
      .where(eq(schema.examAttempts.id, attemptId));
    await disruptAttempt(ctx.db, t.orgId, attemptId, {
      interruptedAt: detectedAt,
    });

    // The observation instant of this reconciliation pass, later than both D
    // and the detection instant.
    const observedAt = new Date(Date.now() + 30_000);
    const candidateCtx = candidateRequestContext(t);

    const reconciled = await executeInTransaction(ctx.db, async (tx) => {
      const { exams, enrollments, attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
          attemptRepo: createAttemptRepo(tx),
          enrollmentRepo: createEnrollmentRepo(tx),
        },
        candidateCtx,
      );
      const cap = await lockEnrollmentAndAttempt(
        enrollments,
        attempts,
        attemptId,
      );
      const episodeRepo = createInterruptionEpisodeRepoAdapter(
        createAttemptInterruptionRepo(tx),
        candidateCtx,
      );
      const eventRepo = createInterruptionEventRepoAdapter(
        createAttemptInterruptionEventRepo(tx),
        candidateCtx,
      );
      const resolution: SubmitInterruptionResolution = {
        mode: "active_interruption",
        episodeRepo,
        eventRepo,
        hint: {
          policy: "strict",
          eligibleSeconds: null,
          adjustmentId: null,
          reasonCode: "deadline_terminalization",
        },
      };
      return ensureAttemptDeadlineReconciled(
        exams,
        enrollments,
        attempts,
        createGradingWorksetRepoAdapter(
          createAttemptGradingEntryRepo(tx),
          candidateCtx,
        ),
        cap,
        observedAt,
        resolution,
      );
    });

    expect(reconciled.status).toBe("graded");
    expect(reconciled.submissionReason).toBe("deadline");
    // Business effective time: the deadline submission is D, not the
    // observation instant.
    expect(reconciled.submittedAt?.getTime()).toBe(effectiveDeadline.getTime());
    // Actual execution time of grading is the observation instant.
    expect(reconciled.gradedAt?.getTime()).toBe(observedAt.getTime());
    expect(reconciled.currentInterruptionId).toBeNull();
    expect(reconciled.interruptedAt).toBeNull();

    const events = await ctx.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(eq(schema.attemptInterruptionEvents.attemptId, attemptId));
    const detected = events.filter((e) => e.eventType === "detected");
    const terminalized = events.filter((e) => e.eventType === "terminalized");
    expect(detected).toHaveLength(1);
    expect(terminalized).toHaveLength(1);
    expect(detected[0]!.occurredAt.getTime()).toBe(detectedAt.getTime());
    expect(terminalized[0]!.occurredAt.getTime()).toBe(observedAt.getTime());
    expect(detected[0]!.occurredAt.getTime()).toBeLessThanOrEqual(
      terminalized[0]!.occurredAt.getTime(),
    );
    expect(terminalized[0]!.reasonCode).toBe("deadline_terminalization");
    expect(terminalized[0]!.detectionSource).toBeNull();
    expect(terminalized[0]!.observedLastActivityAt).toBeNull();
    expect(terminalized[0]!.interruptionId).toBe(detected[0]!.interruptionId);
    expect(terminalized[0]!.policy).toBe("strict");
  });
});
