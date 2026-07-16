import { describe, it, expect } from "vitest";
import {
  ROUTE_PERMISSION_REGISTRY,
  registryKeyFor,
  type RoutePermissionRegistryEntry,
} from "./routeRegistry.js";
import { Permission, Scope } from "@exam/authz";

describe("RBAC-M4 route permission registry — shape & invariants", () => {
  it("exports a non-empty registry", () => {
    expect(ROUTE_PERMISSION_REGISTRY.length).toBeGreaterThan(0);
  });

  it("every entry has a method, path, current legacy gate, permission, scope, and resolver", () => {
    for (const e of ROUTE_PERMISSION_REGISTRY) {
      expect(["GET", "POST", "PATCH", "DELETE", "PUT"]).toContain(e.method);
      expect(typeof e.path).toBe("string");
      expect(e.path.startsWith("/")).toBe(true);
      expect(typeof e.currentGate).toBe("string");
      expect(typeof e.permission).toBe("string");
      expect(typeof e.scope).toBe("string");
      expect(typeof e.resolver).toBe("string");
    }
  });

  it("every entry's permission and scope are known catalog values", () => {
    const perms = new Set<string>(Object.values(Permission));
    const scopes = new Set<string>(Object.values(Scope));
    for (const e of ROUTE_PERMISSION_REGISTRY) {
      expect(perms.has(e.permission), `unknown perm ${e.permission}`).toBe(
        true,
      );
      expect(scopes.has(e.scope), `unknown scope ${e.scope}`).toBe(true);
    }
  });

  it("registry keys (method+path) are unique", () => {
    const keys = ROUTE_PERMISSION_REGISTRY.map((e) => registryKeyFor(e));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("RBAC-M4 route permission registry — ADR §8 special mappings", () => {
  const find = (method: string, path: string) =>
    ROUTE_PERMISSION_REGISTRY.find(
      (e) => e.method === method && e.path === path,
    );

  it("force-submit -> attempt.force_submit @ attempt scope (state-guarded)", () => {
    const e = find("POST", "/admin/attempts/:attemptId/force-submit");
    expect(e?.permission).toBe("attempt.force_submit");
    expect(e?.scope).toBe("attempt");
    expect(e?.sensitive).toBe(true);
    expect(e?.auditAction).toBe("attempt.forceSubmit");
  });

  it("extend-time -> attempt.time.extend @ attempt scope", () => {
    const e = find("POST", "/admin/attempts/:attemptId/extend-time");
    expect(e?.permission).toBe("attempt.time.extend");
    expect(e?.auditAction).toBe("attempt.extendTime");
  });

  it("misconduct -> attempt.misconduct.mark @ attempt scope", () => {
    const e = find("POST", "/admin/attempts/:attemptId/misconduct");
    expect(e?.permission).toBe("attempt.misconduct.mark");
    expect(e?.auditAction).toBe("attempt.misconductFlagged");
  });

  it("grading-details -> grading.detail.view (sensitive read, audit grading.detail_viewed)", () => {
    const e = find("GET", "/admin/attempts/:attemptId/grading-details");
    expect(e?.permission).toBe("grading.detail.view");
    expect(e?.sensitive).toBe(true);
    expect(e?.auditAction).toBe("grading.detail_viewed");
  });

  it("grade-question -> grading.score.write @ attempt scope", () => {
    const e = find("POST", "/admin/attempts/:attemptId/grade-question");
    expect(e?.permission).toBe("grading.score.write");
    expect(e?.auditAction).toBe("grading.score_entered");
  });

  it("candidate own score -> score.own.view @ own_score scope", () => {
    const e = find("GET", "/scores/attempts/:attemptId");
    expect(e?.permission).toBe("score.own.view");
    expect(e?.scope).toBe("own_score");
  });

  // P4-1 §G drift closures — the three routes added to complete coverage.
  it("candidate-fields template -> candidate_field.view @ organization scope", () => {
    const e = find("GET", "/candidate-fields/template");
    expect(e?.permission).toBe("candidate_field.view");
    expect(e?.scope).toBe("organization");
    expect(e?.currentGate).toBe("Admin");
  });

  it("candidate take snapshot -> attempt.view_own @ own_attempt scope", () => {
    const e = find("GET", "/candidate/attempts/:attemptId/take");
    expect(e?.permission).toBe("attempt.view_own");
    expect(e?.scope).toBe("own_attempt");
    expect(e?.currentGate).toBe("Candidate");
  });

  it("proctor incident -> attempt.misconduct.mark @ attempt scope (already capability-gated)", () => {
    const e = find("POST", "/admin/attempts/:attemptId/proctor-incident");
    expect(e?.permission).toBe("attempt.misconduct.mark");
    expect(e?.scope).toBe("attempt");
    expect(e?.auditAction).toBe("attempt.misconductFlagged");
    expect(e?.sensitive).toBe(true);
  });
});

describe("RBAC-M4 route permission registry — coverage of protected routes", () => {
  // Ground truth: every route currently gated by requireRole(["Admin"|"Candidate"])
  // (non-test) in apps/api/src/routes. If a route is protected but absent from the
  // registry, enforcement jobs would have no contract for it — this is the
  // RBAC-M4 coverage acceptance test.
  const PROTECTED_ROUTES: ReadonlyArray<{
    method: string;
    path: string;
  }> = [
    { method: "POST", path: "/email/test" },
    { method: "GET", path: "/candidate/exams" },
    { method: "GET", path: "/candidate/exams/:examId" },
    { method: "POST", path: "/attempts/:examId/queue" },
    { method: "POST", path: "/attempts/:examId/start" },
    { method: "GET", path: "/attempts/:id" },
    { method: "POST", path: "/attempts/:attemptId/answers/:questionId" },
    { method: "POST", path: "/attempts/:attemptId/submit" },
    { method: "POST", path: "/attempts/:attemptId/heartbeat" },
    { method: "POST", path: "/attempts/:attemptId/restore" },
    { method: "GET", path: "/questions" },
    { method: "GET", path: "/questions/:id" },
    { method: "POST", path: "/questions" },
    { method: "PATCH", path: "/questions/:id" },
    { method: "DELETE", path: "/questions/:id" },
    { method: "POST", path: "/questions/import" },
    { method: "GET", path: "/candidates" },
    { method: "POST", path: "/candidates" },
    { method: "PATCH", path: "/candidates/:id" },
    { method: "POST", path: "/candidates/import" },
    { method: "GET", path: "/exams/:id/scores" },
    { method: "GET", path: "/scores/attempts/:attemptId" },
    { method: "POST", path: "/admin/attempts/:attemptId/misconduct" },
    { method: "POST", path: "/admin/attempts/:attemptId/force-submit" },
    { method: "POST", path: "/admin/attempts/:attemptId/extend-time" },
    { method: "GET", path: "/admin/attempts/:attemptId/timeline" },
    { method: "GET", path: "/admin/attempts/:attemptId/export" },
    { method: "GET", path: "/admin/attempts/:attemptId/export/csv" },
    { method: "GET", path: "/admin/exams/:examId/proctor/attempts" },
    { method: "GET", path: "/admin/attempts/:attemptId/proctor-events" },
    { method: "GET", path: "/admin/grading-queue" },
    { method: "GET", path: "/admin/attempts/:attemptId/grading-details" },
    { method: "POST", path: "/admin/attempts/:attemptId/grade-question" },
    { method: "GET", path: "/users" },
    { method: "POST", path: "/users" },
    { method: "PATCH", path: "/users/:id" },
    { method: "POST", path: "/users/:id/reset-password" },
    { method: "DELETE", path: "/users/:id" },
    { method: "GET", path: "/exams/:id/export/scores" },
    { method: "GET", path: "/courses" },
    { method: "GET", path: "/courses/:id" },
    { method: "POST", path: "/courses" },
    { method: "PATCH", path: "/courses/:id" },
    { method: "DELETE", path: "/courses/:id" },
    { method: "GET", path: "/admin/import-logs" },
    { method: "GET", path: "/admin/settings" },
    { method: "GET", path: "/admin/settings/branding" },
    { method: "PATCH", path: "/admin/settings/branding" },
    { method: "GET", path: "/admin/audit-logs" },
    { method: "GET", path: "/system/health" },
    { method: "GET", path: "/system/dashboard" },
    { method: "GET", path: "/system/diagnostics" },
    { method: "GET", path: "/exams" },
    { method: "GET", path: "/exams/:id" },
    { method: "POST", path: "/exams" },
    { method: "PATCH", path: "/exams/:id" },
    { method: "POST", path: "/exams/:id/publish" },
    { method: "POST", path: "/exams/:id/close" },
    { method: "POST", path: "/exams/:id/unpublish" },
    { method: "POST", path: "/exams/:id/extend" },
    { method: "POST", path: "/exams/:id/cancel" },
    { method: "POST", path: "/exams/:id/archive" },
    { method: "POST", path: "/exams/:id/publish-results" },
    { method: "DELETE", path: "/exams/:id" },
    { method: "GET", path: "/exams/:examId/enrollments" },
    { method: "POST", path: "/exams/:examId/enrollments" },
    { method: "DELETE", path: "/exams/:examId/enrollments/:enrollmentId" },
    { method: "GET", path: "/admin/exams/:examId/candidates/status" },
    { method: "GET", path: "/candidate-fields" },
    { method: "POST", path: "/candidate-fields" },
    { method: "PATCH", path: "/candidate-fields/:id" },
    { method: "DELETE", path: "/candidate-fields/:id" },
    // P4-1 §G drift closures: three protected routes that were absent from the
    // registry. /candidate-fields/template and /candidate/attempts/:attemptId/take
    // are requireRole-gated; /admin/attempts/:attemptId/proctor-incident is
    // already requireCapability-gated. All three are protected and therefore
    // belong in the registry (RBAC-M4 coverage contract).
    { method: "GET", path: "/candidate-fields/template" },
    { method: "GET", path: "/candidate/attempts/:attemptId/take" },
    { method: "POST", path: "/admin/attempts/:attemptId/proctor-incident" },
  ];

  it("every requireRole-protected route has a registry entry", () => {
    const registryKeys = new Set(
      ROUTE_PERMISSION_REGISTRY.map((e) => registryKeyFor(e)),
    );
    const missing = PROTECTED_ROUTES.filter(
      (r) => !registryKeys.has(`${r.method} ${r.path}`),
    );
    expect(missing).toEqual([]);
  });
});
