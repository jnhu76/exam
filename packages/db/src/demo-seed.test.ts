import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "./testDb.js";
import { seedDemo } from "./demo-seed.js";
import { verifyDemoSeed } from "./demo-seed-verify.js";
import { schema } from "./schema/pg.js";
import { hashPassword, verifyPassword } from "@exam/auth/src/password.js";

describe("demo seed", () => {
  it("seeds and verifies without errors", async () => {
    const { db } = await getTestDb();
    const ids = await seedDemo(db, hashPassword);
    const errors = await verifyDemoSeed(db, ids);
    expect(errors).toEqual([]);
  });

  it("is idempotent on second run", async () => {
    const { db } = await getTestDb();
    await seedDemo(db, hashPassword);
    const ids = await seedDemo(db, hashPassword);
    const errors = await verifyDemoSeed(db, ids);
    expect(errors).toEqual([]);
  });

  it("creates all expected users with real argon2 hashes", async () => {
    const { db } = await getTestDb();
    await seedDemo(db, hashPassword);
    const demoOrg = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "default"));
    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.organizationId, demoOrg[0]!.id));
    const activeUsernames = users
      .filter((u) => u.isActive)
      .map((u) => u.username)
      .sort();
    expect(activeUsernames).toContain("admin");
    expect(activeUsernames).toContain("candidate1");
    expect(activeUsernames).toContain("candidate2");
    expect(activeUsernames).not.toContain("superadmin");
    expect(activeUsernames).not.toContain("teacher1");

    const admin = users.find((u) => u.username === "admin")!;
    expect(await verifyPassword("admin123", admin.passwordHash)).toBe(true);
  });

  it("creates graded attempts with grading results", async () => {
    const { db } = await getTestDb();
    await seedDemo(db, hashPassword);
    const allAttempts = await db.select().from(schema.examAttempts);
    const gradedAttempts = allAttempts.filter((a) => a.status === "graded");
    expect(gradedAttempts.length).toBeGreaterThanOrEqual(5);
    for (const attempt of gradedAttempts) {
      expect(attempt.score).toBeDefined();
      expect(attempt.gradingResult).toBeDefined();
      const results = attempt.gradingResult as Array<unknown>;
      expect(results.length).toBeGreaterThan(0);
    }
  });

  afterAll(async () => {
    const { db } = await getTestDb();
    const demoOrg = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "default"));
    if (demoOrg[0]) {
      const orgId = demoOrg[0].id;
      await db
        .delete(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgId));
      await db
        .delete(schema.examAttempts)
        .where(eq(schema.examAttempts.organizationId, orgId));
      await db
        .delete(schema.examEnrollments)
        .where(eq(schema.examEnrollments.organizationId, orgId));
      await db
        .delete(schema.exams)
        .where(eq(schema.exams.organizationId, orgId));
      await db
        .delete(schema.questions)
        .where(eq(schema.questions.organizationId, orgId));
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.organizationId, orgId));
      await db
        .delete(schema.candidateFields)
        .where(eq(schema.candidateFields.organizationId, orgId));
      await db
        .delete(schema.organizationSettings)
        .where(eq(schema.organizationSettings.organizationId, orgId));
      await db
        .delete(schema.courses)
        .where(eq(schema.courses.organizationId, orgId));
      await db
        .delete(schema.users)
        .where(eq(schema.users.organizationId, orgId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, orgId));
    }
  });
});
