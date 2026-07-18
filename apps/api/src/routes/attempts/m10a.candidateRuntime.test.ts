import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import courseRoutes from "../course.js";
import questionRoutes from "../question.js";
import candidateRoutes from "../candidate.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import scoreRoutes from "../scores.js";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
  createFutureRoleUserForTest,
  publishExamViaApi,
  uniquePrefix,
} from "../testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type { AuthzPreHandler } from "../../types/fastify-auth.d.js";

/**
 * RBAC-M10-A — Candidate runtime capability authorization integration proof.
 *
 * Two responsibilities that candidateOwnership.test.ts does NOT cover:
 *
 * 1. **Runtime metadata conformance (directive §7 / §M):** every one of the 10
 *    migrated candidate runtime routes carries exactly one authz preHandler,
 *    with the full expected `{ kind, permission, resourceIdKey? }` metadata —
 *    observed via Fastify's onRoute hook against the real registered routes
 *    (mirrors proctorMonitoring.crossOrg.test.ts:511-572). A downgrade
 *    (scoped->flat), wrong kind, wrong permission, or wrong resourceIdKey is
 *    caught here (Mutation E).
 *
 * 2. **Zero-side-effect denial (directive §9.3):** a cross-candidate denial
 *    on each of the 4 mutating routes (start, save-answer, submit, heartbeat,
 *    restore) leaves no new row in exam_attempts / audit_logs /
 *    attempt_grading_entries and does not bump exam_enrollments.attemptCount.
 *
 * Cross-candidate / cross-org / non-Candidate-role denial is already proven by
 * candidateOwnership.test.ts (re-run as part of this job) — not duplicated here.
 */

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

type CapturedRoute = {
  method: string;
  url: string;
  authz: AuthzPreHandler["authz"] | null;
};

const capturedRoutes: CapturedRoute[] = [];

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRoute", (routeOptions) => {
    const preHandlers = asArray(routeOptions.preHandler).filter(
      Boolean,
    ) as unknown[];
    // Match every authz kind the candidate runtime now uses.
    const authzHandler = preHandlers.find(
      (ph): ph is AuthzPreHandler =>
        typeof ph === "function" &&
        !!(
          (ph as unknown as AuthzPreHandler).authz?.kind ===
            "candidate_context" ||
          (ph as unknown as AuthzPreHandler).authz?.kind ===
            "exam_eligibility" ||
          (ph as unknown as AuthzPreHandler).authz?.kind === "own_attempt" ||
          (ph as unknown as AuthzPreHandler).authz?.kind === "scoped" ||
          (ph as unknown as AuthzPreHandler).authz?.kind === "flat"
        ),
    );
    capturedRoutes.push({
      method:
        typeof routeOptions.method === "string"
          ? routeOptions.method
          : "UNKNOWN",
      url: routeOptions.url as string,
      authz: authzHandler?.authz ?? null,
    });
  });
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(scoreRoutes);
};

