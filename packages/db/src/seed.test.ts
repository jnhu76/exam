import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { eq, and } from "drizzle-orm";
import type { Database } from "./types.js";
import { getIsolatedTestDb } from "./testDb.js";
import { seed, assertNotProductionSeed } from "./seed.js";
import { schema } from "./schema/pg.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { verifyPassword } from "@exam/auth/src/password.js";
import { createUserRoleAssignmentRepo } from "./repository/userRoleAssignmentRepo.js";

describe("seed idempotency", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-seed");
    db = result.db;
    cleanup = result.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("creates default org and Phase 1 users with real argon2 hashes", async () => {
    const result = await seed(db, hashPassword);
    expect(result.orgId).toBeDefined();
    expect(result.users.adminId).toBeDefined();
    expect(result.users.candidateId).toBeDefined();
    expect(result.users.candidate2Id).toBeDefined();

    const admin = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, result.users.adminId));
    expect(admin[0]!.role).toBe("Admin");
    expect(admin[0]!.isActive).toBe(true);
    expect(await verifyPassword("admin123", admin[0]!.passwordHash)).toBe(true);

    const candidate = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, result.users.candidateId));
    expect(candidate[0]!.role).toBe("Candidate");
    expect(
      await verifyPassword("candidate123", candidate[0]!.passwordHash),
    ).toBe(true);

    const candidate2 = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, result.users.candidate2Id));
    expect(candidate2[0]!.role).toBe("Candidate");
    expect(candidate2[0]!.isActive).toBe(true);
    expect(
      await verifyPassword("candidate123", candidate2[0]!.passwordHash),
    ).toBe(true);
  });

  it("does not create future role users in the Phase 1 default seed", async () => {
    const result = await seed(db, hashPassword);

    const seededIds = new Set(Object.values(result.users));
    const seededRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.organizationId, result.orgId));
    const seededRoles = seededRows
      .filter((u) => seededIds.has(u.id))
      .map((u) => u.role)
      .sort();
    expect(seededRoles).toEqual(["Admin", "Candidate", "Candidate"]);
  });

  it("is idempotent on second run and resets password without reactivating the account", async () => {
    const r1 = await seed(db, hashPassword);

    await db
      .update(schema.users)
      .set({ isActive: false, passwordHash: "broken-hash" })
      .where(eq(schema.users.id, r1.users.adminId));

    const r2 = await seed(db, hashPassword);
    expect(r2.orgId).toBe(r1.orgId);
    expect(r2.users.adminId).toBe(r1.users.adminId);
    expect(r2.users.candidateId).toBe(r1.users.candidateId);
    expect(r2.users.candidate2Id).toBe(r1.users.candidate2Id);

    const admin = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, r2.users.adminId));
    // RBAC-M10-E: seed preserves account-level isActive; it must not silently
    // re-enable a disabled seed account.
    expect(admin[0]!.isActive).toBe(false);
    expect(await verifyPassword("admin123", admin[0]!.passwordHash)).toBe(true);
  });

  it("survives concurrent seed calls without unique-violation errors", async () => {
    const results = await Promise.all([
      seed(db, hashPassword),
      seed(db, hashPassword),
      seed(db, hashPassword),
    ]);

    const [r1, r2, r3] = results;
    expect(r2!.orgId).toBe(r1!.orgId);
    expect(r3!.orgId).toBe(r1!.orgId);
    expect(r2!.users.adminId).toBe(r1!.users.adminId);
    expect(r3!.users.adminId).toBe(r1!.users.adminId);

    const orgs = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "default"));
    expect(orgs).toHaveLength(1);

    const usernames = ["admin", "candidate", "candidate2"];
    for (const username of usernames) {
      const rows = await db
        .select()
        .from(schema.users)
        .where(
          and(
            eq(schema.users.organizationId, r1!.orgId),
            eq(schema.users.username, username),
          ),
        );
      expect(rows).toHaveLength(1);
    }
  });
});

