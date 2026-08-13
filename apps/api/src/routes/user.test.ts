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
import {
  buildTestApp,
  createFutureRoleUserForTest,
  createUnassignedUserForTest,
} from "./testHelpers.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import type { Database } from "@exam/db/src/types.js";
import { ValidationError } from "@exam/domain";
import { AssignableRoleSchema } from "@exam/contracts";
import * as adminInvariantModule from "../authz/adminInvariant.js";
import * as userRoleAssignmentRepoModule from "@exam/db/src/repository/userRoleAssignmentRepo.js";

async function createCandidateUser(
  db: Database,
  orgId: string,
  username: string,
) {
  const userId = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username,
    passwordHash: await hashPassword("password123"),
    name: `Candidate ${username}`,
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  // RBAC-M10-E: the candidate-password-reset endpoint targets the
  // CandidateProfile identity (not a role projection). A candidate user
  // without a profile is NOT a valid target, so the fixture must create one.
  await db.insert(schema.candidateProfiles).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    userId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return rows[0]!;
}

describe("user routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(userRoutes);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/users returns paginated list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/users",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page", 1);
    expect(body.items).toBeInstanceOf(Array);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/users creates a user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `newuser-${Date.now()}`,
        password: "password123",
        name: "New User",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("New User");
    expect(body.role).toBe("Admin");
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("POST /api/users returns validation details", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "x",
        password: "short",
        name: "",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ field: "username", code: "TOO_SMALL" }),
            expect.objectContaining({ field: "password", code: "TOO_SMALL" }),
            expect.objectContaining({ field: "name", code: "TOO_SMALL" }),
          ]),
        },
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/users returns a stable conflict for duplicate usernames", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: ctx.admin.username,
        password: "password123",
        name: "Duplicate User",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: {
        code: "USER_ALREADY_EXISTS",
        requestId: expect.any(String),
      },
    });
  });

  it("PATCH /api/users/:id updates a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `updateuser-${Date.now()}`,
        password: "password123",
        name: "Update Me",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${created.id}`,
      payload: { name: "Updated Name" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
  });

  it("DELETE /api/users/:id deletes a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `deleteuser-${Date.now()}`,
        password: "password123",
        name: "Delete Me",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("PATCH /api/users/:id returns ErrorResponse v0 when missing", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${crypto.randomUUID()}`,
      payload: { name: "Missing User" },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESOURCE_NOT_FOUND",
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/users requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "forbidden",
        password: "password123",
        name: "Forbidden",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        requestId: expect.any(String),
      },
    });
  });

  it("GET /api/users excludes legacy-role rows and includes the full assignable set via repo-level filter (F-03)", async () => {
    const legacyCtx = await buildTestApp(userRoutes);
    try {
      const beforeRes = await legacyCtx.app.inject({
        method: "GET",
        url: "/api/users?page=1&pageSize=50",
        cookies: { "auth-token": legacyCtx.adminToken },
      });
      expect(beforeRes.statusCode).toBe(200);
      const beforeBody = beforeRes.json();

      const teacher = await createFutureRoleUserForTest(
        legacyCtx.db,
        legacyCtx.org.id,
        "Teacher",
        `legacy-teacher-list`,
      );
      // SuperAdmin is not in the assignable set (DB CHECK rejects an
      // assignment row), so use the no-assignment variant. The user row
      // exists; the user-list filter under test excludes it regardless.
      await createUnassignedUserForTest(
        legacyCtx.db,
        legacyCtx.org.id,
        "SuperAdmin",
        `legacy-superadmin-list`,
      );
      const res = await legacyCtx.app.inject({
        method: "GET",
        url: "/api/users?page=1&pageSize=50",
        cookies: { "auth-token": legacyCtx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const assignable = AssignableRoleSchema.options as readonly string[];
      // F-03: the list is sourced from the full assignable contract, so every
      // listed user is in the assignable set (legacy/non-assignable roles like
      // SuperAdmin are excluded at the repo level).
      expect(
        body.items.every((u: { role: string }) => assignable.includes(u.role)),
      ).toBe(true);
      // The legacy SuperAdmin row is excluded.
      expect(
        body.items.some((u: { username: string }) =>
          u.username.includes("legacy-superadmin-list"),
        ),
      ).toBe(false);
      // F-03: the assignable Teacher is now VISIBLE (previously hidden by the
      // ["Admin","Candidate","Maintainer"] subset filter).
      expect(
        body.items.some(
          (u: { username: string }) => u.username === teacher.user.username,
        ),
      ).toBe(true);
      // One assignable user (Teacher) was added and is visible; SuperAdmin is
      // excluded → total grows by exactly 1.
      expect(body.total).toBe(beforeBody.total + 1);
      expect(body.totalPages).toBe(
        body.total === 0 ? 0 : Math.ceil(body.total / body.pageSize),
      );
    } finally {
      await legacyCtx.cleanup();
    }
  });

  it("PATCH /api/users/:id rejects self-disable with VALIDATION_ERROR + reason CANNOT_DISABLE_SELF", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${ctx.admin.id}`,
      payload: { isActive: false },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { reason: "CANNOT_DISABLE_SELF" },
        requestId: expect.any(String),
      },
    });
  });

  // NOTE: there is intentionally NO "rejects disabling the last active Admin"
  // route test here. The earlier version of this test pointed the actor and the
  // target at the same id (adminCtx.admin.id), so the self-disable guard at the
  // top of the PATCH handler fired FIRST and the route never reached the
  // last-admin postcondition. Its assertion `reason: /LAST_ACTIVE_ADMIN|
  // CANNOT_DISABLE_SELF/` would still pass even if the last-admin invariant
  // were deleted, so it was empty evidence. Real last-admin proof lives at the
  // service level in adminInvariant.test.ts (disable/delete last Admin,
  // deactivate/delete last Admin assignment, secondary-Admin count, concurrent
  // two-admin removal). At the route layer the meaningful evidence is the
  // positive case below ("allows disabling a non-last Admin …").

  it("PATCH /api/users/:id allows disabling a non-last Admin when another active Admin exists", async () => {
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `second-admin-${Date.now()}`,
        password: "password123",
        name: "Second Admin",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(201);
    const created = second.json();
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${created.id}`,
      payload: { isActive: false },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: created.id, isActive: false });
  });

  describe("POST /api/users/:id/reset-password (Candidate password reset)", () => {
    it("Admin resets Candidate password successfully", async () => {
      const candidate = await createCandidateUser(
        ctx.db,
        ctx.org.id,
        `cand-reset-${Date.now()}`,
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${candidate.id}/reset-password`,
        payload: { newPassword: "NewCandPass456!" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(res.body).not.toContain("NewCandPass456!");
    });

    it("Candidate cannot reset another user's password", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${ctx.admin.id}/reset-password`,
        payload: { newPassword: "Hacked123!" },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("Admin cannot reset another Admin's password via this endpoint", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${ctx.admin.id}/reset-password`,
        payload: { newPassword: "NewAdminPass456!" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe(
        "PASSWORD_RESET_TARGET_ROLE_NOT_ALLOWED",
      );
      expect(res.json().error.details).toMatchObject({ targetRole: "Admin" });
    });

    it("reset-password writes audit log with candidate.password_reset action", async () => {
      const candidate = await createCandidateUser(
        ctx.db,
        ctx.org.id,
        `cand-audit-${Date.now()}`,
      );

      await ctx.app.inject({
        method: "POST",
        url: `/api/users/${candidate.id}/reset-password`,
        payload: { newPassword: "NewAuditPass456!" },
        cookies: { "auth-token": ctx.adminToken },
      });

      let resetAudit: typeof schema.auditLogs.$inferSelect | undefined;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const auditRows = await ctx.db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, candidate.id));
        resetAudit = auditRows.find(
          (r) => r.action === "candidate.password_reset",
        );
        if (resetAudit) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(resetAudit).toBeDefined();
      const metadata = resetAudit!.metadata as Record<string, unknown>;
      expect(JSON.stringify(metadata)).not.toContain("NewAuditPass456!");
      expect(JSON.stringify(metadata)).not.toContain("password");
    });

    it("reset-password requires authentication", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${ctx.candidate.id}/reset-password`,
        payload: { newPassword: "NewPass456!" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("old password no longer works after reset", async () => {
      const candidate = await createCandidateUser(
        ctx.db,
        ctx.org.id,
        `cand-old-${Date.now()}`,
      );

      await ctx.app.inject({
        method: "POST",
        url: `/api/users/${candidate.id}/reset-password`,
        payload: { newPassword: "NewLoginPass456!" },
        cookies: { "auth-token": ctx.adminToken },
      });

      const { verifyPassword } = await import("@exam/auth/src/password.js");
      const updated = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, candidate.id));
      expect(
        await verifyPassword("NewLoginPass456!", updated[0]!.passwordHash),
      ).toBe(true);
      expect(
        await verifyPassword("password123", updated[0]!.passwordHash),
      ).toBe(false);
    });
  });

  // Route-wiring tests (layer 5.2): stub mutateWithEffectiveAdminPostcondition
  // to verify HTTP transport mapping without constructing "actor is last Admin"
  // scenarios — the real post-condition behavior is covered by
  // adminInvariant.test.ts (layer 5.1).
  describe("last-admin invariant — route wiring (RBAC-M10-E)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("PATCH /api/users/:id — postcondition throws LAST_ACTIVE_ADMIN -> 400 VALIDATION_ERROR", async () => {
      // Stub the postcondition so it throws as-if the invariant fired. The
      // route handler must map that to a 400 with reason LAST_ACTIVE_ADMIN
      // and not leak internal detail.
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
        url: `/api/users/${ctx.admin.id}`,
        payload: { name: "attempt while invariant fires" },
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
      // The mutation callback was never entered (the stub throws
      // synchronously before executing the wrapped function).
    });

    it("DELETE /api/users/:id — postcondition throws LAST_ACTIVE_ADMIN -> 400 VALIDATION_ERROR", async () => {
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
        url: `/api/users/${ctx.admin.id}`,
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

  // RBAC-M10-E atomicity proof (P1-2): the combined PATCH /users/:id mutation
  // (users row UPDATE + primary-role replacement + users.role projection sync)
  // MUST execute inside ONE transaction. If the inner assignment mutation fails
  // AFTER the users UPDATE has already executed, the whole transaction must
  // roll back — no partial state (name changed but role untouched, or users.role
  // desynced from assignments, or stray deactivated primary) may persist.
  //
  // This is NOT a route-wiring mock of mutateWithEffectiveAdminPostcondition
  // (that only proves error mapping). Here we inject the failure INSIDE the
  // transaction callback by wrapping the assignment repo factory so that
  // replacePrimaryRoleWithinTransaction throws after the users UPDATE ran.
  // We then reload the rows from the DB and assert full rollback.
  describe("PATCH /users/:id atomicity — inner failure rolls back the whole txn (RBAC-M10-E P1-2)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("rolls back users.name + users.isActive + users.role + assignments when replacePrimaryRoleWithinTransaction throws mid-txn", async () => {
      // Create a second active Admin so the PATCH target (a third user) can be
      // a non-last Admin whose primary role we attempt to change. We need a
      // real existing user with an active primary assignment to mutate.
      const targetCtx = await buildTestApp(userRoutes);
      try {
        // Target: a Candidate user with an active primary Candidate assignment.
        // We will PATCH it to change BOTH name AND role (Candidate -> Teacher),
        // which exercises the combined mutation path in the route.
        const createRes = await targetCtx.app.inject({
          method: "POST",
          url: "/api/users",
          payload: {
            username: `rollback-target-${Date.now()}`,
            password: "password123",
            name: "Original Name",
            role: "Candidate",
          },
          cookies: { "auth-token": targetCtx.adminToken },
        });
        expect(createRes.statusCode).toBe(201);
        const target = createRes.json();

        // Capture pre-mutation state from the DB (the source of truth).
        const usersBefore = await targetCtx.db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, target.id));
        expect(usersBefore).toHaveLength(1);
        const userBefore = usersBefore[0]!;
        const assignmentsBefore = await targetCtx.db
          .select()
          .from(schema.userRoleAssignments)
          .where(eq(schema.userRoleAssignments.userId, target.id));
        expect(assignmentsBefore.length).toBeGreaterThanOrEqual(1);

        // Inject the failure: wrap the assignment repo factory so that
        // replacePrimaryRoleWithinTransaction throws AFTER the users UPDATE
        // has executed inside the transaction callback. All other repo methods
        // delegate to the real implementation (so the users UPDATE truly runs).
        const realFactory =
          userRoleAssignmentRepoModule.createUserRoleAssignmentRepo;
        let replaceWasCalled = false;
        vi.spyOn(
          userRoleAssignmentRepoModule,
          "createUserRoleAssignmentRepo",
        ).mockImplementation((dbOrTx: Parameters<typeof realFactory>[0]) => {
          const real = realFactory(dbOrTx);
          return {
            ...real,
            replacePrimaryRoleWithinTransaction: async () => {
              replaceWasCalled = true;
              throw new Error("INJECTED_FAILURE_after_users_update");
            },
          } as typeof real;
        });

        // Combined mutation: name + role in one PATCH. The users UPDATE runs
        // first; the injected failure then fires on the role replacement.
        const res = await targetCtx.app.inject({
          method: "PATCH",
          url: `/api/users/${target.id}`,
          payload: { name: "Changed Name", role: "Teacher" },
          cookies: { "auth-token": targetCtx.adminToken },
        });

        // The injected failure propagated as 500 INTERNAL_ERROR (the global
        // error handler maps a thrown, non-AppError to 500 INTERNAL_ERROR).
        // NOT >=400: the precise code proves the rollback path was reached,
        // not a validation/auth error before the txn opened.
        expect(res.statusCode).toBe(500);
        expect((res.json() as { error: { code: string } }).error.code).toBe(
          "INTERNAL_ERROR",
        );
        expect(replaceWasCalled).toBe(true);

        // THE ATOMICITY PROOF: reload every row from the DB and confirm
        // nothing changed. No partial mutation may persist.
        const usersAfter = await targetCtx.db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, target.id));
        expect(usersAfter).toHaveLength(1);
        const userAfter = usersAfter[0]!;
        expect(userAfter.name).toBe(userBefore.name); // name rolled back
        expect(userAfter.isActive).toBe(userBefore.isActive); // isActive rolled back
        expect(userAfter.role).toBe(userBefore.role); // users.role projection rolled back
        expect(userAfter.updatedAt.getTime()).toBe(
          userBefore.updatedAt.getTime(),
        ); // updatedAt untouched => no write committed

        const assignmentsAfter = await targetCtx.db
          .select()
          .from(schema.userRoleAssignments)
          .where(eq(schema.userRoleAssignments.userId, target.id));
        expect(assignmentsAfter).toHaveLength(assignmentsBefore.length); // no stray rows
        // No assignment was deactivated/modified: every row matches its
        // pre-mutation (role, isPrimary, isActive) tuple.
        for (const before of assignmentsBefore) {
          const after = assignmentsAfter.find((a) => a.id === before.id);
          expect(
            after,
            `assignment ${before.id} must still exist`,
          ).toBeDefined();
          expect(after!.role).toBe(before.role);
          expect(after!.isPrimary).toBe(before.isPrimary);
          expect(after!.isActive).toBe(before.isActive);
        }
      } finally {
        await targetCtx.cleanup();
      }
    });
  });
});
