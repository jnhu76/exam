import { describe, it, expect } from "vitest";
import {
  shadowRequireCapability,
  type ShadowLogger,
  type ShadowInput,
  type ShadowContext,
} from "./shadow.js";
import { Permission, Role, type PermissionKey } from "@exam/authz";

/**
 * RBAC-M10-E shadow tests. Post-flip semantics:
 *   - ShadowContext carries `capabilities` (the authoritative assignment union),
 *     NOT the legacy `permissions` array.
 *   - `decision` mirrors `capabilityAllowed` (production follows capability).
 *   - A mismatch means `users.role` is stale relative to the assignment table;
 *     shadow records it but never alters a production request (advisory only).
 */

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

const adminCtx: ShadowContext = {
  actorId: "admin-1",
  role: Role.Admin,
  capabilities: ["attempt.force_submit"] as PermissionKey[],
};
const candidateCtx: ShadowContext = {
  actorId: "cand-1",
  role: Role.Candidate,
  capabilities: [],
};

describe("RBAC-M10-E shadow mode — decision follows capability (authoritative)", () => {
  it("returns the CAPABILITY decision (allow when the capability set holds the perm)", () => {
    const log = makeLogger();
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx: adminCtx,
      legacyGate: ["Admin"],
      permission: Permission.AttemptForceSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    // Admin passes the legacy gate AND holds the capability -> allow.
    const r = shadowRequireCapability(input, log);
    expect(r.legacyAllowed).toBe(true);
    expect(r.capabilityAllowed).toBe(true);
    expect(r.decision).toBe("allow");
  });

  it("denies when capability denies (Candidate hitting Admin route)", () => {
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
    expect(r.capabilityAllowed).toBe(false);
    expect(r.decision).toBe("deny");
  });
});

describe("RBAC-M10-E shadow mode — records drift but never blocks", () => {
  it("logs a mismatch (legacy allow + capability deny) and decision follows capability", () => {
    const log = makeLogger();
    // Construct the canonical M10-E drift case: users.role = Admin (legacy
    // projection) but the assignment table says Candidate (the authoritative
    // capability set holds no admin perm). Shadow records the mismatch;
    // production would follow the capability side.
    const ctx: ShadowContext = {
      actorId: "admin-1",
      role: Role.Admin,
      capabilities: [],
    };
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx,
      legacyGate: ["Admin"],
      permission: Permission.AttemptForceSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    const r = shadowRequireCapability(input, log);
    expect(r.legacyAllowed).toBe(true);
    expect(r.capabilityAllowed).toBe(false);
    // Decision follows capability (authoritative post-M10-E).
    expect(r.decision).toBe("deny");
    // A mismatch was recorded as a warning.
    expect(log.records.length).toBeGreaterThan(0);
    const mismatchRecord = log.records.find(
      (rec) => (rec as { decision?: string }).decision === "mismatch",
    );
    expect(mismatchRecord).toBeDefined();
  });

  it("logs the reverse drift (legacy deny + capability allow)", () => {
    const log = makeLogger();
    // users.role = Candidate but assignment table granted Admin perms.
    const ctx: ShadowContext = {
      actorId: "admin-1",
      role: Role.Candidate,
      capabilities: ["attempt.force_submit"] as PermissionKey[],
    };
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx,
      legacyGate: ["Admin"],
      permission: Permission.AttemptForceSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    const r = shadowRequireCapability(input, log);
    expect(r.legacyAllowed).toBe(false);
    expect(r.capabilityAllowed).toBe(true);
    expect(r.decision).toBe("allow");
    const mismatchRecord = log.records.find(
      (rec) => (rec as { decision?: string }).decision === "mismatch",
    );
    expect(mismatchRecord).toBeDefined();
  });

  it("does not throw on a mismatch (production request is unaffected)", () => {
    const log = makeLogger();
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx: { actorId: "x", role: Role.Admin, capabilities: [] },
      legacyGate: ["Admin"],
      permission: Permission.AttemptForceSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    expect(() => shadowRequireCapability(input, log)).not.toThrow();
  });
});

describe("RBAC-M10-E shadow mode — sensitive resource logging hygiene (ADR §10.6/§3.8)", () => {
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

describe("RBAC-M10-E shadow mode — never crashes on missing/loose inputs (ADR §10.3)", () => {
  // Shadow mode MUST NEVER throw or alter a production request, even when a
  // caller passes a missing resource id or an empty capability set.

  it("does not throw when resource.id is undefined (system-scope / no-id route)", () => {
    const log = makeLogger();
    const input: ShadowInput = {
      route: "GET /system/health",
      ctx: adminCtx,
      legacyGate: ["Admin"],
      permission: Permission.SystemHealthView,
      resource: { type: "system_diagnostics", id: undefined as never },
    };
    expect(() => shadowRequireCapability(input, log)).not.toThrow();
    expect(log.records.length).toBeGreaterThan(0);
  });

  it("does not throw when capabilities is empty (capability deny, no fallback)", () => {
    const log = makeLogger();
    const ctx: ShadowContext = {
      actorId: "admin-1",
      role: Role.Admin,
      capabilities: [],
    };
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx,
      legacyGate: ["Admin"],
      permission: Permission.AttemptForceSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    // Empty capability set -> capability denies; legacy (Admin gate) allows ->
    // mismatch recorded, but no throw, decision follows capability (deny).
    expect(() => shadowRequireCapability(input, log)).not.toThrow();
    const r = shadowRequireCapability(input, log);
    expect(r.capabilityAllowed).toBe(false);
    expect(r.decision).toBe("deny");
  });
});
