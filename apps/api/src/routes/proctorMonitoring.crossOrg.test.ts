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
import {
  ROUTE_PERMISSION_REGISTRY,
  registryKeyFor,
} from "../authz/routeRegistry.js";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";

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
    const authzHandler = preHandlers.find(
      (ph): ph is AuthzPreHandler =>
        typeof ph === "function" &&
        ((ph as unknown as AuthzPreHandler).authz?.kind === "scoped" ||
          (ph as unknown as AuthzPreHandler).authz?.kind === "flat"),
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
  await fastify.register(proctorMonitoringRoutes);
};

/**
 * Runtime/registry conformance: the cross-org tests below prove that the
 * scoped capability gate is active and necessary (Mutation B is killed when
 * the gate is reverted to flat requireCapability). This test verifies that the
 * route registry entries exist for the three Proctor scoped routes — the
 * registry is the documented target state and the cross-org tests are the
 * runtime observation. Together they satisfy the "no tautological" requirement.
 */
describe("Proctor route registry conformance", () => {
  const expectedRoutes = [
    "GET /admin/exams/:examId/proctor/attempts",
    "GET /admin/attempts/:attemptId/proctor-events",
    "POST /admin/attempts/:attemptId/proctor-incident",
  ] as const;

  it.each(expectedRoutes)("registry entry exists for %s", (routePath) => {
    const [method, ...pathParts] = routePath.split(" ");
    const path = pathParts.join(" ");
    const key = `${method} ${path}`;
    const entry = ROUTE_PERMISSION_REGISTRY.find(
      (e) => registryKeyFor(e) === key,
    );
    expect(entry, `registry entry for ${key} not found`).toBeDefined();
    expect(entry!.sensitive).toBe(true);
  });
});

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

  describe("role rejection matrix (real HTTP + DB)", () => {
    let orgAProctorToken: string;
    let orgATeacherToken: string;
    let orgAGraderToken: string;
    let orgAExamId: string;
    let orgAAttemptId: string;
    let _routes: Array<{
      method: "GET" | "POST";
      url: string;
      payload?: unknown;
    }>;

    beforeAll(async () => {
      // Create Org A resources for same-org positive tests.
      const orgACourseId = randomUUID();
      await ctx.db.insert(schema.courses).values({
        id: orgACourseId,
        organizationId: ctx.org.id,
        name: "Matrix Course",
        code: `matrix-${randomUUID().slice(0, 8)}`,
        description: "",
      });
      orgAExamId = randomUUID();
      await ctx.db.insert(schema.exams).values({
        id: orgAExamId,
        organizationId: ctx.org.id,
        title: "Matrix Exam",
        description: "",
        courseId: orgACourseId,
        status: "published",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(),
        closeAt: new Date(Date.now() + 86400000),
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: [],
        questionSnapshot: [],
        controlFlags: {
          shuffleQuestions: false,
          shuffleOptions: false,
          detectTabSwitch: false,
          disableCopyPaste: false,
          requireQueue: false,
          batchSize: 10,
          batchInterval: 3,
          restrictIp: false,
          requireLockdown: false,
          showResultImmediately: false,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 1,
      });
      const now = new Date();
      const enrollmentId = randomUUID();
      const candidateProfileId = randomUUID();
      await ctx.db.insert(schema.candidateProfiles).values({
        id: candidateProfileId,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
      });
      await ctx.db.insert(schema.examEnrollments).values({
        id: enrollmentId,
        organizationId: ctx.org.id,
        examId: orgAExamId,
        candidateId: candidateProfileId,
        status: "active",
        attemptCount: 0,
      });
      orgAAttemptId = randomUUID();
      await ctx.db.insert(schema.examAttempts).values({
        id: orgAAttemptId,
        organizationId: ctx.org.id,
        examId: orgAExamId,
        enrollmentId,
        candidateId: candidateProfileId,
        attemptNo: 1,
        status: "in_progress",
        questionSnapshot: [],
        answers: [],
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const proctor = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "proctor-a-matrix",
      );
      orgAProctorToken = proctor.token;
      // J4-I1B (ADR-015 §8): an assigned Proctor passes the scoped monitoring
      // reads. Assign this Proctor to the Org A exam so the capability
      // verdict matrix exercises the 200 path (not the 404 assignment miss).
      await ctx.db.insert(schema.examProctorAssignments).values({
        id: randomUUID(),
        organizationId: ctx.org.id,
        examId: orgAExamId,
        proctorUserId: proctor.user.id,
        status: "active",
        assignedBy: ctx.admin.id,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const teacher = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Teacher",
        "teacher-a-matrix",
      );
      orgATeacherToken = teacher.token;
      const grader = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Grader",
        "grader-a-matrix",
      );
      orgAGraderToken = grader.token;

      _routes = [
        {
          method: "GET",
          url: `/api/admin/exams/${orgAExamId}/proctor/attempts`,
        },
        {
          method: "GET",
          url: `/api/admin/attempts/${orgAAttemptId}/proctor-events?limit=20`,
        },
        // J4-I1B (ADR-015 §13): the legacy proctor-incident marker is
        // Admin-only (grant removed from the Proctor preset) — it is asserted
        // separately below, not in the passed/denied monitoring matrix.
      ];
    });

    it.each([
      ["Admin", "passed"],
      ["Proctor", "passed"],
      ["Teacher", "denied"],
      ["Grader", "denied"],
      ["Candidate", "denied"],
    ] as const)(
      "%s receives the expected proctor capability verdict",
      async (role, expected) => {
        const tokenMap: Record<string, string> = {
          Admin: ctx.adminToken,
          Proctor: orgAProctorToken,
          Teacher: orgATeacherToken,
          Grader: orgAGraderToken,
          Candidate: ctx.candidateToken,
        };
        const token = tokenMap[role];
        for (const { method, url, payload } of _routes) {
          const res = await ctx.app.inject({
            method,
            url,
            payload,
            cookies: { "auth-token": token },
          });
          const isDenied = res.statusCode === 403;
          const isPassed = res.statusCode === 200;
          if (expected === "passed") {
            expect(
              isPassed,
              `${method} ${url} — ${role} expected passed, got ${res.statusCode}`,
            ).toBe(true);
          } else {
            expect(
              isDenied,
              `${method} ${url} — ${role} expected denied, got ${res.statusCode}`,
            ).toBe(true);
          }
        }
      },
    );

    // J4-I1B (ADR-015 §13): the legacy proctor-incident marker is Admin-only —
    // an ASSIGNED Proctor is denied (grant removed), Admin still passes.
    it("Proctor is denied the legacy proctor-incident marker; Admin passes (scoped)", async () => {
      const proctorRes = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${orgAAttemptId}/proctor-incident`,
        payload: { incidentType: "manual_note_added", examId: orgAExamId },
        cookies: { "auth-token": orgAProctorToken },
      });
      expect(proctorRes.statusCode).toBe(403);

      const adminRes = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${orgAAttemptId}/proctor-incident`,
        payload: { incidentType: "manual_note_added", examId: orgAExamId },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(adminRes.statusCode).toBe(200);
    });

    it("unauthenticated → 401", async () => {
      for (const { method, url, payload } of _routes) {
        const res = await ctx.app.inject({ method, url, payload });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
      }
    });
  });

  // Broken parent chain and resolver error are covered by unit tests in:
  // - src/authz/scopedCapability.test.ts (denial mapping)
  // - src/authz/resolvers/attemptResolver.test.ts (broken chain, org mismatch)
});

