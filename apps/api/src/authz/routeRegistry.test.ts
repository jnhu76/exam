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
      expect(typeof e.legacyGate).toBe("string");
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

  it("time-grants -> attempt.time.grant @ attempt scope", () => {
    const e = find("POST", "/admin/attempts/:attemptId/time-grants");
    expect(e?.permission).toBe("attempt.time.grant");
    expect(e?.auditAction).toBe("attempt.timeGrant");
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
    expect(e?.legacyGate).toBe("Admin");
  });

  it("candidate take snapshot -> attempt.view_own @ own_attempt scope", () => {
    const e = find("GET", "/candidate/attempts/:attemptId/take");
    expect(e?.permission).toBe("attempt.view_own");
    expect(e?.scope).toBe("own_attempt");
    expect(e?.legacyGate).toBe("Candidate");
  });

  it("proctor incident -> attempt.misconduct.mark @ attempt scope (already capability-gated)", () => {
    const e = find("POST", "/admin/attempts/:attemptId/proctor-incident");
    expect(e?.permission).toBe("attempt.misconduct.mark");
    expect(e?.scope).toBe("attempt");
    expect(e?.auditAction).toBe("proctor.incident_marked");
    expect(e?.sensitive).toBe(true);
  });

  it("proctor discovery -> exam.room.view with an organization-scoped list filter", () => {
    const e = find("GET", "/admin/proctor/exams");
    expect(e?.permission).toBe(Permission.ExamRoomView);
    expect(e?.scope).toBe("organization");
    expect(e?.resolver).toBe("organization");
    expect(e?.resource).toEqual({
      type: "list",
      listOf: "exam",
      filterSpec: "proctor-discoverable-exams",
    });
  });

  it("proctor monitoring reads stay flagged sensitive", () => {
    // proctor-incident's sensitive flag is pinned above; these two reads are
    // the remaining sensitive proctor routes (pin formerly duplicated in
    // proctorMonitoring.crossOrg.test.ts).
    for (const [method, path] of [
      ["GET", "/admin/exams/:examId/proctor/attempts"],
      ["GET", "/admin/attempts/:attemptId/proctor-events"],
    ] as const) {
      expect(find(method, path)?.sensitive, `${method} ${path}`).toBe(true);
    }
  });
});

/**
 * RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1 — registry/runtime conformance.
 *
 * The route registry is the documented target state for every protected
 * route. Four routes were migrated in this corrective to close the
 * registry-vs-runtime drift surfaced in review #2/#5:
 *
 *   - GET  /scores/attempts/:attemptId        -> score capability (own/all)
 *   - GET  /admin/exams/:examId/proctor/attempts   -> exam resolver
 *   - GET  /admin/attempts/:attemptId/proctor-events   -> attempt resolver
 *   - POST /admin/attempts/:attemptId/proctor-incident -> attempt resolver
 *
 * These tests pin the registry declarations so the runtime migration (which
 * the route-level + permission-matrix tests prove behaviorally) is backed by
 * a stable contract. If a future edit reverts a runtime decorator without
 * updating the registry (or vice versa), the mismatch surfaces here.
 */
describe("RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1 — migrated-route registry declarations", () => {
  const find = (method: string, path: string) =>
    ROUTE_PERMISSION_REGISTRY.find(
      (e) => e.method === method && e.path === path,
    );

  it("GET /scores/attempts/:attemptId declares score.own.view @ own_score via the score resolver", () => {
    const e = find("GET", "/scores/attempts/:attemptId");
    expect(e).toBeDefined();
    expect(e?.permission).toBe(Permission.ScoreOwnView);
    expect(e?.scope).toBe(Scope.OwnScore);
    expect(e?.resolver).toBe("score");
    // Runtime uses requireScoreCapability() (own/all arbitration, no role branch).
    // The registry's ScoreOwnView reflects the candidate path; ScoreAllView is
    // the broadening grant arbitrated by the same preHandler (ADR §L619-620).
  });

  it("GET /admin/exams/:examId/proctor/attempts declares exam.room.view @ exam via the exam resolver", () => {
    const e = find("GET", "/admin/exams/:examId/proctor/attempts");
    expect(e).toBeDefined();
    expect(e?.permission).toBe(Permission.ExamRoomView);
    expect(e?.scope).toBe(Scope.Exam);
    expect(e?.resolver).toBe("exam");
    // Runtime uses requireScopedCapability(ExamRoomView, "exam", "examId").
  });

  it("GET /admin/attempts/:attemptId/proctor-events declares attempt.timeline.view @ attempt via the attempt resolver", () => {
    const e = find("GET", "/admin/attempts/:attemptId/proctor-events");
    expect(e).toBeDefined();
    expect(e?.permission).toBe(Permission.AttemptTimelineView);
    expect(e?.scope).toBe(Scope.Attempt);
    expect(e?.resolver).toBe("attempt");
    // Runtime uses requireScopedCapability(AttemptTimelineView, "attempt", "attemptId").
  });

  it("POST /admin/attempts/:attemptId/proctor-incident declares attempt.misconduct.mark @ attempt via the attempt resolver", () => {
    const e = find("POST", "/admin/attempts/:attemptId/proctor-incident");
    expect(e).toBeDefined();
    expect(e?.permission).toBe(Permission.AttemptMisconductMark);
    expect(e?.scope).toBe(Scope.Attempt);
    expect(e?.resolver).toBe("attempt");
    expect(e?.auditAction).toBe("proctor.incident_marked");
    // Runtime uses requireScopedCapability(AttemptMisconductMark, "attempt", "attemptId").
  });
});

// Coverage of the protected-route set (registry ⊇ runtime) is owned by
// routeRegistryConformanceWholeApp.test.ts, which derives the inventory from
// a real whole-application registration via onRoute — a hand-copied list here
// drifted 38+ routes behind and could not fail on that drift.