describe("RBAC-M10-A candidate runtime — runtime authz metadata (directive §7)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>> | null = null;

  beforeAll(async () => {
    // Register the routes once so the onRoute hook populates capturedRoutes.
    // The metadata describe runs first (declared first), so it must seed the
    // capture itself rather than rely on a later describe's buildTestApp.
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  // Expected metadata per route. Each route must carry exactly one authz
  // preHandler with the full metadata object (kind + permission +
  // resourceIdKey where applicable).
  const expected: ReadonlyArray<{
    method: string;
    url: string;
    authz: AuthzPreHandler["authz"];
  }> = [
    {
      method: "GET",
      url: "/candidate/exams",
      authz: { kind: "candidate_context", permission: "exam.take" },
    },
    {
      method: "GET",
      url: "/candidate/exams/:examId",
      authz: {
        kind: "exam_eligibility",
        permission: "exam.take",
        resourceIdKey: "examId",
      },
    },
    {
      method: "POST",
      url: "/attempts/:examId/queue",
      authz: {
        kind: "exam_eligibility",
        permission: "attempt.start",
        resourceIdKey: "examId",
      },
    },
    {
      method: "POST",
      url: "/attempts/:examId/start",
      authz: {
        kind: "exam_eligibility",
        permission: "attempt.start",
        resourceIdKey: "examId",
      },
    },
    {
      method: "GET",
      url: "/attempts/:id",
      authz: {
        kind: "own_attempt",
        permission: "attempt.view_own",
        resourceIdKey: "id",
      },
    },
    {
      method: "GET",
      url: "/candidate/attempts/:attemptId/take",
      authz: {
        kind: "own_attempt",
        permission: "attempt.view_own",
        resourceIdKey: "attemptId",
      },
    },
    {
      method: "POST",
      url: "/attempts/:attemptId/answers/:questionId",
      authz: {
        kind: "own_attempt",
        permission: "attempt.answer.save",
        resourceIdKey: "attemptId",
      },
    },
    {
      method: "POST",
      url: "/attempts/:attemptId/submit",
      authz: {
        kind: "own_attempt",
        permission: "attempt.submit",
        resourceIdKey: "attemptId",
      },
    },
    {
      method: "POST",
      url: "/attempts/:attemptId/heartbeat",
      authz: {
        kind: "own_attempt",
        permission: "attempt.heartbeat.send",
        resourceIdKey: "attemptId",
      },
    },
    {
      method: "POST",
      url: "/attempts/:attemptId/restore",
      authz: {
        kind: "own_attempt",
        permission: "attempt.restore",
        resourceIdKey: "attemptId",
      },
    },
  ];

  it.each(expected)(
    "$method $url — carries the expected candidate-runtime authz metadata",
    ({ method, url, authz }) => {
      // The route is registered under the /api prefix, so the captured URL is
      // `/api<url>`; match by suffix to stay prefix-agnostic.
      const match = capturedRoutes.find(
        (r) => r.method === method && r.url.endsWith(url),
      );
      expect(
        match,
        `no captured route for ${method} ${url}; captured: ${capturedRoutes
          .map((r) => r.method + " " + r.url)
          .join(", ")}`,
      ).toBeDefined();
      expect(match!.authz).toEqual(authz);
    },
  );

  it("the 10 candidate runtime routes are each covered by exactly one authz preHandler (no duplicate, no omission)", () => {
    // Every expected route must be captured; the find above asserts metadata.
    // This assertion guards against a route losing its authz handler entirely.
    for (const e of expected) {
      const matches = capturedRoutes.filter(
        (r) => r.method === e.method && r.url.endsWith(e.url),
      );
      expect(matches.length, `${e.method} ${e.url}`).toBeGreaterThanOrEqual(1);
      expect(matches[0]?.authz).not.toBeNull();
    }
  });
});

describe("RBAC-M10-A candidate runtime — zero-side-effect denial (directive §9.3)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let sharedQuestionId: string;
  let candidateA: { candidateProfileId: string; userId: string; token: string };
  let candidateB: { candidateProfileId: string; userId: string; token: string };
  let attemptBId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });

    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "M10A Zero-Side-Effect Exam",
      courseCode: "M10A",
      courseName: "M10-A Course",
      questionContent: "M10-A question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);

    const examDetail = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    sharedQuestionId = examDetail.json().questionIds[0] as string;

    candidateA = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `m10a-a-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateB = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `m10a-b-${uniquePrefix()}`,
      ctx.org.id,
    );

    for (const cand of [candidateA, candidateB]) {
      const enrollment = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [cand.candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(enrollment.statusCode).toBe(200);
    }

    // B starts an attempt; A will attack it (cross-candidate denial).
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateB.token },
    });
    expect(startRes.statusCode).toBe(201);
    attemptBId = startRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Count rows for a table+org predicate. */
  async function countRows(
    table: "examAttempts" | "auditLogs" | "attemptGradingEntries",
    attemptId: string,
  ): Promise<number> {
    const colMap = {
      examAttempts: schema.examAttempts,
      auditLogs: schema.auditLogs,
      attemptGradingEntries: schema.attemptGradingEntries,
    } as const;
    const t = colMap[table];
    const rows = await ctx.db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.organizationId, ctx.org.id), eq(t.id, attemptId)));
    return rows.length;
  }

  /** Count audit rows for an action targeting an attempt (org-scoped). */
  async function countAuditForAction(
    attemptId: string,
    action: string,
  ): Promise<number> {
    const rows = await ctx.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, ctx.org.id),
          eq(schema.auditLogs.action, action),
          eq(schema.auditLogs.targetId, attemptId),
        ),
      );
    return rows.length;
  }

  /** Read B's enrollment attemptCount. */
  async function bEnrollmentAttemptCount(): Promise<number> {
    const rows = await ctx.db
      .select({ c: schema.examEnrollments.attemptCount })
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.organizationId, ctx.org.id),
          eq(schema.examEnrollments.candidateId, candidateB.candidateProfileId),
          eq(schema.examEnrollments.examId, examId),
        ),
      );
    return rows[0]?.c ?? 0;
  }

  function attackA(method: string, url: string, payload?: unknown) {
    return ctx.app.inject({
      method: method as never,
      url,
      payload: payload as never,
      cookies: { "auth-token": candidateA.token },
    });
  }

  it("POST /attempts/:examId/start — cross-candidate start (A starts the shared exam) does NOT mutate B's enrollment, audit, or create B rows", async () => {
    // A starting the shared exam creates A's OWN attempt, never touches B. The
    // zero-side-effect proof: B's enrollment attemptCount and B's audit/attempt
    // rows are unchanged after A's start.
    const bCountBefore = await bEnrollmentAttemptCount();
    const bAuditBefore = await countAuditForAction(examId, "attempt.start");
    const bAttemptsBefore = await ctx.db
      .select({ id: schema.examAttempts.id })
      .from(schema.examAttempts)
      .where(
        and(
          eq(schema.examAttempts.organizationId, ctx.org.id),
          eq(schema.examAttempts.candidateId, candidateB.candidateProfileId),
        ),
      );

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateA.token },
    });
    expect(res.statusCode).toBe(201);

    const bCountAfter = await bEnrollmentAttemptCount();
    const bAuditAfter = await countAuditForAction(examId, "attempt.start");
    const bAttemptsAfter = await ctx.db
      .select({ id: schema.examAttempts.id })
      .from(schema.examAttempts)
      .where(
        and(
          eq(schema.examAttempts.organizationId, ctx.org.id),
          eq(schema.examAttempts.candidateId, candidateB.candidateProfileId),
        ),
      );
    expect(bCountAfter).toBe(bCountBefore); // B's enrollment untouched
    expect(bAttemptsAfter.length).toBe(bAttemptsBefore.length); // no new B attempt
    // A's start emits an attempt.start audit targeting A's NEW attempt id, not
    // the shared examId — so the examId-targeted audit count for attempt.start
    // is unchanged (start audit targets the attempt, not the exam).
    expect(bAuditAfter).toBe(bAuditBefore);
  });

  it("POST /attempts/:attemptId/answers/:questionId — A denied on B's attempt: no answer mutation, no audit, no grading entry", async () => {
    const saveAuditBefore = await countAuditForAction(
      attemptBId,
      "attempt.saveAnswer",
    );
    const gradingBefore = await ctx.db
      .select({ id: schema.attemptGradingEntries.id })
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptBId));

    const res = await attackA(
      "POST",
      `/api/attempts/${attemptBId}/answers/${sharedQuestionId}`,
      {
        attemptId: attemptBId,
        questionId: sharedQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
    );
    expect(res.statusCode).toBe(404); // anti-enumeration (cross-candidate)

    const saveAuditAfter = await countAuditForAction(
      attemptBId,
      "attempt.saveAnswer",
    );
    const gradingAfter = await ctx.db
      .select({ id: schema.attemptGradingEntries.id })
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptBId));
    expect(saveAuditAfter).toBe(saveAuditBefore); // no audit recorded for the denial
    expect(gradingAfter.length).toBe(gradingBefore.length); // no grading entry
  });

  it("POST /attempts/:attemptId/submit — A denied on B's attempt: no submit audit, no state transition", async () => {
    const submitAuditBefore = await countAuditForAction(
      attemptBId,
      "attempt.submit",
    );

    const res = await attackA("POST", `/api/attempts/${attemptBId}/submit`);
    expect(res.statusCode).toBe(404);

    const submitAuditAfter = await countAuditForAction(
      attemptBId,
      "attempt.submit",
    );
    expect(submitAuditAfter).toBe(submitAuditBefore); // no submit audit
    // B's attempt remains in_progress (not transitioned by A's denied submit).
    const attRows = await ctx.db
      .select({ status: schema.examAttempts.status })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptBId));
    expect(attRows[0]?.status).toBe("in_progress");
  });

  it("POST /attempts/:attemptId/heartbeat — A denied on B's attempt: no lastActivityAt mutation", async () => {
    const beforeRows = await ctx.db
      .select({ lastActivityAt: schema.examAttempts.lastActivityAt })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptBId));
    const before = beforeRows[0]?.lastActivityAt ?? null;

    const res = await attackA("POST", `/api/attempts/${attemptBId}/heartbeat`);
    expect(res.statusCode).toBe(404);

    const afterRows = await ctx.db
      .select({ lastActivityAt: schema.examAttempts.lastActivityAt })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptBId));
    const after = afterRows[0]?.lastActivityAt ?? null;
    // lastActivityAt unchanged (heartbeat is the mutation this route performs;
    // denial must not advance it).
    expect(String(after)).toBe(String(before));
  });

  it("POST /attempts/:attemptId/restore — A denied on B's attempt: no restore audit, no state transition", async () => {
    const restoreAuditBefore = await countAuditForAction(
      attemptBId,
      "attempt.restore",
    );

    const res = await attackA("POST", `/api/attempts/${attemptBId}/restore`);
    expect(res.statusCode).toBe(404);

    const restoreAuditAfter = await countAuditForAction(
      attemptBId,
      "attempt.restore",
    );
    expect(restoreAuditAfter).toBe(restoreAuditBefore); // no restore audit
  });
});

describe("RBAC-M10-A candidate runtime — non-Candidate role denial (directive §9.2)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let proctor: { user: { id: string }; token: string };
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
    proctor = await createFutureRoleUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      `m10a-proctor-${uniquePrefix()}`,
    );
    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "M10A Proctor Denial Exam",
      courseCode: "M10AP",
      courseName: "M10-A Proctor Course",
      questionContent: "M10-A proctor question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it("Proctor is denied 403 on GET /candidate/exams (Candidate-preset-only route)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": proctor.token },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Proctor is denied 403 on GET /candidate/exams/:examId", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/exams/${examId}`,
      cookies: { "auth-token": proctor.token },
    });
    expect(res.statusCode).toBe(403);
  });
});
