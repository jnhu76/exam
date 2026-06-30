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
