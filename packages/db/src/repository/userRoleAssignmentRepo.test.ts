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
  }, 30_000);
  afterAll(async () => {
    await cleanup();
  }, 30_000);

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

  it("auto-promotes the next active assignment when the primary is deactivated (review #7)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "grace");
    const repo = createUserRoleAssignmentRepo(db);
    const primary = await repo.assign(ctx, {
      userId,
      role: "Candidate",
      isPrimary: true,
    });
    const secondary = await repo.assign(ctx, {
      userId,
      role: "Grader",
      isPrimary: false,
    });
    await repo.deactivate(ctx, primary.id);
    const newPrimary = await repo.findPrimaryActiveForUser(ctx, userId);
    expect(newPrimary?.id).toBe(secondary.id);
    expect(newPrimary?.role).toBe("Grader");
  });

  it("activate is idempotent: re-activating an already-active primary never self-demotes (P7-E review P1)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "idem-active");
    const repo = createUserRoleAssignmentRepo(db);
    const primary = await repo.assign(ctx, {
      userId,
      role: "Candidate",
      isPrimary: true,
    });
    // No-op reactivation of the ACTIVE primary: must stay primary. (The old
    // demote-other-active-primaries query did not exclude the target row and
    // demoted the very assignment being activated — orphaning authority.)
    const again = await repo.activate(ctx, primary.id);
    expect(again).toMatchObject({ isActive: true, isPrimary: true });
    expect((await repo.findPrimaryActiveForUser(ctx, userId))?.id).toBe(
      primary.id,
    );
  });

  it("auto-promotes the next active assignment when the primary is removed (review #7)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "heidi");
    const repo = createUserRoleAssignmentRepo(db);
    const primary = await repo.assign(ctx, {
      userId,
      role: "Candidate",
      isPrimary: true,
    });
    const secondary = await repo.assign(ctx, {
      userId,
      role: "Proctor",
      isPrimary: false,
    });
    const removed = await repo.remove(ctx, primary.id);
    expect(removed?.isPrimary).toBe(true);
    const newPrimary = await repo.findPrimaryActiveForUser(ctx, userId);
    expect(newPrimary?.id).toBe(secondary.id);
    expect(newPrimary?.role).toBe("Proctor");
  });

  it("leaves zero primaries when the only primary is removed and no other active exists (review #7 edge)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "ivan");
    const repo = createUserRoleAssignmentRepo(db);
    const primary = await repo.assign(ctx, {
      userId,
      role: "Candidate",
      isPrimary: true,
    });
    await repo.remove(ctx, primary.id);
    expect(await repo.findPrimaryActiveForUser(ctx, userId)).toBeNull();
  });

  describe("listActiveForUser (RBAC-M10-E)", () => {
    it("returns only ACTIVE assignments, excluding inactive rows", async () => {
      const { userId, ctx } = await seedOrgAndUser(db, "kara");
      const repo = createUserRoleAssignmentRepo(db);
      const active1 = await repo.assign(ctx, {
        userId,
        role: "Candidate",
        isPrimary: true,
      });
      const active2 = await repo.assign(ctx, {
        userId,
        role: "Teacher",
        isPrimary: false,
      });
      const inactive = await repo.assign(ctx, {
        userId,
        role: "Grader",
        isPrimary: false,
        isActive: false,
      });
      const activeRows = await repo.listActiveForUser(ctx, userId);
      const activeIds = new Set(activeRows.map((r) => r.id));
      expect(activeRows).toHaveLength(2);
      expect(activeIds.has(active1.id)).toBe(true);
      expect(activeIds.has(active2.id)).toBe(true);
      expect(activeIds.has(inactive.id)).toBe(false);
      expect(activeRows.every((r) => r.isActive)).toBe(true);
    });

    it("returns the FULL active set (no .limit(1)) so multi-primary corruption is observable", async () => {
      const { userId, ctx } = await seedOrgAndUser(db, "leo");
      const repo = createUserRoleAssignmentRepo(db);
      await repo.assign(ctx, { userId, role: "Candidate", isPrimary: true });
      await repo.assign(ctx, { userId, role: "Teacher", isPrimary: false });
      await repo.assign(ctx, { userId, role: "Grader", isPrimary: false });
      const activeRows = await repo.listActiveForUser(ctx, userId);
      expect(activeRows).toHaveLength(3);
    });

    it("is scoped to ctx's organization (does not leak cross-org rows)", async () => {
      const a = await seedOrgAndUser(db, "mia-org-a");
      const b = await seedOrgAndUser(db, "noah-org-b");
      const repo = createUserRoleAssignmentRepo(db);
      await repo.assign(a.ctx, {
        userId: a.userId,
        role: "Candidate",
        isPrimary: true,
      });
      await repo.assign(b.ctx, {
        userId: b.userId,
        role: "Admin",
        isPrimary: true,
      });
      const seenForA = await repo.listActiveForUser(a.ctx, a.userId);
      const seenForB = await repo.listActiveForUser(a.ctx, b.userId);
      expect(seenForA).toHaveLength(1);
      expect(seenForA[0]!.role).toBe("Candidate");
      expect(seenForB).toHaveLength(0);
    });

    it("returns rows ordered by createdAt (deterministic)", async () => {
      const { userId, ctx } = await seedOrgAndUser(db, "oscar");
      const repo = createUserRoleAssignmentRepo(db);
      await repo.assign(ctx, { userId, role: "Candidate", isPrimary: true });
      await new Promise((r) => setTimeout(r, 5));
      await repo.assign(ctx, { userId, role: "Teacher", isPrimary: false });
      const activeRows = await repo.listActiveForUser(ctx, userId);
      expect(activeRows.map((r) => r.role)).toEqual(["Candidate", "Teacher"]);
    });
  });

  describe("RBAC-M10-E migration 0015 + invariant primitives", () => {
    /**
     * The isolated test DB has ALL migrations applied (0000..0015), so the
     * partial unique index `user_role_assignments_active_primary_unique`
     * exists. These tests prove the index enforces ≤1 active primary per
     * (org, user) at the DB (E12-A) and that ensurePrimaryAssignment is the
     * invariant-aware primitive that keeps the index satisfiable.
     */
    it("the partial unique index rejects a second active primary at the DB (23505)", async () => {
      const { userId, ctx } = await seedOrgAndUser(db, "paula");
      const repo = createUserRoleAssignmentRepo(db);
      // Establish one legitimate active primary via the repo (demotes correctly).
      await repo.assign(ctx, {
        userId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
      });
      // Bypass the repo and attempt a direct second active primary insert.
      // The migration-created partial unique index must reject this.
      let caught: unknown;
      try {
        await db.insert(schema.userRoleAssignments).values({
          id: randomUUID(),
          organizationId: ctx.organizationId,
          userId,
          role: "Teacher",
          isPrimary: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (err) {
        caught = err;
      }
      expect(
        caught,
        "second active primary insert should have been rejected",
      ).toBeDefined();
      // postgres.js wraps the driver error; the constraint name and SQLSTATE
      // live on the error object. Match either the constraint name or 23505.
      const errStr = JSON.stringify(caught ?? "");
      expect(errStr).toMatch(
        /user_role_assignments_active_primary_unique|23505/,
      );
    });

    it("ensurePrimaryAssignment demotes an existing active primary instead of colliding", async () => {
      // The seed/demo-seed replacement: a user whose primary was since
      // changed must not trigger a second-active-primary insert.
      const { userId, ctx } = await seedOrgAndUser(db, "quinn");
      const repo = createUserRoleAssignmentRepo(db);
      await repo.assign(ctx, {
        userId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
      });
      // Now make Teacher the primary via ensurePrimaryAssignment.
      const result = await repo.ensurePrimaryAssignment(ctx, {
        userId,
        role: "Teacher",
      });
      expect(result.role).toBe("Teacher");
      expect(result.isPrimary).toBe(true);
      expect(result.isActive).toBe(true);
      // Exactly one active primary remains.
      const active = await repo.listActiveForUser(ctx, userId);
      // The existing Candidate assignment must remain active but demoted.
      const candidateAssignment = active.find((r) => r.role === "Candidate");
      expect(candidateAssignment).toBeDefined();
      expect(candidateAssignment?.isPrimary).toBe(false);
      const primaries = active.filter((r) => r.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0]!.role).toBe("Teacher");
    });

    it("ensurePrimaryAssignment re-activates an existing (org,user,role) row in place", async () => {
      const { userId, ctx } = await seedOrgAndUser(db, "ruth");
      const repo = createUserRoleAssignmentRepo(db);
      // Pre-existing Teacher row, currently inactive non-primary.
      const existing = await repo.assign(ctx, {
        userId,
        role: "Teacher",
        isPrimary: false,
        isActive: false,
      });
      const result = await repo.ensurePrimaryAssignment(ctx, {
        userId,
        role: "Teacher",
      });
      // The existing row was promoted in place — no duplicate insert.
      expect(result.id).toBe(existing.id);
      const active = await repo.listActiveForUser(ctx, userId);
      expect(active).toHaveLength(1);
      expect(active[0]!.role).toBe("Teacher");
      expect(active[0]!.isPrimary).toBe(true);
      expect(active[0]!.id).toBe(result.id);
    });
  });
});
