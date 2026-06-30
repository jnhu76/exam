import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { schema } from "../schema/pg.js";
import { createUserRoleAssignmentRepo } from "./userRoleAssignmentRepo.js";
import type { Database } from "../types.js";

function createContext(orgId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId: orgId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
    targetOrganizationId: orgId,
  };
}

async function seedOrgAndUser(
  db: Database,
  username: string,
): Promise<{ orgId: string; userId: string; ctx: RequestContext }> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const now = new Date();
  await db.insert(schema.organizations).values({
    id: orgId,
    name: "Test",
    displayName: "Test",
    slug: `test-${orgId.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username,
    passwordHash: "x",
    name: username,
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { orgId, userId, ctx: createContext(orgId) };
}

describe("RBAC-M7 userRoleAssignmentRepo", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await getIsolatedTestDb("userroleassign");
    db = iso.db;
    cleanup = iso.cleanup;
  });
  afterAll(async () => {
    await cleanup();
  });

  it("assigns a role and lists it for the user", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "alice");
    const repo = createUserRoleAssignmentRepo(db);
    const a = await repo.assign(ctx, {
      userId,
      role: "Teacher",
      isPrimary: true,
    });
    expect(a.role).toBe("Teacher");
    expect(a.isPrimary).toBe(true);
    const list = await repo.listForUser(ctx, userId);
    expect(list).toHaveLength(1);
    expect(list[0]!.role).toBe("Teacher");
  });

  it("enforces <=1 primary active assignment per user (demotes prior primary)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "bob");
    const repo = createUserRoleAssignmentRepo(db);
    const first = await repo.assign(ctx, {
      userId,
      role: "Candidate",
      isPrimary: true,
    });
    const second = await repo.assign(ctx, {
      userId,
      role: "Grader",
      isPrimary: true,
    });
    const primary = await repo.findPrimaryActiveForUser(ctx, userId);
    expect(primary?.id).toBe(second.id);
    // The first assignment was demoted.
    const list = await repo.listForUser(ctx, userId);
    const firstRow = list.find((r) => r.id === first.id);
    expect(firstRow?.isPrimary).toBe(false);
  });

  it("allows multiple non-primary (secondary) role assignments", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "carol");
    const repo = createUserRoleAssignmentRepo(db);
    await repo.assign(ctx, { userId, role: "Candidate", isPrimary: true });
    await repo.assign(ctx, { userId, role: "Proctor", isPrimary: false });
    await repo.assign(ctx, { userId, role: "Grader", isPrimary: false });
    const list = await repo.listForUser(ctx, userId);
    expect(list.filter((r) => !r.isPrimary)).toHaveLength(2);
    expect(await repo.findPrimaryActiveForUser(ctx, userId)).toMatchObject({
      role: "Candidate",
    });
  });

  it("setPrimary promotes a target and demotes the prior primary", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "dave");
    const repo = createUserRoleAssignmentRepo(db);
    const first = await repo.assign(ctx, {
      userId,
      role: "Candidate",
      isPrimary: true,
    });
    const second = await repo.assign(ctx, {
      userId,
      role: "Teacher",
      isPrimary: false,
    });
    const promoted = await repo.setPrimary(ctx, second.id);
    expect(promoted?.isPrimary).toBe(true);
    const list = await repo.listForUser(ctx, userId);
    expect(list.find((r) => r.id === first.id)?.isPrimary).toBe(false);
    expect(list.find((r) => r.id === second.id)?.isPrimary).toBe(true);
  });

  it("deactivate + remove behave as expected", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "eve");
    const repo = createUserRoleAssignmentRepo(db);
    const a = await repo.assign(ctx, {
      userId,
      role: "Proctor",
      isPrimary: true,
    });
    const deactivated = await repo.deactivate(ctx, a.id);
    expect(deactivated?.isActive).toBe(false);
    await repo.remove(ctx, a.id);
    expect(await repo.listForUser(ctx, userId)).toHaveLength(0);
  });

  it("rejects a non-assignable role at the DB CHECK boundary", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "frank");
    const repo = createUserRoleAssignmentRepo(db);
    // System/SuperAdmin are not in the assignable set; the DB CHECK rejects.
    await expect(
      repo.assign(ctx, { userId, role: "System" as never }),
    ).rejects.toThrow();
  });
});
