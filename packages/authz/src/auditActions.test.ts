import { describe, it, expect } from "vitest";
import {
  AuditAction,
  isAuditAction,
  assertAuditAction,
  KNOWN_PRODUCTION_AUDIT_ACTIONS,
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

describe("AUDIT-M1 audit action catalog — covers all real production actions", () => {
  // Ground truth: every action string actually passed to recordAudit() or
  // createAuditLogRepo().create() in apps/api/src (non-test), captured via rg.
  // If AUDIT-M1's closed set omits any of these, recordAudit would reject it
  // at runtime — this test is the regression guard for that.
  it("every known production action is a member of AuditAction", () => {
    const catalog = new Set<string>(Object.values(AuditAction));
    for (const action of KNOWN_PRODUCTION_AUDIT_ACTIONS) {
      expect(catalog.has(action), `missing action: ${action}`).toBe(true);
    }
  });

  it("the known production list itself is the full non-test audit surface", () => {
    // Sanity: the curated list contains the high-value actions we must not drop.
    const must = [
      "attempt.forceSubmit",
      "attempt.extendTime",
      "attempt.misconductFlagged",
      "attempt.autoSubmit",
      "attempt.disrupted",
      "grading.score_entered",
      "grading.finalized",
      "exam.publish",
      "exam.publish_results",
      "export_scores",
      "user.create",
      "logout",
      "admin.bootstrap",
    ];
    for (const m of must) expect(KNOWN_PRODUCTION_AUDIT_ACTIONS).toContain(m);
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
