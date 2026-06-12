import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "./testDb.js";
import { seed } from "./seed.js";
import { schema } from "./schema/pg.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { verifyPassword } from "@exam/auth/src/password.js";

describe("seed idempotency", () => {
  it("creates org and users with real argon2 hashes", async () => {
    const { db } = await getTestDb();
    const result = await seed(db, hashPassword);
    expect(result.orgId).toBeDefined();
    expect(result.users.superAdminId).toBeDefined();
    expect(result.users.adminId).toBeDefined();
    expect(result.users.teacherId).toBeDefined();
    expect(result.users.candidateId).toBeDefined();

    const superAdmin = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, result.users.superAdminId));
    expect(superAdmin[0]!.role).toBe("SuperAdmin");
    expect(superAdmin[0]!.isActive).toBe(true);
    expect(await verifyPassword("admin123", superAdmin[0]!.passwordHash)).toBe(
      true,
    );

    const admin = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, result.users.adminId));
    expect(admin[0]!.role).toBe("Admin");
    expect(await verifyPassword("admin123", admin[0]!.passwordHash)).toBe(true);
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

    const usernames = ["superadmin", "admin", "teacher", "candidate"];
    for (const username of usernames) {
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, username));
      const sameOrgRows = rows.filter((u) => u.organizationId === r1!.orgId);
      expect(sameOrgRows).toHaveLength(1);
    }
  });

  afterAll(async () => {
    const { db } = await getTestDb();
    const orgs = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "default"));
    if (orgs[0]) {
      const oid = orgs[0].id;
      await db
        .delete(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, oid));
      await db
        .delete(schema.examAttempts)
        .where(eq(schema.examAttempts.organizationId, oid));
      await db
        .delete(schema.examEnrollments)
        .where(eq(schema.examEnrollments.organizationId, oid));
      await db
        .delete(schema.questions)
        .where(eq(schema.questions.organizationId, oid));
      await db.delete(schema.exams).where(eq(schema.exams.organizationId, oid));
      await db
        .delete(schema.courses)
        .where(eq(schema.courses.organizationId, oid));
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.organizationId, oid));
      await db
        .delete(schema.candidateFields)
        .where(eq(schema.candidateFields.organizationId, oid));
      await db
        .delete(schema.organizationSettings)
        .where(eq(schema.organizationSettings.organizationId, oid));
      await db.delete(schema.users).where(eq(schema.users.organizationId, oid));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, oid));
    }
  });
});
