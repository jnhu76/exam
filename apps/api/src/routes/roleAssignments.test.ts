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
import { eq } from "drizzle-orm";
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
