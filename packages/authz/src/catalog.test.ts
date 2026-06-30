import { describe, it, expect } from "vitest";
import { Permission, Scope, Role } from "./catalog.js";
import { AuditAction } from "./auditActions.js";

describe("RBAC-M1 catalog — exported shape", () => {
  it("exports a Permission constant object (dotted keys)", () => {
    expect(Permission).toBeDefined();
    expect(typeof Permission).toBe("object");
    // Spot-check a representative dotted key from each ADR §4 group.
    expect(Permission.UserView).toBe("user.view");
    expect(Permission.AttemptForceSubmit).toBe("attempt.force_submit");
    expect(Permission.SystemAutoSubmit).toBe("system.auto_submit");
  });

  it("exports a Scope constant object (ADR §5)", () => {
    expect(Scope.System).toBe("system");
    expect(Scope.Organization).toBe("organization");
    expect(Scope.OwnAttempt).toBe("own_attempt");
    expect(Scope.OwnScore).toBe("own_score");
  });

  it("exports a Role constant object with the 6 ADR presets", () => {
    expect(Object.values(Role).sort()).toEqual(
      ["Admin", "Candidate", "Grader", "Proctor", "System", "Teacher"].sort(),
    );
  });

  it("exports an AuditAction constant object", () => {
    expect(AuditAction).toBeDefined();
    expect(typeof AuditAction).toBe("object");
  });
});
