import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import userRoutes from "./user.js";
import roleAssignmentRoutes from "./roleAssignments.js";
import { buildTestApp } from "./testHelpers.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { and, eq } from "drizzle-orm";
import type { Database } from "@exam/db/src/types.js";
import { ValidationError } from "@exam/domain";
import * as adminInvariantModule from "../authz/adminInvariant.js";

async function createTargetUser(
  db: Database,
  orgId: string,
  username: string,
  role: "Admin" | "Candidate" = "Candidate",
) {
  // worker-database isolation does not reset between runs; keep usernames unique.
  username = `${username}-${crypto.randomUUID().slice(0, 8)}`;
  const rows = await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      username,
      passwordHash: await hashPassword("password123"),
      name: `User ${username}`,
      role,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return rows[0]!;
}

async function createPrimaryAssignment(
  db: Database,
  orgId: string,
  userId: string,
  role: string,
) {
  const rows = await db
    .insert(schema.userRoleAssignments)
    .values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      userId,
      role: role as never,
      isPrimary: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return rows[0]!;
}

describe("RBAC-M8 role-assignment routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    // Register both plugins so assignment routes + user lookup coexist.
    // buildTestApp applies the outer /api prefix; register without an inner prefix.
    ctx = await buildTestApp(async (app) => {
      await app.register(userRoutes);
      await app.register(roleAssignmentRoutes);
    });
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/roles/assignable lists the 5 human roles", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/roles/assignable",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const keys = res
      .json()
      .items.map((i: { key: string }) => i.key)
      .sort();
    expect(keys).toEqual(
      [
        "Admin",
        "Candidate",
        "Grader",
        "Maintainer",
        "Proctor",
        "Teacher",
      ].sort(),
    );
  });

  it("POST a primary assignment syncs users.role to the new role", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "sync-target");
    await createPrimaryAssignment(ctx.db, ctx.org.id, target.id, "Candidate");

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Teacher", isPrimary: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().isPrimary).toBe(true);

    // The core RBAC-M8 invariant: users.role cache now reflects the primary.
    const userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Teacher");
  });

  it("POST a secondary assignment does NOT change users.role", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "secondary-only");
    await createPrimaryAssignment(ctx.db, ctx.org.id, target.id, "Candidate");

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Proctor", isPrimary: false },
    });
    expect(res.statusCode).toBe(201);
    const userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Candidate");
  });

  it("GET /api/users/:id/role-assignments lists assignments", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "list-target");
    await createPrimaryAssignment(ctx.db, ctx.org.id, target.id, "Candidate");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH setPrimary promotes + syncs users.role", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "promote-target");
    await createPrimaryAssignment(ctx.db, ctx.org.id, target.id, "Candidate");

    // First add a secondary Grader assignment.
    const addRes = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Grader", isPrimary: false },
    });
    const graderAssignmentId = addRes.json().id;

    // Promote it to primary.
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${graderAssignmentId}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isPrimary: true },
    });
    expect(res.statusCode).toBe(200);
    const userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Grader");
  });

  it("PATCH activate reactivates a deactivated secondary assignment (users.role unchanged)", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "activate-sec");
    await createPrimaryAssignment(ctx.db, ctx.org.id, target.id, "Candidate");
    // Add a secondary Grader assignment.
    const addRes = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Grader", isPrimary: false },
    });
    const graderId = addRes.json().id;

    // Deactivate it (secondary deactivation is not an authority change).
    const deact = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${graderId}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: false },
    });
    expect(deact.statusCode).toBe(200);
    expect(deact.json().isActive).toBe(false);

    // Reactivate it through the PATCH surface (contract: { isActive: true }).
    const react = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${graderId}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: true },
    });
    expect(react.statusCode).toBe(200);
    expect(react.json().isActive).toBe(true);
    expect(react.json().isPrimary).toBe(false);

    // A secondary activation never changes users.role.
    const userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Candidate");
  });

  it("PATCH activate of a deactivated PRIMARY restores it as the active primary (users.role synced)", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "activate-prim");
    const prim = await createPrimaryAssignment(
      ctx.db,
      ctx.org.id,
      target.id,
      "Candidate",
    );
    const addRes = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Grader", isPrimary: false },
    });
    const graderId = addRes.json().id;

    // Deactivate the primary Candidate → Grader auto-promotes.
    const deact = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${prim.id}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: false },
    });
    expect(deact.statusCode).toBe(200);
    let userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Grader");

    // Reactivate the deactivated primary Candidate: it demotes the promoted
    // Grader and becomes the active primary authority again.
    const react = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${prim.id}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: true },
    });
    expect(react.statusCode).toBe(200);
    expect(react.json().isActive).toBe(true);
    expect(react.json().isPrimary).toBe(true);
    userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Candidate");

    // The Grader assignment survives as a secondary active assignment.
    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const graderRow = listRes
      .json()
      .items.find(
        (i: { role: string; isPrimary: boolean }) =>
          i.role === "Grader" && !i.isPrimary,
      );
    expect(graderRow.isActive).toBe(true);
    expect(graderRow.id).toBe(graderId);
  });

  it("PATCH activate of an already-active primary is IDEMPOTENT: repeated { isActive: true } never self-demotes (P7-E review P1)", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "idem-active");
    const prim = await createPrimaryAssignment(
      ctx.db,
      ctx.org.id,
      target.id,
      "Candidate",
    );

    // First PATCH on the already-active primary.
    const first = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${prim.id}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: true },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ isActive: true, isPrimary: true });

    // Repeated PATCH must be a no-op — NOT a self-demote that leaves an
    // active-but-primaryless authority behind.
    const second = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${prim.id}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: true },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ isActive: true, isPrimary: true });

    // users.role cache untouched (still the assignment role).
    const userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Candidate");

    // Exactly one active primary remains.
    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const activePrimaries = listRes
      .json()
      .items.filter(
        (i: { isPrimary: boolean; isActive: boolean }) =>
          i.isPrimary && i.isActive,
      );
    expect(activePrimaries).toHaveLength(1);
    expect(activePrimaries[0]!.id).toBe(prim.id);
  });

  it("PATCH activate audit truthfulness: a genuine reactivation writes role_changed; an already-active re-activation writes NONE (P7-E review P2-1)", async () => {
    const target = await createTargetUser(
      ctx.db,
      ctx.org.id,
      "audit-truth-activate",
    );
    const prim = await createPrimaryAssignment(
      ctx.db,
      ctx.org.id,
      target.id,
      "Candidate",
    );
    // A secondary keeps deactivating the primary a valid, non-last-admin move.
    await ctx.app.inject({
      method: "POST",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Grader", isPrimary: false },
    });

    // Count role_changed audits targeting this user (robust to setup noise —
    // the POST above may add its own; only the activation deltas matter).
    const countRoleChanged = async (): Promise<number> => {
      const rows = await ctx.db
        .select({ id: schema.auditLogs.id })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, "user.role_changed"),
            eq(schema.auditLogs.targetType, "user"),
            eq(schema.auditLogs.targetId, target.id),
          ),
        );
      return rows.length;
    };

    // Deactivate the primary Candidate so the next activate is a GENUINE
    // inactive→active transition (Grader auto-promotes here).
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${prim.id}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: false },
    });
    const beforeActivate = await countRoleChanged();

    // Genuine reactivation → exactly ONE more role_changed audit.
    const react = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${prim.id}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: true },
    });
    expect(react.statusCode).toBe(200);
    expect(await countRoleChanged()).toBe(beforeActivate + 1);

    // Consecutive idempotent re-activation (already active) → NO new
    // role_changed audit and NO state change. This is the P2-1 contract: a
    // no-op command must not fabricate a state-change audit.
    const second = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${prim.id}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isActive: true },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ isActive: true, isPrimary: true });
    expect(
      await countRoleChanged(),
      "idempotent re-activation must not add a role_changed audit",
    ).toBe(beforeActivate + 1);

    const userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Candidate");
  });

  it("PATCH with a mixed command ({ isPrimary: true, isActive: false }) is rejected with 400, not silently half-applied", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "mixed-cmd");
    const prim = await createPrimaryAssignment(
      ctx.db,
      ctx.org.id,
      target.id,
      "Candidate",
    );
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/role-assignments/${prim.id}`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { isPrimary: true, isActive: false },
    });
    expect(res.statusCode).toBe(400);
    // Nothing changed: the assignment is still the active primary.
    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const row = listRes
      .json()
      .items.find((i: { id: string }) => i.id === prim.id);
    expect(row).toMatchObject({ isActive: true, isPrimary: true });
  });

  it("PATCH with an empty or unsupported body is rejected with 400 (invalid command, not resource-not-found)", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "empty-cmd");
    const prim = await createPrimaryAssignment(
      ctx.db,
      ctx.org.id,
      target.id,
      "Candidate",
    );
    for (const payload of [{}, { isPrimary: false }]) {
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/role-assignments/${prim.id}`,
        cookies: { "auth-token": ctx.adminToken },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("DELETE a primary assignment promotes the next active + syncs users.role (review #5/#7)", async () => {
    const target = await createTargetUser(ctx.db, ctx.org.id, "del-primary");
    await createPrimaryAssignment(ctx.db, ctx.org.id, target.id, "Candidate");
    // Add a secondary Grader assignment.
    const addRes = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Grader", isPrimary: false },
    });
    const graderAssignmentId = addRes.json().id;

    // DELETE the primary Candidate assignment.
    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/users/${target.id}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const primaryId = listRes
      .json()
      .items.find(
        (i: { role: string; isPrimary: boolean }) =>
          i.role === "Candidate" && i.isPrimary,
      ).id;

    const delRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/role-assignments/${primaryId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(delRes.statusCode).toBe(204);

    // users.role cache now reflects the auto-promoted Grader.
    const userRow = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(userRow[0]!.role).toBe("Grader");
  });

  // Route-wiring tests (layer 5.2): stub mutateWithEffectiveAdminPostcondition
  // to verify HTTP transport mapping for the deactivate + delete paths.
  describe("last-admin invariant — route wiring (RBAC-M10-E)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("PATCH /api/role-assignments/:id (deactivate) — postcondition throws LAST_ACTIVE_ADMIN -> 400", async () => {
      // Create a target assignment to deactivate.
      const target = await createTargetUser(ctx.db, ctx.org.id, "deact-target");
      const assignment = await createPrimaryAssignment(
        ctx.db,
        ctx.org.id,
        target.id,
        "Candidate",
      );
      vi.spyOn(
        adminInvariantModule,
        "mutateWithEffectiveAdminPostcondition",
      ).mockImplementation(() => {
        throw new ValidationError("不能停用或降级最后一位活跃管理员", {
          reason: "LAST_ACTIVE_ADMIN",
        });
      });
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/role-assignments/${assignment.id}`,
        payload: { isActive: false },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: { reason: "LAST_ACTIVE_ADMIN" },
          requestId: expect.any(String),
        },
      });
    });

    it("DELETE /api/role-assignments/:id — postcondition throws LAST_ACTIVE_ADMIN -> 400", async () => {
      const target = await createTargetUser(ctx.db, ctx.org.id, "del-target");
      const assignment = await createPrimaryAssignment(
        ctx.db,
        ctx.org.id,
        target.id,
        "Candidate",
      );
      vi.spyOn(
        adminInvariantModule,
        "mutateWithEffectiveAdminPostcondition",
      ).mockImplementation(() => {
        throw new ValidationError("不能停用或降级最后一位活跃管理员", {
          reason: "LAST_ACTIVE_ADMIN",
        });
      });
      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/role-assignments/${assignment.id}`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: { reason: "LAST_ACTIVE_ADMIN" },
          requestId: expect.any(String),
        },
      });
    });
  });
});
