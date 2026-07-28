import { describe, expect, it } from "vitest";
import type {
  AuthLookupContext,
  PlatformContext,
  RepoContext,
  TenantContext,
} from "../types.js";
import { isPlatformContext, isTenantContext } from "../types.js";
import {
  AsyncAuthLookupRepo,
  AsyncPlatformRepo,
  AsyncTenantRepo,
} from "../repository/baseRepo.js";

describe("A01: Context types", () => {
  describe("TenantContext", () => {
    it("requires organizationId", () => {
      const ctx: TenantContext = {
        organizationId: "org-1",
        actorId: "user-1",
        role: "Admin",
        permissions: ["MANAGE_USERS"],
      };
      expect(ctx.organizationId).toBe("org-1");
    });

    it("accepts optional targetOrganizationId", () => {
      const ctx: TenantContext = {
        organizationId: "org-1",
        actorId: "user-1",
        role: "Admin",
        permissions: [],
        targetOrganizationId: "org-2",
      };
      expect(ctx.targetOrganizationId).toBe("org-2");
    });
  });

  describe("PlatformContext", () => {
    it("does not require organizationId", () => {
      const ctx: PlatformContext = {
        actorId: "user-1",
        role: "Admin",
        permissions: ["MANAGE_ORGANIZATION"],
      };
      expect(ctx.actorId).toBe("user-1");
    });

    it("accepts optional targetOrganizationId", () => {
      const ctx: PlatformContext = {
        actorId: "user-1",
        role: "Admin",
        permissions: [],
        targetOrganizationId: "org-1",
      };
      expect(ctx.targetOrganizationId).toBe("org-1");
    });
  });

  describe("AuthLookupContext", () => {
    it("is lightweight with only purpose field", () => {
      const ctx: AuthLookupContext = {
        purpose: "auth_lookup",
      };
      expect(ctx.purpose).toBe("auth_lookup");
    });
  });
});

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

describe("A01: AsyncRepo interface contracts", () => {
  it("AsyncTenantRepo has required method signatures", () => {
    const repo: AsyncTenantRepo<
      { id: string },
      { name: string },
      { name?: string }
    > = {
      async create(ctx, input) {
        return { id: "test" };
      },
      async findById(ctx, id) {
        return null;
      },
      async list(ctx) {
        return [];
      },
      async update(ctx, id, input) {
        return null;
      },
      async delete(ctx, id) {
        return false;
      },
    };
    expect(typeof repo.create).toBe("function");
    expect(typeof repo.findById).toBe("function");
    expect(typeof repo.list).toBe("function");
    expect(typeof repo.update).toBe("function");
    expect(typeof repo.delete).toBe("function");
  });

  it("AsyncPlatformRepo has required method signatures", () => {
    const repo: AsyncPlatformRepo<
      { id: string },
      { name: string },
      { name?: string }
    > = {
      async create(ctx, input) {
        return { id: "test" };
      },
      async findById(ctx, id) {
        return null;
      },
      async list(ctx) {
        return [];
      },
      async update(ctx, id, input) {
        return null;
      },
      async delete(ctx, id) {
        return false;
      },
    };
    expect(typeof repo.create).toBe("function");
    expect(typeof repo.findById).toBe("function");
    expect(typeof repo.list).toBe("function");
    expect(typeof repo.update).toBe("function");
    expect(typeof repo.delete).toBe("function");
  });

  it("AsyncAuthLookupRepo has required method signatures", () => {
    const repo: AsyncAuthLookupRepo<{ id: string }> = {
      async findById(ctx, id) {
        return null;
      },
    };
    expect(typeof repo.findById).toBe("function");
  });

  it("AsyncTenantRepo.create returns Promise", async () => {
    const repo: AsyncTenantRepo<{ id: string }, { name: string }, never> = {
      async create(ctx, input) {
        return { id: "created" };
      },
      async findById() {
        return null;
      },
      async list() {
        return [];
      },
      async update() {
        return null;
      },
      async delete() {
        return false;
      },
    };
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "user-1",
      role: "Admin",
      permissions: [],
    };
    const result = await repo.create(ctx, { name: "test" });
    expect(result).toEqual({ id: "created" });
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
  it("projects a strict snapshot", async () => {
    const { projectAttemptTimingPolicySnapshot } = await import("../types.js");
    expect(
      projectAttemptTimingPolicySnapshot({
        interruptionPolicySnapshotVersion: 1,
        interruptionTimePolicySnapshot: "strict",
        interruptionGracePerIncidentSecondsSnapshot: null,
        interruptionGracePerAttemptSecondsSnapshot: null,
      }),
    ).toEqual({
      schemaVersion: 1,
      policy: "strict",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    });
  });

  it("projects a bounded_grace snapshot", async () => {
    const { projectAttemptTimingPolicySnapshot } = await import("../types.js");
    expect(
      projectAttemptTimingPolicySnapshot({
        interruptionPolicySnapshotVersion: 1,
        interruptionTimePolicySnapshot: "bounded_grace",
        interruptionGracePerIncidentSecondsSnapshot: 60,
        interruptionGracePerAttemptSecondsSnapshot: 180,
      }),
    ).toEqual({
      schemaVersion: 1,
      policy: "bounded_grace",
      perIncidentCapSeconds: 60,
      perAttemptAggregateCapSeconds: 180,
    });
  });

  it("projects an operator_incident snapshot", async () => {
    const { projectAttemptTimingPolicySnapshot } = await import("../types.js");
    expect(
      projectAttemptTimingPolicySnapshot({
        interruptionPolicySnapshotVersion: 1,
        interruptionTimePolicySnapshot: "operator_incident",
        interruptionGracePerIncidentSecondsSnapshot: null,
        interruptionGracePerAttemptSecondsSnapshot: null,
      }),
    ).toEqual({
      schemaVersion: 1,
      policy: "operator_incident",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    });
  });

  it("preserves null caps", async () => {
    const { projectAttemptTimingPolicySnapshot } = await import("../types.js");
    const result = projectAttemptTimingPolicySnapshot({
      interruptionPolicySnapshotVersion: 1,
      interruptionTimePolicySnapshot: "strict",
      interruptionGracePerIncidentSecondsSnapshot: null,
      interruptionGracePerAttemptSecondsSnapshot: null,
    });
    expect(result.perIncidentCapSeconds).toBeNull();
    expect(result.perAttemptAggregateCapSeconds).toBeNull();
  });

  it("preserves non-null caps", async () => {
    const { projectAttemptTimingPolicySnapshot } = await import("../types.js");
    const result = projectAttemptTimingPolicySnapshot({
      interruptionPolicySnapshotVersion: 1,
      interruptionTimePolicySnapshot: "bounded_grace",
      interruptionGracePerIncidentSecondsSnapshot: 120,
      interruptionGracePerAttemptSecondsSnapshot: 300,
    });
    expect(result.perIncidentCapSeconds).toBe(120);
    expect(result.perAttemptAggregateCapSeconds).toBe(300);
  });

  it("always sets schemaVersion to 1", async () => {
    const { projectAttemptTimingPolicySnapshot } = await import("../types.js");
    const result = projectAttemptTimingPolicySnapshot({
      interruptionPolicySnapshotVersion: 1,
      interruptionTimePolicySnapshot: "strict",
      interruptionGracePerIncidentSecondsSnapshot: null,
      interruptionGracePerAttemptSecondsSnapshot: null,
    });
    expect(result.schemaVersion).toBe(1);
  });
});
