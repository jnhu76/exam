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
import { Permission } from "@exam/authz";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import candidateRoutes from "../routes/candidate.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";
import scoreRoutes from "../routes/scores.js";
import { exportRoutes } from "../routes/export.js";
import userRoutes from "../routes/user.js";
import roleAssignmentRoutes from "../routes/roleAssignments.js";
import candidateFieldRoutes from "../routes/candidateField.js";
import settingsRoutes from "../routes/settings.js";
import systemRoutes from "../routes/system.js";
import importLogRoutes from "../routes/importLogs.js";
import { emailRoutes } from "../routes/email.js";
import auditRoutes from "../routes/audit.js";
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

/**
 * Test-only classification of a single preHandler function into one of:
 *   - "authentication": the authenticate gate (tagged `_isAuthenticate`).
 *   - "role": a legacy `requireRole` gate (tagged `_isRequireRole`).
 *   - "permission_list": a legacy `requirePermission` gate (tagged
 *     `_isRequirePermission`).
 *   - "flat": a `requireCapability` gate (authz.kind === "flat").
 *   - "scoped": a `requireScopedCapability` / candidate-runtime gate
 *     (authz.kind in scoped/candidate_context/exam_eligibility/own_attempt).
 *   - "other": anything else (e.g. tenant guard, zod validation).
 *
 * RBAC-M10-B PR190 REVIEW CORRECTIVE 1, Finding 2: the prior capture pipeline
 * filtered preHandlers through `isAuthzPreHandler` only, which excluded
 * `requireRole` handlers (they carry no `.authz` metadata). A route containing
 * BOTH `requireRole(["Admin"])` AND `requireCapability(perm)` would therefore
 * appear to have exactly one capability handler and pass the assertion
 * vacuously. This classification closes that hole by tagging role /
 * permission-list handlers at the decorator (mirroring the existing
 * `_isAuthenticate` tag), so the conformance test can assert `roleHandlers`
 * is exactly zero on every M10-B route.
 *
 * This is production-neutral: the decorators still make the same runtime
 * authorization decisions. The tags are introspection-only.
 */
type PreHandlerKind =
  | "authentication"
  | "role"
  | "permission_list"
  | "flat"
  | "scoped"
  | "other";

interface ClassifiedPreHandler {
  kind: PreHandlerKind;
  /** For "flat"/"scoped" kinds: the authz metadata. Otherwise null. */
  authz: AuthzPreHandler["authz"] | null;
  /** For "role" kind: the allowed-roles list. Otherwise null. */
  allowedRoles: readonly string[] | null;
}

function classifyPreHandler(ph: unknown): ClassifiedPreHandler {
  if (typeof ph !== "function") {
    return { kind: "other", authz: null, allowedRoles: null };
  }
  const tag = ph as unknown as Record<string, unknown>;
  if (tag._isAuthenticate === true) {
    return { kind: "authentication", authz: null, allowedRoles: null };
  }
  if (tag._isRequireRole === true) {
    const roles = Array.isArray(tag._allowedRoles)
      ? (tag._allowedRoles as readonly string[])
      : [];
    return { kind: "role", authz: null, allowedRoles: roles };
  }
  if (tag._isRequirePermission === true) {
    return { kind: "permission_list", authz: null, allowedRoles: null };
  }
  if (isAuthzPreHandler(ph)) {
    const meta = (ph as unknown as AuthzPreHandler).authz;
    if (meta.kind === "flat") {
      return { kind: "flat", authz: meta, allowedRoles: null };
    }
    return { kind: "scoped", authz: meta, allowedRoles: null };
  }
  return { kind: "other", authz: null, allowedRoles: null };
}

type CapturedRoute = {
  method: string;
  url: string;
  authzHandlers: readonly AuthzPreHandler["authz"][];
  authzCount: number;
  /** Full preHandler classification, including role / permission gates. */
  classified: readonly ClassifiedPreHandler[];
  roleHandlerCount: number;
  permissionListHandlerCount: number;
  flatCapabilityHandlerCount: number;
  scopedCapabilityHandlerCount: number;
};

