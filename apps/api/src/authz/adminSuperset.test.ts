import { describe, it, expect } from "vitest";
import { permissionsForRole, Permission, Role } from "@exam/authz";
import { ROUTE_PERMISSION_REGISTRY } from "./routeRegistry.js";

describe("RBAC-M6 — Admin superset covers the route registry (migration safety)", () => {
  const adminPerms = new Set<string>(permissionsForRole(Role.Admin));

  it("every Admin-gated route's permission is granted to Admin", () => {
    // ADR Current Problem #3 / §9: flipping requireRole(["Admin"]) to
    // requireCapability must never deny Admin. If any Admin-gated route's
    // permission is missing from the Admin preset, migration breaks.
    const adminGated = ROUTE_PERMISSION_REGISTRY.filter(
      (e) => e.currentGate === "Admin",
    );
    expect(adminGated.length).toBeGreaterThan(0);
    const violations = adminGated.filter((e) => !adminPerms.has(e.permission));
    expect(
      violations.map((v) => `${v.method} ${v.path} -> ${v.permission}`),
    ).toEqual([]);
  });

  it("no Candidate-own route is gated Admin (boundary sanity)", () => {
    const candidateOwnPerms = new Set<string>([
      Permission.ExamTake,
      Permission.AttemptStart,
      Permission.AttemptAnswerSave,
      Permission.AttemptSubmit,
      Permission.AttemptRestore,
      Permission.AttemptHeartbeatSend,
      Permission.ScoreOwnView,
      Permission.AttemptViewOwn,
    ]);
    const wrong = ROUTE_PERMISSION_REGISTRY.filter(
      (e) => e.currentGate === "Admin" && candidateOwnPerms.has(e.permission),
    );
    expect(wrong).toEqual([]);
  });
});