describe("Proctor route authz metadata introspection (Finding 2 proof)", () => {
  /**
   * Proves that Routes 2 and 3 have runtime `requireScopedCapability` wired
   * (not just `requireCapability`). The cross-org HTTP test can only prove
   * Mutation B for Route 1 (behavioral status diff 404 → 200). Routes 2 and 3
   * are behaviorally indistinguishable because both scoped and flat gates are
   * followed by handler-level 404 checks — so we observe the preHandler's own
   * `authz.kind` property at runtime via Fastify's `onRoute` hook.
   *
   * MUST run after the cross-org describe block: its buildTestApp populates
   * the module-level capturedRoutes array via the onRoute hook.
   *
   * This closes RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-2 Finding 2.
   */

  const threeProctorRoutes = [
    {
      method: "GET",
      urlPart: "proctor/attempts",
      expected: {
        kind: "scoped" as const,
        permission: "exam_room.view",
        resolverKey: "exam",
        resourceIdKey: "examId",
        // J4-I1B (ADR-015 §8): Proctor assignment enforcement wired.
        proctorAccess: "assignment_scoped" as const,
      },
    },
    {
      method: "GET",
      urlPart: "proctor-events",
      expected: {
        kind: "scoped" as const,
        permission: "attempt.timeline.view",
        resolverKey: "attempt",
        resourceIdKey: "attemptId",
        // J4-I1B (ADR-015 §8): Proctor assignment enforcement wired.
        proctorAccess: "assignment_scoped" as const,
      },
    },
    {
      method: "POST",
      urlPart: "proctor-incident",
      expected: {
        kind: "scoped" as const,
        permission: "attempt.misconduct.mark",
        resolverKey: "attempt",
        resourceIdKey: "attemptId",
      },
    },
  ] as const;

  it.each(threeProctorRoutes)(
    "$method ...$urlPart — full scoped authz metadata",
    ({ method, urlPart, expected }) => {
      const match = capturedRoutes.find(
        (r) => r.url.includes(urlPart) && r.method === method,
      );
      expect(
        match,
        `no captured route for ${method} ${urlPart}; captured: ${capturedRoutes.map((r) => r.method + " " + r.url).join(", ")}`,
      ).toBeDefined();
      expect(match!.authz).toEqual(expected);
    },
  );
});

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
