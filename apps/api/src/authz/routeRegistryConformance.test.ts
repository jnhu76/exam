/**
 * RBAC-M10-A registry/runtime conformance test (Corrective B, P1-3).
 *
 * The authority chain is:
 *   route registry declaration
 *   ↔
 *   actual Fastify onRoute metadata
 *
 * For each of the ten M10-A routes, this test:
 *   1. reads the route registry entry (including runtimeAuthz);
 *   2. finds the corresponding captured route from the Fastify onRoute hook;
 *   3. asserts exactly one authz preHandler (via authzCount);
 *   4. compares the runtime metadata against the registry's runtimeAuthz + permission.
 *
 * The expected object is NOT duplicated inside the test — it IS the registry
 * declaration. This prevents the hard-coded-expected-table ↔ hard-coded-runtime
 * pattern that the independent review flagged as drift-prone.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import {
  ROUTE_PERMISSION_REGISTRY,
  type CandidateRuntimeAuthzStrategy,
} from "./routeRegistry.js";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import candidateRoutes from "../routes/candidate.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";
import scoreRoutes from "../routes/scores.js";
import { exportRoutes } from "../routes/export.js";
import { buildTestApp } from "../routes/testHelpers.js";

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function isAuthzPreHandler(ph: unknown): ph is AuthzPreHandler {
  return (
    typeof ph === "function" &&
    !!(
      (ph as unknown as AuthzPreHandler).authz?.kind === "candidate_context" ||
      (ph as unknown as AuthzPreHandler).authz?.kind === "exam_eligibility" ||
      (ph as unknown as AuthzPreHandler).authz?.kind === "own_attempt" ||
      (ph as unknown as AuthzPreHandler).authz?.kind === "scoped" ||
      (ph as unknown as AuthzPreHandler).authz?.kind === "flat"
    )
  );
}

type CapturedRoute = {
  method: string;
  url: string;
  authzHandlers: readonly AuthzPreHandler["authz"][];
  authzCount: number;
};

const capturedRoutes: CapturedRoute[] = [];

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRoute", (routeOptions) => {
    const preHandlers = asArray(routeOptions.preHandler).filter(Boolean);
    const authzHandlers = preHandlers.filter(isAuthzPreHandler);
    capturedRoutes.push({
      method:
        typeof routeOptions.method === "string"
          ? routeOptions.method
          : "UNKNOWN",
      url: routeOptions.url as string,
      authzHandlers: authzHandlers.map((h) => h.authz),
      authzCount: authzHandlers.length,
    });
  });
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(scoreRoutes);
  await fastify.register(exportRoutes);
};

describe("RBAC-M10-A registry/runtime conformance (Corrective B)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>> | null = null;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  // Select the ten M10-A candidate runtime routes from the registry.
  const m10aRegistryEntries = ROUTE_PERMISSION_REGISTRY.filter(
    (e) => e.runtimeAuthz !== undefined,
  );

  it("exactly ten M10-A routes have runtimeAuthz in the registry", () => {
    expect(m10aRegistryEntries).toHaveLength(10);
  });

  /**
   * Build the expected runtime metadata from the registry entry.
   * The registry's runtimeAuthz + permission is the authority — no
   * separate expected table is duplicated in the test.
   */
  function expectedMetadata(
    entry: (typeof m10aRegistryEntries)[number],
  ): AuthzPreHandler["authz"] {
    const strategy = entry.runtimeAuthz!;
    switch (strategy.kind) {
      case "candidate_context":
        return { kind: "candidate_context", permission: entry.permission };
      case "exam_eligibility":
        return {
          kind: "exam_eligibility",
          permission: entry.permission,
          resourceIdKey: strategy.resourceIdKey,
          eligibilityDenialMode: strategy.eligibilityDenialMode,
        };
      case "own_attempt":
        return {
          kind: "own_attempt",
          permission: entry.permission,
          resourceIdKey: strategy.resourceIdKey,
        };
    }
  }

  it.each(m10aRegistryEntries)(
    "$method $path — runtime metadata matches registry declaration",
    (entry) => {
      const matches = capturedRoutes.filter(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(
        matches,
        `no captured route for ${entry.method} ${entry.path}`,
      ).toHaveLength(1);
      expect(matches[0]!.authzCount).toBe(1);
      expect(matches[0]!.authzHandlers).toHaveLength(1);
      expect(matches[0]!.authzHandlers[0]).toEqual(expectedMetadata(entry));
    },
  );

  it("each M10-A route has exactly one authz preHandler", () => {
    for (const entry of m10aRegistryEntries) {
      const matches = capturedRoutes.filter(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]!.authzCount).toBe(1);
      expect(matches[0]!.authzHandlers).toHaveLength(1);
    }
  });

  it("candidate_context routes have no resolver/resourceIdKey in runtime metadata", () => {
    const contextEntries = m10aRegistryEntries.filter(
      (e) => e.runtimeAuthz?.kind === "candidate_context",
    );
    for (const entry of contextEntries) {
      const matches = capturedRoutes.filter(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(matches).toHaveLength(1);
      const meta = matches[0]!.authzHandlers[0];
      expect(meta).toBeDefined();
      expect(meta!.kind).toBe("candidate_context");
      expect(meta).not.toHaveProperty("resolverKey");
      expect(meta).not.toHaveProperty("resourceIdKey");
    }
  });

  it("exam_eligibility routes always have resourceIdKey: examId", () => {
    const eligibilityEntries = m10aRegistryEntries.filter(
      (e) => e.runtimeAuthz?.kind === "exam_eligibility",
    );
    expect(eligibilityEntries).toHaveLength(3);
    for (const entry of eligibilityEntries) {
      const strategy = entry.runtimeAuthz! as Extract<
        CandidateRuntimeAuthzStrategy,
        { kind: "exam_eligibility" }
      >;
      expect(strategy.resourceIdKey).toBe("examId");
      const matches = capturedRoutes.filter(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]!.authzHandlers[0]).toEqual(
        expect.objectContaining({ resourceIdKey: "examId" }),
      );
    }
  });

  it("own_attempt routes always have resourceIdKey: id or attemptId", () => {
    const ownAttemptEntries = m10aRegistryEntries.filter(
      (e) => e.runtimeAuthz?.kind === "own_attempt",
    );
    expect(ownAttemptEntries).toHaveLength(6);
    for (const entry of ownAttemptEntries) {
      const strategy = entry.runtimeAuthz! as Extract<
        CandidateRuntimeAuthzStrategy,
        { kind: "own_attempt" }
      >;
      expect(["id", "attemptId"]).toContain(strategy.resourceIdKey);
      const matches = capturedRoutes.filter(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]!.authzHandlers[0]).toEqual(
        expect.objectContaining({ resourceIdKey: strategy.resourceIdKey }),
      );
    }
  });

  // ──────────────────────── M10-B conformance ────────────────────────

  /**
   * M10-B: 28 admin/management routes using capability-based gates (kind "flat").
   *
   * INVENTORY SPLIT:
   *   Category A — 21 pre-existing flat-capability routes (not modified by M10-B).
   *   Category B — 7 routes migrated from requireRole(["Admin"]) to requireCapability.
   *
   * MIGRATION CLOSURE:
   *   The 7 migrated routes used capabilities granted only to Admin in the
   *   current permission presets. The migration does not widen the effective
   *   access matrix.
   *
   * RESOURCE-SCOPE ENFORCEMENT:
   *   NOT IMPLEMENTED BY M10-B.
   *
   *   The application is single-tenant, so cross-tenant authorization is not
   *   required. However, single-tenancy does not eliminate resource-level
   *   assignment requirements. The current repository has no authoritative
   *   Teacher/Course, Teacher/Exam, Proctor/Exam, or Grader/Work assignment
   *   data model. Resource-scope authorization is therefore deferred to a
   *   separate resource-relationship authorization milestone.
   *
   *   The registry fields `scope`, `resolver`, `resource`, and `migrationStage`
   *   are PLANNED metadata for future resource-scope enforcement — they are
   *   NOT consumed at runtime by the current "flat" capability preHandler.
   *
   * ensureTargetOrg:
   *   - enforces the current organization data context;
   *   - does not prove Teacher-to-course assignment;
   *   - does not prove Teacher-to-exam assignment;
   *   - does not prove Proctor-to-exam assignment;
   *   - does not prove Grader-to-work assignment.
   *
   * CURRENT IMPLEMENTED MODEL:
   *   - authentication
   *   - flat capability preset
   *   - single-organization data context
   *   - handler/service existence checks
   *   - handler/service state invariants
   *
   * NOT IMPLEMENTED:
   *   - Teacher resource assignment
   *   - Proctor resource assignment
   *   - Grader resource assignment
   *   - general resource-scope resolver execution
   *
   * This conformance test verifies structural correctness of the capability
   * gate declarations. It does NOT prove resource-level authorization closure.
   */
  const m10bRouteSpecs: Array<{
    method: string;
    path: string;
    permission: string;
  }> = [
    // 6 admin attempt routes
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/misconduct",
      permission: "attempt.misconduct.mark",
    },
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/force-submit",
      permission: "attempt.force_submit",
    },
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/extend-time",
      permission: "attempt.time.extend",
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/timeline",
      permission: "attempt.timeline.view",
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/export",
      permission: "attempt.export",
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/export/csv",
      permission: "attempt.export",
    },
    // 3 question routes
    { method: "GET", path: "/questions/:id", permission: "question.view" },
    { method: "PATCH", path: "/questions/:id", permission: "question.update" },
    { method: "DELETE", path: "/questions/:id", permission: "question.delete" },
    // 14 exam routes
    { method: "GET", path: "/exams/:id", permission: "exam.view" },
    { method: "PATCH", path: "/exams/:id", permission: "exam.update" },
    { method: "POST", path: "/exams/:id/publish", permission: "exam.publish" },
    { method: "POST", path: "/exams/:id/close", permission: "exam.close" },
    {
      method: "POST",
      path: "/exams/:id/publish-results",
      permission: "exam.result.publish",
    },
    {
      method: "GET",
      path: "/exams/:examId/enrollments",
      permission: "exam.enrollment.manage",
    },
    {
      method: "POST",
      path: "/exams/:examId/enrollments",
      permission: "exam.enrollment.manage",
    },
    {
      method: "DELETE",
      path: "/exams/:examId/enrollments/:enrollmentId",
      permission: "exam.enrollment.manage",
    },
    {
      method: "GET",
      path: "/admin/exams/:examId/candidates/status",
      permission: "exam.enrollment.manage",
    },
    {
      method: "POST",
      path: "/exams/:id/unpublish",
      permission: "exam.unpublish",
    },
    { method: "POST", path: "/exams/:id/extend", permission: "exam.extend" },
    { method: "POST", path: "/exams/:id/cancel", permission: "exam.cancel" },
    { method: "POST", path: "/exams/:id/archive", permission: "exam.archive" },
    { method: "DELETE", path: "/exams/:id", permission: "exam.delete" },
    // 3 course routes
    { method: "GET", path: "/courses/:id", permission: "course.view" },
    { method: "PATCH", path: "/courses/:id", permission: "course.update" },
    { method: "DELETE", path: "/courses/:id", permission: "course.delete" },
    // 1 score list route
    { method: "GET", path: "/exams/:id/scores", permission: "score.all.view" },
    // 1 score export route
    {
      method: "GET",
      path: "/exams/:id/export/scores",
      permission: "score.export",
    },
  ];

  it("has exactly 28 M10-B routes defined", () => {
    expect(m10bRouteSpecs).toHaveLength(28);
  });

  it.each(m10bRouteSpecs)(
    "[M10-B] $method $path — uses flat capability gate with correct permission",
    ({ method, path, permission }) => {
      const matches = capturedRoutes.filter(
        (r) => r.method === method && r.url.endsWith(path),
      );
      expect(matches, `no captured route for ${method} ${path}`).toHaveLength(
        1,
      );
      expect(matches[0]!.authzCount).toBe(1);
      expect(matches[0]!.authzHandlers).toHaveLength(1);
      expect(matches[0]!.authzHandlers[0]).toEqual({
        kind: "flat",
        permission,
      });
    },
  );

  it("no M10-B route uses requireRole gate (all use capability)", () => {
    for (const { method, path } of m10bRouteSpecs) {
      const matches = capturedRoutes.filter(
        (r) => r.method === method && r.url.endsWith(path),
      );
      expect(matches).toHaveLength(1);
      const meta = matches[0]!.authzHandlers[0];
      expect(meta).toBeDefined();
      expect(meta!.kind).toBe("flat");
    }
  });
});
