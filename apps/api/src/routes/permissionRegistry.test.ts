import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { Permission, ROLE_PRESETS } from "@exam/authz";
import authRoutes from "./auth.js";
import { permissionRegistryRoutes } from "./permissionRegistry.js";
import { buildTestApp } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(permissionRegistryRoutes);
};

describe("#298 permission registry + effective authority", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let adminId: string;
  let adminToken: string;
  let maintainerId: string;
  let maintainerToken: string;
  let candidateId: string;
  let candidateToken: string;
  let teacherId: string;
  let idleUserId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
    orgId = ctx.org.id;
    const now = new Date();

    async function seedUser(
      tag: string,
      role: "Admin" | "Maintainer" | "Candidate" | "Teacher",
      password: string,
    ) {
      const id = crypto.randomUUID();
      createdIds.push(id);
      await ctx.db.insert(schema.users).values({
        id,
        organizationId: orgId,
        username: `${tag}-${id.slice(0, 8)}`,
        passwordHash: await hashPassword(password),
        name: `${tag} User`,
        role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }

    adminId = await seedUser("reg-admin", "Admin", "reg-pass-1");
    adminToken = signJWT({
      actorId: adminId,
      role: "Admin",
      organizationId: orgId,
      authEpoch: 0,
    });
    maintainerId = await seedUser("reg-maint", "Maintainer", "reg-pass-2");
    maintainerToken = signJWT({
      actorId: maintainerId,
      role: "Maintainer",
      organizationId: orgId,
      authEpoch: 0,
    });
    candidateId = await seedUser("reg-cand", "Candidate", "reg-pass-3");
    candidateToken = signJWT({
      actorId: candidateId,
      role: "Candidate",
      organizationId: orgId,
      authEpoch: 0,
    });
    teacherId = await seedUser("reg-teacher", "Teacher", "reg-pass-4");
    // A user with NO assignment rows at all — the "no active authority" case.
    idleUserId = await seedUser("reg-idle", "Candidate", "reg-pass-5");

    // RBAC-M10-E: one active primary assignment per seeded actor so the
    // authenticate preHandler resolves the role's preset.
    await ctx.db.insert(schema.userRoleAssignments).values([
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: adminId,
        role: "Admin" as never,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: maintainerId,
        role: "Maintainer" as never,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: candidateId,
        role: "Candidate" as never,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: teacherId,
        role: "Teacher" as never,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await ctx.db
        .delete(schema.userRoleAssignments)
        .where(eq(schema.userRoleAssignments.userId, id));
      await ctx.db.delete(schema.users).where(eq(schema.users.id, id));
    }
    await ctx.cleanup();
  });

  describe("GET /admin/permission-registry", () => {
    it("requires authentication", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/permission-registry",
      });
      expect(response.statusCode).toBe(401);
    });

    it("denies Maintainer with 403 (capability-gated, not role-named)", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/permission-registry",
        cookies: { "auth-token": maintainerToken },
      });
      expect(response.statusCode).toBe(403);
    });

    it("denies Candidate with 403", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/permission-registry",
        cookies: { "auth-token": candidateToken },
      });
      expect(response.statusCode).toBe(403);
    });

    it("returns the exhaustive permission + role-preset projection for Admin", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/permission-registry",
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();

      // The projection is exactly the @exam/authz constants — no second copy.
      expect(body.permissions.length).toBe(Object.values(Permission).length);
      expect(body.rolePresets.length).toBe(Object.keys(ROLE_PRESETS).length);

      const teacher = body.rolePresets.find(
        (r: { key: string }) => r.key === "Teacher",
      );
      expect(teacher).toBeDefined();
      expect(teacher.permissions).toContain(Permission.ExamPublish);
      expect(teacher.permissions).not.toContain(Permission.ScoreExport);

      // Every permission entry carries its semantic category.
      for (const entry of body.permissions) {
        expect(typeof entry.key).toBe("string");
        expect(typeof entry.category).toBe("string");
      }
      // Every preset carries the fields the matrix needs.
      for (const preset of body.rolePresets) {
        expect(preset).toMatchObject({
          key: expect.any(String),
          label: expect.any(String),
          purpose: expect.any(String),
          isSystem: expect.any(Boolean),
          assignable: expect.any(Boolean),
          loginAllowed: expect.any(Boolean),
          defaultScope: expect.any(String),
          permissions: expect.any(Array),
          sensitivePermissions: expect.any(Array),
        });
      }
    });
  });

  describe("GET /admin/users/:id/effective-authority", () => {
    it("requires authentication", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/users/${teacherId}/effective-authority`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("denies Candidate with 403", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/users/${teacherId}/effective-authority`,
        cookies: { "auth-token": candidateToken },
      });
      expect(response.statusCode).toBe(403);
    });

    it("answers which capabilities a Teacher's active roles grant (Admin)", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/users/${teacherId}/effective-authority`,
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.id).toBe(teacherId);
      expect(body.authority.ok).toBe(true);
      expect(body.authority.authority.primaryRole).toBe("Teacher");
      expect(body.authority.authority.capabilities).toContain(
        Permission.ExamPublish,
      );
      expect(body.authority.authority.capabilities).not.toContain(
        Permission.ScoreExport,
      );
      // The assignment rows are displayed alongside the capability union —
      // the kernel's input, not a per-capability provenance map.
      expect(body.assignments).toHaveLength(1);
      expect(body.assignments[0]).toMatchObject({
        role: "Teacher",
        isPrimary: true,
        isActive: true,
        createdAt: expect.any(String),
      });
    });

    it("reports no_active_assignments as a normal outcome, not an error", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/users/${idleUserId}/effective-authority`,
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.authority).toMatchObject({
        ok: false,
        reason: "no_active_assignments",
      });
      expect(body.assignments).toEqual([]);
    });

    it("answers 404 for a user outside the organization (no cross-org enumeration)", async () => {
      const stranger = crypto.randomUUID();
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/users/${stranger}/effective-authority`,
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });
});
