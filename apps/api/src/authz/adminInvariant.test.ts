import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { mutateWithEffectiveAdminPostcondition } from "./adminInvariant.js";
import type { AssignableRole } from "@exam/db/src/schema/pg.js";

describe("mutateWithEffectiveAdminPostcondition", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let ctx: TenantContext;

  beforeAll(async () => {
    const handle = await getIsolatedTestDb("admin-invariant");
    db = handle.db;
    cleanup = handle.cleanup;
  }, 30_000);

  beforeEach(async () => {
    orgId = randomUUID();
    await db.insert(schema.organizations).values({
      id: orgId,
      name: "Test Org",
      displayName: "Test Org",
      slug: `test-org-${orgId.slice(0, 8)}-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ctx = {
      organizationId: orgId,
      actorId: "test",
      role: "Admin",
      permissions: [],
    };
  });

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  async function createUser(
    username: string,
    role: AssignableRole,
    options: {
      isPrimary?: boolean;
      isActive?: boolean;
      isActiveUser?: boolean;
    } = {},
  ) {
    const userRepo = createUserRepo(db);
    const assignmentRepo = createUserRoleAssignmentRepo(db);
    const user = await userRepo.create(ctx, {
      username: `${username}-${randomUUID().slice(0, 8)}`,
      passwordHash: await hashPassword("password123"),
      name: `Test ${username}`,
      role,
      isActive: options.isActiveUser ?? true,
    });
    const assignment = await assignmentRepo.assign(ctx, {
      userId: user.id,
      role,
      isPrimary: options.isPrimary ?? true,
      isActive: options.isActive ?? true,
    });
    return { user, assignment };
  }

  async function effectiveAdminCount(): Promise<number> {
    return createUserRepo(db).countEffectiveActiveUsersWithRole(ctx, "Admin");
  }

  it("allows disabling a user when another effective Admin exists", async () => {
    const { user: a } = await createUser("admin-a", "Admin");
    const { user: b } = await createUser("admin-b", "Admin");

    await mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
      await createUserRepo(tx).update(ctx, b.id, { isActive: false });
    });

    expect(await effectiveAdminCount()).toBe(1);
    const remaining = await createUserRepo(db).findByOrganizationAndId(
      ctx,
      a.id,
    );
    expect(remaining?.isActive).toBe(true);
  });

  it("rejects disabling the last effective Admin user", async () => {
    const { user: only } = await createUser("only-admin", "Admin");

    await expect(
      mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
        await createUserRepo(tx).update(ctx, only.id, { isActive: false });
      }),
    ).rejects.toMatchObject({
      details: { reason: "LAST_ACTIVE_ADMIN" },
    });

    expect(await effectiveAdminCount()).toBe(1);
  });

  it("rejects deleting the last effective Admin user", async () => {
    const { user: only } = await createUser("del-only-admin", "Admin");

    await expect(
      mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
        await createUserRepo(tx).delete(ctx, only.id);
      }),
    ).rejects.toMatchObject({
      details: { reason: "LAST_ACTIVE_ADMIN" },
    });

    expect(await effectiveAdminCount()).toBe(1);
  });

  it("rejects deactivating the last active Admin assignment", async () => {
    const { assignment } = await createUser("deact-only-admin", "Admin");

    await expect(
      mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
        await tx
          .update(schema.userRoleAssignments)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.userRoleAssignments.id, assignment.id));
      }),
    ).rejects.toMatchObject({
      details: { reason: "LAST_ACTIVE_ADMIN" },
    });

    expect(await effectiveAdminCount()).toBe(1);
  });

  it("rejects deleting the last active Admin assignment", async () => {
    const { assignment } = await createUser("remove-only-admin", "Admin");

    await expect(
      mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
        await tx
          .delete(schema.userRoleAssignments)
          .where(eq(schema.userRoleAssignments.id, assignment.id));
      }),
    ).rejects.toMatchObject({
      details: { reason: "LAST_ACTIVE_ADMIN" },
    });

    expect(await effectiveAdminCount()).toBe(1);
  });

  it("counts a secondary active Admin assignment as effective Admin", async () => {
    const { user: a } = await createUser("primary-admin", "Admin");
    const { user: b } = await createUser("secondary-admin", "Candidate");
    await createUserRoleAssignmentRepo(db).assign(ctx, {
      userId: b.id,
      role: "Admin",
      isPrimary: false,
      isActive: true,
    });

    await mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
      await createUserRepo(tx).update(ctx, a.id, { isActive: false });
    });

    expect(await effectiveAdminCount()).toBe(1);
  });

  it("serializes concurrent attempts to remove the last two Admins", async () => {
    const { user: a } = await createUser("concurrent-a", "Admin");
    const { user: b } = await createUser("concurrent-b", "Admin");

    const results = await Promise.allSettled([
      mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
        await createUserRepo(tx).update(ctx, a.id, { isActive: false });
      }),
      mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
        await createUserRepo(tx).update(ctx, b.id, { isActive: false });
      }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    expect(succeeded).toBe(1);
    expect(rejected).toBe(1);
    expect(await effectiveAdminCount()).toBe(1);
  });
});
