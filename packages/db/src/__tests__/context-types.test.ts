import { describe, expect, it } from "vitest";
import type {
  AnyDatabase,
  AuthLookupContext,
  PlatformContext,
  RepoContext,
  SqliteDatabase,
  TenantContext,
} from "../types.js";
import { isPlatformContext, isSqlite, isTenantContext } from "../types.js";
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
        role: "SuperAdmin",
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
        role: "SuperAdmin",
        permissions: ["MANAGE_ORGANIZATION"],
      };
      expect(ctx.actorId).toBe("user-1");
    });

    it("accepts optional targetOrganizationId", () => {
      const ctx: PlatformContext = {
        actorId: "user-1",
        role: "SuperAdmin",
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
      role: "SuperAdmin",
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
      role: "SuperAdmin",
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

describe("A01: isSqlite type guard", () => {
  it("narrows AnyDatabase to SqliteDatabase", () => {
    const db = { all: () => [] } as unknown as AnyDatabase;
    expect(isSqlite(db)).toBe(true);
    if (isSqlite(db)) {
      const _typed: SqliteDatabase = db;
      expect(_typed).toBeDefined();
    }
  });

  it("returns false for PG-like databases", () => {
    const db = {} as unknown as AnyDatabase;
    expect(isSqlite(db)).toBe(false);
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
  it("resolveOrganizationId throws for SuperAdmin without targetOrganizationId", async () => {
    const { resolveOrganizationId } = await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "super",
      role: "SuperAdmin",
      permissions: [],
    };
    expect(() => resolveOrganizationId(ctx)).toThrow();
  });

  it("resolveOrganizationId returns targetOrganizationId for SuperAdmin", async () => {
    const { resolveOrganizationId } = await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "super",
      role: "SuperAdmin",
      permissions: [],
      targetOrganizationId: "org-2",
    };
    expect(resolveOrganizationId(ctx)).toBe("org-2");
  });

  it("resolveOrganizationId returns organizationId for non-SuperAdmin", async () => {
    const { resolveOrganizationId } = await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "admin",
      role: "Admin",
      permissions: [],
    };
    expect(resolveOrganizationId(ctx)).toBe("org-1");
  });

  it("resolveOptionalOrganizationId falls back for SuperAdmin", async () => {
    const { resolveOptionalOrganizationId } =
      await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "super",
      role: "SuperAdmin",
      permissions: [],
    };
    expect(resolveOptionalOrganizationId(ctx)).toBe("org-1");
  });

  it("resolveOptionalOrganizationId uses target when present", async () => {
    const { resolveOptionalOrganizationId } =
      await import("../repository/baseRepo.js");
    const ctx: TenantContext = {
      organizationId: "org-1",
      actorId: "super",
      role: "SuperAdmin",
      permissions: [],
      targetOrganizationId: "org-2",
    };
    expect(resolveOptionalOrganizationId(ctx)).toBe("org-2");
  });
});
