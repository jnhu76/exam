import { describe, it, expect } from "vitest";
import { ROLE_PRESETS, permissionsForRole } from "./presets.js";
import { Permission, Role, Scope } from "./catalog.js";

const asSet = (perms: readonly string[]) => new Set(perms);

describe("RBAC-M2 role presets — shape", () => {
  it("defines all 6 ADR presets", () => {
    expect(Object.keys(ROLE_PRESETS).sort()).toEqual(
      ["Admin", "Candidate", "Grader", "Proctor", "System", "Teacher"].sort(),
    );
  });

  it("each preset carries label/purpose/scope/login/assignable flags", () => {
    for (const preset of Object.values(ROLE_PRESETS)) {
      expect(typeof preset.label).toBe("string");
      expect(typeof preset.purpose).toBe("string");
      expect(typeof preset.loginAllowed).toBe("boolean");
      expect(typeof preset.assignable).toBe("boolean");
      expect(typeof preset.isSystem).toBe("boolean");
      expect(Array.isArray(preset.permissions)).toBe(true);
    }
  });
});

describe("RBAC-M2 boundary #7 — Candidate is always own-scope only", () => {
  const perms = asSet(permissionsForRole(Role.Candidate));

  it("Candidate holds only own_attempt / own_score runtime perms", () => {
    expect(perms.has(Permission.ExamTake)).toBe(true);
    expect(perms.has(Permission.AttemptStart)).toBe(true);
    expect(perms.has(Permission.AttemptAnswerSave)).toBe(true);
    expect(perms.has(Permission.AttemptSubmit)).toBe(true);
    expect(perms.has(Permission.AttemptRestore)).toBe(true);
    expect(perms.has(Permission.AttemptHeartbeatSend)).toBe(true);
    expect(perms.has(Permission.ScoreOwnView)).toBe(true);
  });

  it("Candidate has NO admin/proctor/grading/system capabilities", () => {
    expect(perms.has(Permission.UserCreate)).toBe(false);
    expect(perms.has(Permission.ExamPublish)).toBe(false);
    expect(perms.has(Permission.AttemptForceSubmit)).toBe(false);
    expect(perms.has(Permission.GradingScoreWrite)).toBe(false);
    expect(perms.has(Permission.SystemAutoSubmit)).toBe(false);
    expect(perms.has(Permission.ScoreAllView)).toBe(false);
  });

  it("Candidate default scope is own_attempt/own_score", () => {
    expect(ROLE_PRESETS[Role.Candidate].defaultScope).toBe(Scope.OwnAttempt);
  });
});

describe("ADR-014 — Incident permission matrix", () => {
  it("Admin holds all four incident permissions + recovery view", () => {
    const adminPerms = asSet(permissionsForRole(Role.Admin));
    expect(adminPerms.has(Permission.IncidentView)).toBe(true);
    expect(adminPerms.has(Permission.IncidentCreate)).toBe(true);
    expect(adminPerms.has(Permission.IncidentInvestigate)).toBe(true);
    expect(adminPerms.has(Permission.IncidentResolve)).toBe(true);
    expect(adminPerms.has(Permission.IncidentRecoveryView)).toBe(true);
  });

  it("incident.resolve is flagged sensitive for Admin", () => {
    const sensitive = asSet(ROLE_PRESETS[Role.Admin].sensitivePermissions);
    expect(sensitive.has(Permission.IncidentResolve)).toBe(true);
  });

  it("Proctor holds the J4-I1D low-risk incident set but NOT resolve/recovery (ADR-015 §13)", () => {
    const proctorPerms = asSet(permissionsForRole(Role.Proctor));
    expect(proctorPerms.has(Permission.IncidentView)).toBe(true);
    expect(proctorPerms.has(Permission.IncidentCreate)).toBe(true);
    expect(proctorPerms.has(Permission.IncidentInvestigate)).toBe(true);
    // Terminal judgment stays Admin-only.
    expect(proctorPerms.has(Permission.IncidentResolve)).toBe(false);
    // Recovery Center read is Admin-only (J5-R0).
    expect(proctorPerms.has(Permission.IncidentRecoveryView)).toBe(false);
  });

  it("Teacher holds ZERO incident permissions", () => {
    const teacherPerms = asSet(permissionsForRole(Role.Teacher));
    expect(teacherPerms.has(Permission.IncidentView)).toBe(false);
    expect(teacherPerms.has(Permission.IncidentCreate)).toBe(false);
    expect(teacherPerms.has(Permission.IncidentInvestigate)).toBe(false);
    expect(teacherPerms.has(Permission.IncidentResolve)).toBe(false);
  });

  it("Grader holds ZERO incident permissions", () => {
    const graderPerms = asSet(permissionsForRole(Role.Grader));
    expect(graderPerms.has(Permission.IncidentView)).toBe(false);
    expect(graderPerms.has(Permission.IncidentCreate)).toBe(false);
    expect(graderPerms.has(Permission.IncidentInvestigate)).toBe(false);
    expect(graderPerms.has(Permission.IncidentResolve)).toBe(false);
  });

  it("Candidate holds ZERO incident permissions", () => {
    const candidatePerms = asSet(permissionsForRole(Role.Candidate));
    expect(candidatePerms.has(Permission.IncidentView)).toBe(false);
    expect(candidatePerms.has(Permission.IncidentCreate)).toBe(false);
    expect(candidatePerms.has(Permission.IncidentInvestigate)).toBe(false);
    expect(candidatePerms.has(Permission.IncidentResolve)).toBe(false);
  });

  it("System holds ZERO incident permissions (system.incident.create is reserved, NOT in catalog)", () => {
    const systemPerms = asSet(permissionsForRole(Role.System));
    expect(systemPerms.has(Permission.IncidentView)).toBe(false);
    expect(systemPerms.has(Permission.IncidentCreate)).toBe(false);
    expect(systemPerms.has(Permission.IncidentInvestigate)).toBe(false);
    expect(systemPerms.has(Permission.IncidentResolve)).toBe(false);
  });
});
