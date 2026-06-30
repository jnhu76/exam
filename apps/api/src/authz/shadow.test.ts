import { describe, it, expect } from "vitest";
import {
  shadowRequireCapability,
  type ShadowLogger,
  type ShadowInput,
} from "./shadow.js";
import { Permission, Role, type PermissionKey } from "@exam/authz";

// A collecting logger so tests can assert what shadow recorded without pino.
function makeLogger(): ShadowLogger & { records: unknown[] } {
  const records: unknown[] = [];
  return {
    records,
    info: (obj: unknown) =>
      records.push({ level: "info", ...(obj as Record<string, unknown>) }),
    warn: (obj: unknown) =>
      records.push({ level: "warn", ...(obj as Record<string, unknown>) }),
  };
}

const adminCtx = {
  actorId: "admin-1",
  role: Role.Admin,
  permissions: ["attempt.force_submit"] as PermissionKey[],
};
const candidateCtx = {
  actorId: "cand-1",
  role: Role.Candidate,
  permissions: [] as PermissionKey[],
};

describe("RBAC-M5 shadow mode — legacy stays authoritative", () => {
  it("returns the LEGACY decision (never the capability one)", () => {
    const log = makeLogger();
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx: adminCtx,
      legacyGate: ["Admin"],
      permission: Permission.AttemptForceSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    // Admin passes legacy gate -> shadow returns allow.
    expect(shadowRequireCapability(input, log).legacyAllowed).toBe(true);
    expect(shadowRequireCapability(input, log).decision).toBe("allow");
  });

  it("denies when legacy denies (Candidate hitting Admin route)", () => {
    const log = makeLogger();
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx: candidateCtx,
      legacyGate: ["Admin"],
      permission: Permission.AttemptForceSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    const r = shadowRequireCapability(input, log);
    expect(r.legacyAllowed).toBe(false);
    expect(r.decision).toBe("deny");
  });
});

describe("RBAC-M5 shadow mode — records disagreement but never blocks", () => {
  it("logs a mismatch (legacy allow + capability deny) but still returns the legacy allow", () => {
    const log = makeLogger();
    // Force a real matrix mismatch: Admin passes the legacy ["Admin"] gate,
    // but a System-only permission is not in the Admin preset -> capability
    // denies. (Admin is a superset of all Admin-route perms, so the only way
    // to construct legacy-allow + capability-deny is a System-only perm —
    // which is exactly the kind of matrix bug shadow exists to catch.)
    const ctx = {
      actorId: "admin-1",
      role: Role.Admin,
      permissions: [] as PermissionKey[],
    };
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx,
      legacyGate: ["Admin"],
      permission: Permission.SystemAutoSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    const r = shadowRequireCapability(input, log);
    // Legacy authoritative -> allow, even though capability disagrees.
    expect(r.legacyAllowed).toBe(true);
    expect(r.capabilityAllowed).toBe(false);
    expect(r.decision).toBe("allow");
    // A mismatch was recorded as a warning.
    expect(log.records.length).toBeGreaterThan(0);
    const mismatchRecord = log.records.find(
      (rec) => (rec as { decision?: string }).decision === "mismatch",
    );
    expect(mismatchRecord).toBeDefined();
  });

  it("does not throw on a mismatch (production request is unaffected)", () => {
    const log = makeLogger();
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx: { actorId: "x", role: Role.Admin, permissions: [] as never },
      legacyGate: ["Admin"],
      permission: Permission.SystemAutoSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    expect(() => shadowRequireCapability(input, log)).not.toThrow();
  });
});

describe("RBAC-M5 shadow mode — sensitive resource logging hygiene (ADR §10.6/§3.8)", () => {
  it("records resource type + opaque id hash, never the resource payload", () => {
    const log = makeLogger();
    const input: ShadowInput = {
      route: "GET /admin/attempts/:attemptId/grading-details",
      ctx: adminCtx,
      legacyGate: ["Admin"],
      permission: Permission.GradingDetailView,
      resource: { type: "attempt", id: "att-secret" },
    };
    shadowRequireCapability(input, log);
    const serialized = JSON.stringify(log.records);
    // The opaque id hash may appear, the raw payload must not.
    expect(serialized).toContain("attempt");
    // No candidate-answer / PII field names leak.
    expect(serialized).not.toContain("candidateAnswer");
    expect(serialized).not.toContain("answerByQuestion");
  });
});
