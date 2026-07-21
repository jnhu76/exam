import { describe, it, expect } from "vitest";
import {
  AuditAction,
  isAuditAction,
  assertAuditAction,
} from "./auditActions.js";

describe("AUDIT-M1 audit action catalog — shape", () => {
  it("exports a closed AuditAction union (unique values)", () => {
    const values = Object.values(AuditAction);
    expect(new Set(values).size).toBe(values.length);
    expect(values.length).toBeGreaterThan(0);
  });

  it("keeps the legacy camelCase action names (ADR: NO rename)", () => {
    // ADR "Naming collision guard": the jobcard proposed attempt.force_submitted
    // and grading.score_submitted, but the live names are camelCase. Keep them.
    expect(AuditAction.AttemptForceSubmit).toBe("attempt.forceSubmit");
    expect(AuditAction.GradingScoreEntered).toBe("grading.score_entered");
    expect(AuditAction.AttemptAutoSubmit).toBe("attempt.autoSubmit");
    expect(AuditAction.AttemptDisrupted).toBe("attempt.disrupted");
    expect(AuditAction.ExportScores).toBe("export_scores");
  });

  it("includes the ADR-mandated NEW actions", () => {
    expect(AuditAction.GradingDetailViewed).toBe("grading.detail_viewed");
    expect(AuditAction.UserRoleChanged).toBe("user.role_changed");
  });
});

describe("AUDIT-M1 audit action catalog — guards", () => {
  it("isAuditAction narrows correctly", () => {
    expect(isAuditAction("exam.publish")).toBe(true);
    expect(isAuditAction("not.a.real.action")).toBe(false);
    expect(isAuditAction("")).toBe(false);
  });

  it("assertAuditAction throws on an unknown action", () => {
    expect(() => assertAuditAction("bogus.action")).toThrow();
  });

  it("assertAuditAction passes a known action (returns void)", () => {
    expect(() => assertAuditAction("exam.publish")).not.toThrow();
    expect(assertAuditAction("grading.score_entered")).toBeUndefined();
  });
});
