import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { mutateWithAuthorityInvariants } from "./adminMaintainerExclusion.js";
import { mutateWithEffectiveAdminPostcondition } from "./adminInvariant.js";
import type { AssignableRole } from "@exam/db/src/schema/pg.js";

/**
 * P7-E2A (ADR-017 D14) — ADMIN / MAINTAINER MUTUAL EXCLUSION.
 *
 * No human actor may hold active Admin + active Maintainer assignments at the
 * same time. The invariant is enforced as a transaction post-condition under
 * the organization advisory lock by the canonical authority-mutation seam.
 */
describe("Admin ↔ Maintainer mutual exclusion", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let ctx: TenantContext;

  beforeAll(async () => {
    const handle = await getIsolatedTestDb("admin-maintainer-exclusion");
    db = handle.db;
    cleanup = handle.cleanup;
  });

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
  });

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

  async function violationsFor(org: TenantContext) {
    return createUserRoleAssignmentRepo(
      db,
    ).findAdminMaintainerExclusionViolations(org);
  }

  it("allows a standalone Maintainer assignment", async () => {
    await createUser("standalone-maintainer", "Maintainer");
    expect(await violationsFor(ctx)).toEqual([]);
  });

  it("rejects adding a Maintainer assignment to an actor with active Admin", async () => {
    const { user } = await createUser("admin-actor", "Admin");

    await expect(
      mutateWithAuthorityInvariants(db, ctx, async (tx) => {
        await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
          tx,
          ctx,
          {
            userId: user.id,
            role: "Maintainer",
            isPrimary: false,
            isActive: true,
          },
        );
      }),
    ).rejects.toMatchObject({
      details: { reason: "ADMIN_MAINTAINER_EXCLUSION" },
    });

    // Nothing committed: the actor still holds only Admin.
    const rows = await createUserRoleAssignmentRepo(db).listForUser(
      ctx,
      user.id,
    );
    expect(rows.filter((r) => r.isActive).map((r) => r.role)).toEqual([
      "Admin",
    ]);
    expect(await violationsFor(ctx)).toEqual([]);
  });

  it("rejects adding an Admin assignment to an actor with active Maintainer", async () => {
    const { user } = await createUser("maintainer-actor", "Maintainer");

    await expect(
      mutateWithAuthorityInvariants(db, ctx, async (tx) => {
        await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
          tx,
          ctx,
          {
            userId: user.id,
            role: "Admin",
            isPrimary: false,
            isActive: true,
          },
        );
      }),
    ).rejects.toMatchObject({
      details: { reason: "ADMIN_MAINTAINER_EXCLUSION" },
    });

    const rows = await createUserRoleAssignmentRepo(db).listForUser(
      ctx,
      user.id,
    );
    expect(rows.filter((r) => r.isActive).map((r) => r.role)).toEqual([
      "Maintainer",
    ]);
  });

  it("rejects promoting an Admin assignment for an actor with active Maintainer", async () => {
    // Legal starting state per D14: Teacher primary + Maintainer secondary
    // (Maintainer may combine with any non-Admin role). Promoting the
    // Teacher primary to Admin would leave active Admin + active Maintainer
    // for the same actor — the seam must reject it before commit.
    const { user } = await createUser("promote-race", "Teacher");
    const assignmentRepo = createUserRoleAssignmentRepo(db);
    await assignmentRepo.assign(ctx, {
      userId: user.id,
      role: "Maintainer",
      isPrimary: false,
      isActive: true,
    });

    await expect(
      mutateWithAuthorityInvariants(db, ctx, async (tx) => {
        await createUserRoleAssignmentRepo(
          tx,
        ).replacePrimaryRoleWithinTransaction(tx, ctx, {
          userId: user.id,
          role: "Admin",
        });
      }),
    ).rejects.toMatchObject({
      details: { reason: "ADMIN_MAINTAINER_EXCLUSION" },
    });

    // The replacement did not commit: Teacher stays primary, Maintainer
    // secondary remains, no Admin exists.
    const rows = await assignmentRepo.listForUser(ctx, user.id);
    expect(
      rows
        .filter((r) => r.isActive)
        .map((r) => r.role)
        .sort(),
    ).toEqual(["Maintainer", "Teacher"]);
    expect(await violationsFor(ctx)).toEqual([]);
  });

  it("rejects any authority mutation while a violation exists (backfill guard)", async () => {
    // Simulate a pre-existing violation written outside the seam (a backfill
    // mistake / hand-edited row): Admin primary + Maintainer secondary for
    // the same actor. The seam's post-condition must refuse to commit ANY
    // authority mutation until the violation is repaired.
    const { user, assignment } = await createUser("backfill-admin", "Admin");
    await db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: user.id,
      role: "Maintainer",
      isPrimary: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await violationsFor(ctx)).toHaveLength(1);

    await expect(
      mutateWithAuthorityInvariants(db, ctx, async (tx) => {
        // A harmless, unrelated authority mutation (e.g. assigning a role to
        // a DIFFERENT user) must also fail while the violation exists.
        await createUserRepo(tx).update(ctx, user.id, { name: "renamed" });
        void assignment;
      }),
    ).rejects.toMatchObject({
      details: { reason: "ADMIN_MAINTAINER_EXCLUSION" },
    });

    // The mutation did not commit.
    const row = await createUserRepo(db).findByOrganizationAndId(ctx, user.id);
    expect(row?.name).toBe("Test backfill-admin");
  });

  it("allows Maintainer combined with a non-Admin role (D14 scope)", async () => {
    const { user } = await createUser("maintainer-teacher", "Maintainer");

    await mutateWithAuthorityInvariants(db, ctx, async (tx) => {
      await createUserRoleAssignmentRepo(tx).assignWithinTransaction(tx, ctx, {
        userId: user.id,
        role: "Teacher",
        isPrimary: false,
        isActive: true,
      });
    });

    const rows = await createUserRoleAssignmentRepo(db).listForUser(
      ctx,
      user.id,
    );
    expect(
      rows
        .filter((r) => r.isActive)
        .map((r) => r.role)
        .sort(),
    ).toEqual(["Maintainer", "Teacher"]);
    expect(await violationsFor(ctx)).toEqual([]);
  });

  it("serializes concurrent Admin + Maintainer assignment races (write-skew)", async () => {
    // A brand-new actor with no active assignments. Two concurrent authority
    // mutations race: one adds Admin (primary), the other adds Maintainer
    // (primary). The shared org advisory lock serializes them; the second
    // transaction's post-condition must observe the first commit and reject.
    const userRepo = createUserRepo(db);
    const actor = await userRepo.create(ctx, {
      username: `race-actor-${randomUUID().slice(0, 8)}`,
      passwordHash: await hashPassword("password123"),
      name: "Race Actor",
      role: "Candidate",
      isActive: true,
    });

    const results = await Promise.allSettled([
      mutateWithAuthorityInvariants(db, ctx, async (tx) => {
        await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
          tx,
          ctx,
          {
            userId: actor.id,
            role: "Admin",
            isPrimary: true,
            isActive: true,
          },
        );
      }),
      mutateWithAuthorityInvariants(db, ctx, async (tx) => {
        await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
          tx,
          ctx,
          {
            userId: actor.id,
            role: "Maintainer",
            isPrimary: true,
            isActive: true,
          },
        );
      }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    expect(succeeded).toBe(1);
    expect(rejected).toBe(1);
    expect(await violationsFor(ctx)).toEqual([]);

    const rows = await createUserRoleAssignmentRepo(db).listForUser(
      ctx,
      actor.id,
    );
    expect(rows.filter((r) => r.isActive).map((r) => r.role)).toEqual([
      "Admin",
    ]);
  });

  it("shares the fence with the effective-Admin seam (mixed races)", async () => {
    // One transaction promotes a Candidate to Admin; the other adds a
    // Maintainer primary for the same actor. Different seams, same lock.
    const userRepo = createUserRepo(db);
    const actor = await userRepo.create(ctx, {
      username: `mixed-race-${randomUUID().slice(0, 8)}`,
      passwordHash: await hashPassword("password123"),
      name: "Mixed Race",
      role: "Candidate",
      isActive: true,
    });
    await createUserRoleAssignmentRepo(db).assign(ctx, {
      userId: actor.id,
      role: "Candidate",
      isPrimary: true,
      isActive: true,
    });

    const results = await Promise.allSettled([
      mutateWithEffectiveAdminPostcondition(db, ctx, async (tx) => {
        await createUserRoleAssignmentRepo(
          tx,
        ).replacePrimaryRoleWithinTransaction(tx, ctx, {
          userId: actor.id,
          role: "Admin",
        });
      }),
      mutateWithAuthorityInvariants(db, ctx, async (tx) => {
        await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
          tx,
          ctx,
          {
            userId: actor.id,
            role: "Maintainer",
            isPrimary: true,
            isActive: true,
          },
        );
      }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    // Both orderings are legal outcomes, but the invariant must hold in every
    // one: either T1 committed first (Admin active, T2's post-condition
    // rejects) or T2 committed first (Maintainer primary; T1's replacement
    // deactivates it, leaving Admin only — legal, no violation).
    expect(succeeded + rejected).toBe(2);
    expect(await violationsFor(ctx)).toEqual([]);

    const rows = await createUserRoleAssignmentRepo(db).listForUser(
      ctx,
      actor.id,
    );
    const activeRoles = rows.filter((r) => r.isActive).map((r) => r.role);
    const hasAdmin = activeRoles.includes("Admin");
    const hasMaintainer = activeRoles.includes("Maintainer");
    // Admin ∩ Maintainer = ∅ — never both, no matter which race won.
    expect(hasAdmin && hasMaintainer).toBe(false);
    expect(activeRoles.length).toBeGreaterThan(0);
  });
});
