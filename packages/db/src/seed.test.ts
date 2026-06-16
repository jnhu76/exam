import { describe, expect, it, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { getTestDb } from "./testDb.js";
import { seed } from "./seed.js";
import { schema } from "./schema/pg.js";
import { cleanupOrganizationTestData } from "./testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { verifyPassword } from "@exam/auth/src/password.js";

describe("seed idempotency", () => {
  it("creates default org and Phase 1 users with real argon2 hashes", async () => {
    const { db } = await getTestDb();
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
    const { db } = await getTestDb();
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

  it("is idempotent on second run and resets password/isActive", async () => {
    const { db } = await getTestDb();
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
    expect(admin[0]!.isActive).toBe(true);
    expect(await verifyPassword("admin123", admin[0]!.passwordHash)).toBe(true);
  });

  it("survives concurrent seed calls without unique-violation errors", async () => {
    const { db } = await getTestDb();
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

  afterAll(async () => {
    const { db } = await getTestDb();
    const orgs = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "default"));
    if (orgs[0]) {
      await cleanupOrganizationTestData(db, orgs[0].id);
    }
  });
});
