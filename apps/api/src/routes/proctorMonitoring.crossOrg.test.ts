import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  createCandidateViaApi,
  createExamViaApi,
  createFutureRoleUserForTest,
} from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createClientEventRepo } from "@exam/db/src/repository/clientEventRepo.js";

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(proctorMonitoringRoutes);
};

describe("Proctor scoped routes — cross-org isolation", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  let orgBId: string;
  let orgBExamId: string;
  let orgBCandidateProfileId: string;
  let orgBAttemptId: string;
  let orgBCandidateToken: string;
  let orgBAdminToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });

    orgBId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: orgBId,
      name: "Org B",
      displayName: "Organization B",
      slug: `org-b-${randomUUID().slice(0, 8)}`,
    });

    const orgBAdmin = await createOrgBAdmin(ctx.db, orgBId);
    orgBAdminToken = orgBAdmin.token;

    await ctx.db.insert(schema.courses).values({
      id: randomUUID(),
      organizationId: orgBId,
      name: "Org B Course",
      code: `orgb-course-${randomUUID().slice(0, 8)}`,
      description: "",
    });

    orgBExamId = await createExamViaApi(ctx.app, orgBAdminToken, {
      examTitle: "Org B Exam",
      courseCode: `orgb-exam-${randomUUID().slice(0, 8)}`,
      courseName: "Org B Exam Course",
      questionContent: "Org B question",
      questionAnswer: true,
      questionScore: 10,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await ctx.db
      .update(schema.exams)
      .set({ status: "published" })
      .where(eq(schema.exams.id, orgBExamId));

    const orgBCand = await createCandidateViaApi(
      ctx.app,
      orgBAdminToken,
      `orgb-cand-${randomUUID().slice(0, 8)}`,
      orgBId,
    );
    orgBCandidateProfileId = orgBCand.candidateProfileId;
    orgBCandidateToken = orgBCand.token;

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${orgBExamId}/enrollments`,
      payload: { candidateIds: [orgBCandidateProfileId] },
      cookies: { "auth-token": orgBAdminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${orgBExamId}/start`,
      cookies: { "auth-token": orgBCandidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    orgBAttemptId = startRes.json().id;

    await createClientEventRepo(ctx.db).createMany(
      {
        actorId: orgBCand.userId,
        organizationId: orgBId,
        role: "Candidate",
        permissions: [],
        sessionId: "sess-b",
      },
      [
        {
          userId: orgBCand.userId,
          attemptId: orgBAttemptId,
          examId: orgBExamId,
          questionId: null,
          kind: "exam_telemetry",
          level: "info",
          name: "initial_connect",
          route: null,
          occurredAt: new Date(),
          receivedAt: new Date(),
          clientSessionId: "sess-b-1",
          metadata: {},
          userAgent: null,
        },
      ],
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("same-org positive controls", () => {
    it("GET /admin/exams/:examId/proctor/attempts — same-org Admin succeeds", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${orgBExamId}/proctor/attempts`,
        cookies: { "auth-token": orgBAdminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /admin/attempts/:attemptId/proctor-events — same-org Admin succeeds", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${orgBAttemptId}/proctor-events?limit=20`,
        cookies: { "auth-token": orgBAdminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("POST /admin/attempts/:attemptId/proctor-incident — same-org Admin succeeds, audit written", async () => {
      const auditBefore = await countAuditForAction(
        ctx.db,
        orgBAttemptId,
        "proctor.incident_marked",
        orgBId,
      );
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${orgBAttemptId}/proctor-incident`,
        payload: {
          incidentType: "manual_note_added",
          examId: orgBExamId,
          candidateId: orgBCandidateProfileId,
          attemptId: orgBAttemptId,
          reasonCode: "attention_lost",
          note: "Same-org test",
        },
        cookies: { "auth-token": orgBAdminToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      const auditAfter = await countAuditForAction(
        ctx.db,
        orgBAttemptId,
        "proctor.incident_marked",
        orgBId,
      );
      expect(auditAfter).toBe(auditBefore + 1);
    });
  });

  describe("cross-org isolation — Org A Proctor → Org B resources", () => {
    let proctorAToken: string;

    beforeAll(async () => {
      const proctorA = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "proctor-a-cross",
      );
      proctorAToken = proctorA.token;
    });

    it("GET /admin/exams/:examId/proctor/attempts — cross-org 404 (MUTATION B KILL POINT)", async () => {
      // Resolver findAuthorizationChain filters by org → Org B exam not found
      // in Org A scope → 404. If gate is reverted to flat requireCapability,
      // the handler returns 200 (empty items list) instead — 404 vs 200 proves
      // the resolver is active and necessary.
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${orgBExamId}/proctor/attempts`,
        cookies: { "auth-token": proctorAToken },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("GET /admin/attempts/:attemptId/proctor-events — cross-org 404, anti-enumeration", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${orgBAttemptId}/proctor-events?limit=20`,
        cookies: { "auth-token": proctorAToken },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("POST /admin/attempts/:attemptId/proctor-incident — cross-org 404, zero write", async () => {
      // J4-I1B (ADR-015 §13): the legacy marker is Admin-only (grant removed
      // from the Proctor preset). The cross-org isolation is proven with an
      // Org A ADMIN token: the scoped resolver rejects the Org B attempt with
      // 404 before the handler runs. A Proctor is denied at the capability
      // gate (403) regardless of org — asserted separately.
      const auditBefore = await countAuditForAction(
        ctx.db,
        orgBAttemptId,
        "proctor.incident_marked",
        orgBId,
      );
      const clientEventsBefore = await countClientEventsForAttempt(
        ctx,
        orgBAttemptId,
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${orgBAttemptId}/proctor-incident`,
        payload: {
          incidentType: "manual_note_added",
          examId: orgBExamId,
          candidateId: orgBCandidateProfileId,
          attemptId: orgBAttemptId,
          reasonCode: "attention_lost",
          note: "Cross-org attempt",
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");

      const auditAfter = await countAuditForAction(
        ctx.db,
        orgBAttemptId,
        "proctor.incident_marked",
        orgBId,
      );
      const clientEventsAfter = await countClientEventsForAttempt(
        ctx,
        orgBAttemptId,
      );
      expect(auditAfter).toBe(auditBefore);
      expect(clientEventsAfter).toBe(clientEventsBefore);
    });
  });

  // Broken parent chain and resolver error are covered by unit tests in:
  // - src/authz/scopedCapability.test.ts (denial mapping)
  // - src/authz/resolvers/attemptResolver.test.ts (broken chain, org mismatch)
});

// Route-registry presence, sensitive flags, and the exact scoped authz
// metadata (kind/permission/resolverKey/resourceIdKey/proctorAccess) for
// these routes are owned by the frozen authz conformance suites:
// routeRegistryConformance (registry<->runtime equality),
// routeRegistryConformanceWholeApp (surface totals), and
// proctorAccessConformance (assignment_scoped runtime wiring).

async function createOrgBAdmin(
  db: Awaited<ReturnType<typeof buildTestApp>>["db"],
  orgId: string,
): Promise<{ token: string }> {
  // RBAC-M10-E: delegate to createAssignedUserForTest so the user gets an
  // active primary Admin assignment scoped to orgId — without it, the
  // cross-org admin token gets 401 AUTH_REQUIRED instead of exercising the
  // cross-org isolation under test.
  const { token } = await createAssignedUserForTest(
    db,
    orgId,
    "Admin",
    "orgb-admin",
  );
  return { token };
}

async function countAuditForAction(
  db: Awaited<ReturnType<typeof buildTestApp>>["db"],
  attemptId: string,
  action: string,
  orgId: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.organizationId, orgId),
        eq(schema.auditLogs.action, action),
        eq(schema.auditLogs.targetId, attemptId),
      ),
    );
  return rows.length;
}

async function countClientEventsForAttempt(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  attemptId: string,
): Promise<number> {
  const rows = await ctx.db
    .select({ id: schema.clientEvents.id })
    .from(schema.clientEvents)
    .where(eq(schema.clientEvents.attemptId, attemptId));
  return rows.length;
}