const capturedRoutes: CapturedRoute[] = [];

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRoute", (routeOptions) => {
    const preHandlers = asArray(routeOptions.preHandler).filter(Boolean);
    const classified = preHandlers.map((ph) => classifyPreHandler(ph));
    const authzHandlers = classified
      .filter((c) => c.authz !== null)
      .map((c) => c.authz) as AuthzPreHandler["authz"][];
    capturedRoutes.push({
      method:
        typeof routeOptions.method === "string"
          ? routeOptions.method
          : "UNKNOWN",
      url: routeOptions.url as string,
      authzHandlers,
      authzCount: authzHandlers.length,
      classified,
      roleHandlerCount: classified.filter((c) => c.kind === "role").length,
      permissionListHandlerCount: classified.filter(
        (c) => c.kind === "permission_list",
      ).length,
      flatCapabilityHandlerCount: classified.filter((c) => c.kind === "flat")
        .length,
      scopedCapabilityHandlerCount: classified.filter(
        (c) => c.kind === "scoped",
      ).length,
    });
  });
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(scoreRoutes);
  await fastify.register(exportRoutes);
  // M10-C: identity + role-assignment surface. Registered WITHOUT a per-plugin
  // prefix — the routes themselves declare their full paths (/users, /roles,
  // /role-assignments, /users/:id/...). The buildTestApp /api prefix applies.
  await fastify.register(userRoutes);
  await fastify.register(roleAssignmentRoutes);
  await fastify.register(candidateFieldRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(systemRoutes);
  await fastify.register(importLogRoutes);
  await fastify.register(emailRoutes);
  await fastify.register(auditRoutes);
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
    // 3 admin attempt routes that REMAIN flat after J4-I1B:
    //   - POST /admin/attempts/:attemptId/misconduct,
    //   - POST /admin/attempts/:attemptId/force-submit,
    //   - GET  /admin/attempts/:attemptId/timeline
    // were flipped to requireScopedCapability by J4-I1B (ADR-015 §8) and are
    // asserted in the scoped-grant block below — NOT here.
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

  it("has exactly 24 M10-B routes defined", () => {
    expect(m10bRouteSpecs).toHaveLength(24);
  });

  /**
   * Per-route M10-B conformance (RBAC-M10-B PR190 REVIEW CORRECTIVE 1,
   * Finding 2). For each of the 28 routes we prove:
   *
   *   - exactly one matching route registration exists;
   *   - exactly one flat-capability handler is wired;
   *   - the flat capability carries the expected permission;
   *   - zero scoped-capability handlers are wired;
   *   - zero legacy role handlers are wired;
   *   - zero legacy permission-list handlers are wired.
   *
   * The role / permission-list assertions use the `_isRequireRole` /
   * `_isRequirePermission` introspection tags applied at the decorators. The
   * prior implementation only filtered through `isAuthzPreHandler`, which
   * silently excluded role handlers and made the assertion vacuous for any
   * route that carried BOTH a role gate and a capability gate. The tag-based
   * classification closes that hole.
   */
  it.each(m10bRouteSpecs)(
    "[M10-B] $method $path — flat capability gate, no role/permission gate",
    ({ method, path, permission }) => {
      const matches = capturedRoutes.filter(
        (r) => r.method === method && r.url.endsWith(path),
      );
      expect(matches, `no captured route for ${method} ${path}`).toHaveLength(
        1,
      );
      const route = matches[0]!;
      // Flat-capability gate: exactly one, with the right permission.
      expect(
        route.flatCapabilityHandlerCount,
        `${method} ${path} flat count`,
      ).toBe(1);
      expect(route.authzHandlers).toHaveLength(1);
      expect(route.authzHandlers[0]).toEqual({ kind: "flat", permission });
      // No scoped / candidate-runtime gates.
      expect(
        route.scopedCapabilityHandlerCount,
        `${method} ${path} scoped count`,
      ).toBe(0);
      // No legacy role gate — the M10-B migration removed these.
      expect(route.roleHandlerCount, `${method} ${path} role gate count`).toBe(
        0,
      );
      // No legacy permission-list gate either.
      expect(
        route.permissionListHandlerCount,
        `${method} ${path} permission-list gate count`,
      ).toBe(0);
    },
  );

  // ──────────────────────── Scoped-grant conformance ────────────────────────

  /**
   * The operator time-grant route is resource-aware: it resolves the target
   * Attempt scope before the handler runs (ADR-013 / ADR-010 §3.9). This is
   * the M10-B superset — a scoped gate that first checks the Admin preset,
   * then resolves the Attempt's organization + parent chain and fail-closes
   * (404 / 403 / 503). The route registry declares scope: Attempt / resolver:
   * "attempt"; this proves the live preHandler matches.
   */
  it("[scoped] POST /admin/attempts/:attemptId/time-grants — scoped Attempt resolver gate", () => {
    const matches = capturedRoutes.filter(
      (r) =>
        r.method === "POST" &&
        r.url.endsWith("/admin/attempts/:attemptId/time-grants"),
    );
    expect(matches).toHaveLength(1);
    const route = matches[0]!;
    expect(route.scopedCapabilityHandlerCount, "time-grants scoped count").toBe(
      1,
    );
    expect(route.flatCapabilityHandlerCount, "time-grants flat count").toBe(0);
    expect(route.roleHandlerCount).toBe(0);
    expect(route.permissionListHandlerCount).toBe(0);
    expect(route.authzHandlers[0]).toEqual({
      kind: "scoped",
      permission: "attempt.time.grant",
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
    });
  });

  // ──────────────────── J4-I1B flipped attempt gates ────────────────────

  /**
   * J4-I1B (ADR-015 §8): misconduct / force-submit were flipped from flat to
   * `requireScopedCapability` — they stay scoped for target existence, tenant,
   * and parent-chain validation even though their grants are REMOVED from the
   * Proctor preset (proctorAccess = admin_only). timeline additionally carries
   * the Proctor-assignment enforcement (proctorAccess = assignment_scoped).
   */
  it.each([
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
  ])(
    "[J4-I1B] $method $path — scoped Attempt resolver gate, no Proctor assignment enforcement (admin_only)",
    ({ method, path, permission }) => {
      const matches = capturedRoutes.filter(
        (r) => r.method === method && r.url.endsWith(path),
      );
      expect(matches, `no captured route for ${method} ${path}`).toHaveLength(
        1,
      );
      const route = matches[0]!;
      expect(route.scopedCapabilityHandlerCount).toBe(1);
      expect(route.flatCapabilityHandlerCount).toBe(0);
      expect(route.roleHandlerCount).toBe(0);
      expect(route.permissionListHandlerCount).toBe(0);
      expect(route.authzHandlers[0]).toEqual({
        kind: "scoped",
        permission,
        resolverKey: "attempt",
        resourceIdKey: "attemptId",
      });
    },
  );

  it("[J4-I1B] GET /admin/attempts/:attemptId/timeline — scoped Attempt resolver gate WITH Proctor assignment enforcement", () => {
    const matches = capturedRoutes.filter(
      (r) =>
        r.method === "GET" &&
        r.url.endsWith("/admin/attempts/:attemptId/timeline"),
    );
    expect(matches).toHaveLength(1);
    const route = matches[0]!;
    expect(route.scopedCapabilityHandlerCount).toBe(1);
    expect(route.flatCapabilityHandlerCount).toBe(0);
    expect(route.roleHandlerCount).toBe(0);
    expect(route.permissionListHandlerCount).toBe(0);
    expect(route.authzHandlers[0]).toEqual({
      kind: "scoped",
      permission: "attempt.timeline.view",
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      proctorAccess: "assignment_scoped",
    });
  });

  // ──────────────────────── M10-C conformance ────────────────────────

  /**
   * M10-C: identity & role-assignment authority. 10 admin routes using
   * capability-based gates (kind "flat"), migrated from legacy
   * requireRole(["Admin"]).
   *
   * INVENTORY SPLIT:
   *   - user.ts: 5 routes (GET /users, POST /users, PATCH /users/:id,
   *     POST /users/:id/reset-password, DELETE /users/:id)
   *   - roleAssignments.ts: 5 routes (GET /roles/assignable,
   *     GET /users/:id/role-assignments, POST /users/:id/role-assignments,
   *     PATCH /role-assignments/:assignmentId,
   *     DELETE /role-assignments/:assignmentId)
   *
   * TARGET PERMISSIONS:
   *   UserView, UserCreate, UserUpdate, UserPasswordReset, UserDelete,
   *   UserRoleAssign. All six are Admin-only across every role preset
   *   (Teacher/Proctor/Grader/Candidate/System), so the migration is
   *   access-matrix-neutral (zero effective expansion, zero Admin regression).
   *
   * RUNTIME AUTHORITY BOUNDARY:
   *   - users.role remains the de facto runtime authorization source.
   *   - user_role_assignments remains assignment-management data only.
   *   - syncUsersRoleFromPrimary is preserved on every primary-active
   *     assignment mutation path (POST/PATCH/DELETE in roleAssignments.ts;
   *     PATCH role-change in user.ts).
   *   - M10-C does NOT begin M10-E (assignment-backed runtime authority).
   *
   * RESOURCE-SCOPE ENFORCEMENT: NOT IMPLEMENTED BY M10-C. Same single-tenant
   * boundary as M10-B. The registry's scope/resolver/migrationStage fields
   * remain planned metadata; they are not consumed at runtime by the flat
   * capability preHandler. Org-anchor isolation continues to be enforced
   * via ensureTargetOrg in the route handlers.
   */
  const m10cRouteSpecs: Array<{
    method: string;
    path: string;
    permission: string;
  }> = [
    // 5 user.ts routes (migrationStage 6)
    { method: "GET", path: "/users", permission: "user.view" },
    { method: "POST", path: "/users", permission: "user.create" },
    { method: "PATCH", path: "/users/:id", permission: "user.update" },
    {
      method: "POST",
      path: "/users/:id/reset-password",
      permission: "user.password.reset",
    },
    { method: "DELETE", path: "/users/:id", permission: "user.delete" },
    // 5 roleAssignments.ts routes (migrationStage 8)
    {
      method: "GET",
      path: "/roles/assignable",
      permission: "user.role.assign",
    },
    {
      method: "GET",
      path: "/users/:id/role-assignments",
      permission: "user.view",
    },
    {
      method: "POST",
      path: "/users/:id/role-assignments",
      permission: "user.role.assign",
    },
    {
      method: "PATCH",
      path: "/role-assignments/:assignmentId",
      permission: "user.role.assign",
    },
    {
      method: "DELETE",
      path: "/role-assignments/:assignmentId",
      permission: "user.role.assign",
    },
  ];

  it("has exactly 10 M10-C routes defined", () => {
    expect(m10cRouteSpecs).toHaveLength(10);
  });

  /**
   * Per-route M10-C conformance. For each of the 10 routes we prove:
   *
   *   - exactly one matching route registration exists;
   *   - exactly one flat-capability handler is wired;
   *   - the flat capability carries the expected permission;
   *   - zero scoped-capability handlers are wired;
   *   - zero legacy role handlers are wired (the M10-C migration removed these);
   *   - zero legacy permission-list handlers are wired.
   *
   * Same non-vacuity discipline as M10-B: the role / permission-list
   * assertions rely on the `_isRequireRole` / `_isRequirePermission`
   * introspection tags attached at the decorators, and the negative-control
   * test below proves the classifier actually detects role gates.
   */
  it.each(m10cRouteSpecs)(
    "[M10-C] $method $path — flat capability gate, no role/permission gate",
    ({ method, path, permission }) => {
      const matches = capturedRoutes.filter(
        (r) => r.method === method && r.url.endsWith(path),
      );
      expect(matches, `no captured route for ${method} ${path}`).toHaveLength(
        1,
      );
      const route = matches[0]!;
      expect(
        route.flatCapabilityHandlerCount,
        `${method} ${path} flat count`,
      ).toBe(1);
      expect(route.authzHandlers).toHaveLength(1);
      expect(route.authzHandlers[0]).toEqual({ kind: "flat", permission });
      expect(
        route.scopedCapabilityHandlerCount,
        `${method} ${path} scoped count`,
      ).toBe(0);
      expect(route.roleHandlerCount, `${method} ${path} role gate count`).toBe(
        0,
      );
      expect(
        route.permissionListHandlerCount,
        `${method} ${path} permission-list gate count`,
      ).toBe(0);
    },
  );

  /**
   * Negative control (Finding 2 §5.4). Proves the tag-based classification
   * actually detects a role gate. Without this, the corrected assertion above
   * could still be vacuous — for example if the tag were never set or the
   * classifier silently ignored it.
   *
   * Registers a SYNTHETIC test-only route whose preHandler chain contains
   * BOTH `authenticate` AND `requireRole(["Admin"])` AND
   * `requireCapability(Permission.ExamView)`. The capture pipeline must report
   * exactly one role handler and exactly one flat-capability handler. This
   * synthetic route is NOT part of the 28-route production inventory.
   */
  it("negative control — capture detects a role gate on a synthetic route", async () => {
    const syntheticCaptured: CapturedRoute[] = [];
    const syntheticPlugin: FastifyPluginAsync = async (fastify) => {
      fastify.addHook("onRoute", (routeOptions) => {
        const preHandlers = asArray(routeOptions.preHandler).filter(Boolean);
        const classified = preHandlers.map((ph) => classifyPreHandler(ph));
        const authzHandlers = classified
          .filter((c) => c.authz !== null)
          .map((c) => c.authz) as AuthzPreHandler["authz"][];
        syntheticCaptured.push({
          method:
            typeof routeOptions.method === "string"
              ? routeOptions.method
              : "UNKNOWN",
          url: routeOptions.url as string,
          authzHandlers,
          authzCount: authzHandlers.length,
          classified,
          roleHandlerCount: classified.filter((c) => c.kind === "role").length,
          permissionListHandlerCount: classified.filter(
            (c) => c.kind === "permission_list",
          ).length,
          flatCapabilityHandlerCount: classified.filter(
            (c) => c.kind === "flat",
          ).length,
          scopedCapabilityHandlerCount: classified.filter(
            (c) => c.kind === "scoped",
          ).length,
        });
      });
      // Synthetic route: a deliberately mixed chain the production inventory
      // must NEVER contain on an M10-B route. The auth plugins come from
      // buildTestApp (same production decorators that attach the
      // `_isRequireRole` / `_isRequirePermission` / `_isAuthenticate` tags).
      fastify.get(
        "/synthetic-negative-control",
        {
          preHandler: [
            fastify.authenticate,
            fastify.requireRole(["Admin"]),
            fastify.requireCapability(Permission.ExamView),
          ],
        },
        // Handler is never invoked — the route exists only so onRoute fires
        // and the preHandler chain is captured.
        async () => "ok",
      );
    };

    const syntheticCtx = await buildTestApp(syntheticPlugin, {
      prefix: "/api",
    });
    await syntheticCtx.cleanup();

    expect(syntheticCaptured.length).toBeGreaterThanOrEqual(1);
    // Find the synthetic GET route explicitly — Fastify may also auto-register
    // a HEAD route for GET handlers, which is irrelevant to this control.
    const synthetic = syntheticCaptured.find(
      (r) =>
        r.method === "GET" && r.url.endsWith("/synthetic-negative-control"),
    );
    expect(
      synthetic,
      "synthetic negative-control route must be captured",
    ).toBeDefined();
    // The classifier MUST see the role gate. If it returns 0 here, the M10-B
    // assertion above is vacuous.
    expect(synthetic!.roleHandlerCount).toBe(1);
    expect(synthetic!.flatCapabilityHandlerCount).toBe(1);
    expect(synthetic!.permissionListHandlerCount).toBe(0);
    expect(synthetic!.scopedCapabilityHandlerCount).toBe(0);
    // The role handler's allowed-roles list is recoverable.
    const roleHandler = synthetic!.classified.find((c) => c.kind === "role");
    expect(roleHandler).toBeDefined();
    expect(roleHandler!.allowedRoles).toEqual(["Admin"]);
  });

  // ──────────────────────── M10-D conformance ────────────────────────

  /**
   * M10-D route identity allowlist: 17 organization/system administrative
   * surface routes. These are the routes that M10-D migrates from legacy
   * requireRole(["Admin"]) to flat requireCapability(permission).
   *
   * The allowlist contains method + path only — permission is read from
   * ROUTE_PERMISSION_REGISTRY, NOT duplicated here. This ensures registry
   * drift is detectable: if the registry's permission changes but the
   * runtime gate stays the same, this test fails.
   */
  const M10_D_ROUTE_KEYS = new Set([
    "GET /candidate-fields",
    "POST /candidate-fields",
    "PATCH /candidate-fields/:id",
    "DELETE /candidate-fields/:id",
    "GET /candidate-fields/template",
    "GET /admin/settings",
    "GET /admin/settings/branding",
    "PATCH /admin/settings/branding",
    "GET /system/health",
    "GET /system/dashboard",
    "GET /system/diagnostics",
    "GET /admin/import-logs",
    "POST /email/test",
    "GET /admin/audit-logs",
    "POST /candidates",
    "PATCH /candidates/:id",
    "POST /candidates/import",
  ]);

  /**
   * Select the 17 M10-D entries from ROUTE_PERMISSION_REGISTRY.
   * Permission values come from the registry — never hard-coded in the test.
   */
  const m10dRegistryEntries = ROUTE_PERMISSION_REGISTRY.filter((e) =>
    M10_D_ROUTE_KEYS.has(`${e.method} ${e.path}`),
  );

  it("M10-D route key allowlist has exactly 17 entries", () => {
    expect(M10_D_ROUTE_KEYS.size).toBe(17);
  });

  it("ROUTE_PERMISSION_REGISTRY contains exactly 17 matching M10-D entries", () => {
    expect(m10dRegistryEntries).toHaveLength(17);
  });

  it("no M10-D key matches more than one registry entry", () => {
    const keyCounts = new Map<string, number>();
    for (const e of m10dRegistryEntries) {
      const key = `${e.method} ${e.path}`;
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of keyCounts) {
      expect(count, `${key} appears ${count} times in registry`).toBe(1);
    }
  });

  it.each(m10dRegistryEntries)(
    "[M10-D] $method $path — flat capability gate, no role/permission gate",
    (entry) => {
      const matches = capturedRoutes.filter(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(
        matches,
        `no captured route for ${entry.method} ${entry.path}`,
      ).toHaveLength(1);
      const route = matches[0]!;
      expect(
        route.flatCapabilityHandlerCount,
        `${entry.method} ${entry.path} flat count`,
      ).toBe(1);
      expect(route.authzHandlers).toHaveLength(1);
      expect(route.authzHandlers[0]).toEqual({
        kind: "flat",
        permission: entry.permission,
      });
      expect(
        route.scopedCapabilityHandlerCount,
        `${entry.method} ${entry.path} scoped count`,
      ).toBe(0);
      expect(
        route.roleHandlerCount,
        `${entry.method} ${entry.path} role gate count`,
      ).toBe(0);
      expect(
        route.permissionListHandlerCount,
        `${entry.method} ${entry.path} permission-list gate count`,
      ).toBe(0);
    },
  );
});