describe("seed authority preservation (RBAC-M10-E)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await getIsolatedTestDb("db-seed-authority");
    db = result.db;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  function makeCtx(orgId: string) {
    return {
      organizationId: orgId,
      actorId: "seed-test",
      role: "Admin" as const,
      permissions: [],
    };
  }

  it("preserves a formal primary role change on re-seed", async () => {
    const first = await seed(db, hashPassword);
    const ctx = makeCtx(first.orgId);
    const repo = createUserRoleAssignmentRepo(db);

    await repo.replacePrimaryRole(ctx, {
      userId: first.users.candidateId,
      role: "Teacher",
    });
    // Simulate the product path that also syncs users.role (sync lives in
    // apps/api; the db package only tests the assignment invariant).
    await db
      .update(schema.users)
      .set({ role: "Teacher" })
      .where(eq(schema.users.id, first.users.candidateId));

    await seed(db, hashPassword);

    const primary = await repo.findPrimaryActiveForUser(
      ctx,
      first.users.candidateId,
    );
    expect(primary?.role).toBe("Teacher");

    const userRow = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, first.users.candidateId));
    expect(userRow[0]!.role).toBe("Teacher");
  });

  it("repairs a user with zero assignment rows from current users.role", async () => {
    const first = await seed(db, hashPassword);
    const ctx = makeCtx(first.orgId);
    const repo = createUserRoleAssignmentRepo(db);

    const assignments = await repo.listForUser(ctx, first.users.candidateId);
    for (const a of assignments) {
      await repo.remove(ctx, a.id);
    }

    await db
      .update(schema.users)
      .set({ role: "Admin" })
      .where(eq(schema.users.id, first.users.candidateId));

    await seed(db, hashPassword);

    const primary = await repo.findPrimaryActiveForUser(
      ctx,
      first.users.candidateId,
    );
    expect(primary?.role).toBe("Admin");
  });

  it("does not reactivate inactive-only assignments on re-seed", async () => {
    const first = await seed(db, hashPassword);
    const ctx = makeCtx(first.orgId);
    const repo = createUserRoleAssignmentRepo(db);

    const assignments = await repo.listForUser(ctx, first.users.candidateId);
    for (const a of assignments) {
      await repo.deactivate(ctx, a.id);
    }

    await seed(db, hashPassword);

    const active = await repo.listActiveForUser(ctx, first.users.candidateId);
    expect(active).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// P6-008: production fail-closed guard. The baseline seed ships known
// default credentials (admin/admin123, candidate/candidate123) and MUST
// NOT run in production. The canonical production bootstrap is
// apps/api/src/scripts/bootstrap-admin.ts.
// ──────────────────────────────────────────────────────────────────────

describe("assertNotProductionSeed (P6-008 production guard)", () => {
  it("throws when APP_MODE=production", () => {
    expect(() => assertNotProductionSeed({ APP_MODE: "production" })).toThrow(
      /Refusing to run the baseline seed in production/,
    );
  });

  it("throws when APP_MODE unset and NODE_ENV=production", () => {
    expect(() => assertNotProductionSeed({ NODE_ENV: "production" })).toThrow(
      /Refusing to run the baseline seed in production/,
    );
  });

  it("points operators to the production bootstrap path", () => {
    try {
      assertNotProductionSeed({ APP_MODE: "production" });
      expect.fail("expected assertNotProductionSeed to throw");
    } catch (err) {
      expect((err as Error).message).toContain("bootstrap-admin");
      expect((err as Error).message).toContain("--password");
    }
  });

  it("does not throw in development", () => {
    expect(() =>
      assertNotProductionSeed({ APP_MODE: "development" }),
    ).not.toThrow();
  });

  it("does not throw in test mode", () => {
    expect(() => assertNotProductionSeed({ APP_MODE: "test" })).not.toThrow();
  });

  it("does not throw in e2e mode", () => {
    expect(() => assertNotProductionSeed({ APP_MODE: "e2e" })).not.toThrow();
  });

  it("does not throw in ci mode", () => {
    expect(() => assertNotProductionSeed({ APP_MODE: "ci" })).not.toThrow();
  });

  it("does not throw when APP_MODE is unset (defaults to development)", () => {
    expect(() => assertNotProductionSeed({})).not.toThrow();
  });
});
