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

describe("RBAC-M5 shadow mode — never crashes on missing/loose inputs (ADR §10.3)", () => {
  // Shadow mode MUST NEVER throw or alter a production request, even when a
  // legacy caller passes a missing resource id or omits permissions. These are
  // the Gemini-code-assist regression guards.

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

  it("does not throw when ctx.permissions is missing (legacy caller)", () => {
    const log = makeLogger();
    const ctx = {
      actorId: "admin-1",
      role: Role.Admin,
      permissions: undefined as never,
    };
    const input: ShadowInput = {
      route: "POST /admin/attempts/:attemptId/force-submit",
      ctx,
      legacyGate: ["Admin"],
      permission: Permission.AttemptForceSubmit,
      resource: { type: "attempt", id: "att-1" },
    };
    // Admin preset already holds attempt.force_submit, so capability is true
    // via the preset branch and the missing-permissions fallback is never hit;
    // but a System-only perm (not in Admin preset) forces the fallback path.
    const inputFallback: ShadowInput = {
      ...input,
      permission: Permission.SystemAutoSubmit,
    };
    expect(() => shadowRequireCapability(inputFallback, log)).not.toThrow();
    const r = shadowRequireCapability(inputFallback, log);
    // Legacy (Admin gate) allows; capability (System-only perm, no perms array)
    // denies -> mismatch recorded, but no throw, decision stays legacy-allow.
    expect(r.decision).toBe("allow");
    expect(r.capabilityAllowed).toBe(false);
  });
});
