import { describe, expect, it } from "vitest";
import type { RepoContext, TenantContext } from "../types.js";
import { isPlatformContext, isTenantContext } from "../types.js";

describe("A01: Context type guards", () => {
  it("isTenantContext identifies TenantContext", () => {
    const ctx: RepoContext = {
      organizationId: "org-1",
      actorId: "user-1",
      role: "Admin",
      permissions: [],
    };
    expect(isTenantContext(ctx)).toBe(true);
    if (isTenantContext(ctx)) {
      expect(ctx.organizationId).toBe("org-1");
    }
  });

  it("isTenantContext rejects PlatformContext", () => {
    const ctx: RepoContext = {
      actorId: "user-1",
      role: "Admin",
      permissions: [],
    };
    expect(isTenantContext(ctx)).toBe(false);
  });

  it("isTenantContext rejects AuthLookupContext", () => {
    const ctx: RepoContext = {
      purpose: "auth_lookup",
    };
    expect(isTenantContext(ctx)).toBe(false);
  });

  it("isPlatformContext identifies PlatformContext", () => {
    const ctx: RepoContext = {
      actorId: "user-1",
      role: "Admin",
      permissions: [],
    };
    expect(isPlatformContext(ctx)).toBe(true);
    if (isPlatformContext(ctx)) {
      expect(ctx.actorId).toBe("user-1");
    }
  });

  it("isPlatformContext rejects TenantContext", () => {
    const ctx: RepoContext = {
      organizationId: "org-1",
      actorId: "user-1",
      role: "Admin",
      permissions: [],
    };
    expect(isPlatformContext(ctx)).toBe(false);
  });

  it("isPlatformContext rejects AuthLookupContext", () => {
    const ctx: RepoContext = {
      purpose: "auth_lookup",
    };
    expect(isPlatformContext(ctx)).toBe(false);
  });
});

describe("A01: resolveOrganizationId / resolveOptionalOrganizationId", () => {
  it("resolveOrganizationId returns organizationId for Admin", async () => {
    const { resolveOrganizationId } = await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "admin",
      role: "Admin",
      permissions: [],
    };
    expect(resolveOrganizationId(ctx)).toBe("org-1");
  });

  it("resolveOrganizationId returns organizationId for Candidate", async () => {
    const { resolveOrganizationId } = await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "cand",
      role: "Candidate",
      permissions: [],
    };
    expect(resolveOrganizationId(ctx)).toBe("org-1");
  });

  it("resolveOrganizationId ignores targetOrganizationId (Phase 1 single-tenant)", async () => {
    const { resolveOrganizationId } = await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "admin",
      role: "Admin",
      permissions: [],
      targetOrganizationId: "org-2",
    };
    expect(resolveOrganizationId(ctx)).toBe("org-1");
  });

  it("resolveOptionalOrganizationId returns organizationId for Admin", async () => {
    const { resolveOptionalOrganizationId } =
      await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "admin",
      role: "Admin",
      permissions: [],
    };
    expect(resolveOptionalOrganizationId(ctx)).toBe("org-1");
  });

  it("resolveOptionalOrganizationId ignores targetOrganizationId (Phase 1 single-tenant)", async () => {
    const { resolveOptionalOrganizationId } =
      await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "admin",
      role: "Admin",
      permissions: [],
      targetOrganizationId: "org-2",
    };
    expect(resolveOptionalOrganizationId(ctx)).toBe("org-1");
  });
});

describe("projectAttemptTimingPolicySnapshot", () => {
  it("projects a strict snapshot and preserves null caps", async () => {
    const { projectAttemptTimingPolicySnapshot } = await import("../types.js");
    const result = projectAttemptTimingPolicySnapshot({
      interruptionPolicySnapshotVersion: 1,
      interruptionTimePolicySnapshot: "strict",
      interruptionGracePerIncidentSecondsSnapshot: null,
      interruptionGracePerAttemptSecondsSnapshot: null,
    });
    expect(result).toEqual({
      schemaVersion: 1,
      policy: "strict",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    });
  });

  it("projects a bounded_grace snapshot with caps and schemaVersion", async () => {
    const { projectAttemptTimingPolicySnapshot } = await import("../types.js");
    const result = projectAttemptTimingPolicySnapshot({
      interruptionPolicySnapshotVersion: 1,
      interruptionTimePolicySnapshot: "bounded_grace",
      interruptionGracePerIncidentSecondsSnapshot: 60,
      interruptionGracePerAttemptSecondsSnapshot: 180,
    });
    expect(result).toEqual({
      schemaVersion: 1,
      policy: "bounded_grace",
      perIncidentCapSeconds: 60,
      perAttemptAggregateCapSeconds: 180,
    });
  });
});
