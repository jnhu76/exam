import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "./types.js";
import { getIsolatedTestDb } from "./testDb.js";
import { seedDemo } from "./demo-seed.js";
import { verifyDemoSeed } from "./demo-seed-verify.js";
import { schema } from "./schema/pg.js";
import { hashPassword, verifyPassword } from "@exam/auth/src/password.js";

// Pre-computed argon2id hashes for demo-seed passwords. Generated once with
// default parameters to avoid ~80ms/call hash computation during tests.
// 6 seed users × 80ms ≈ 480ms saved per seedDemo call (test calls it 9×).
const ADMIN_PW_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$C12Yp33+uAT+Ew3Fkbl5Bw$HkRUB4mhpHXaa7gWLtiDlJjFacO8R6YUDTpLrMwCZLs";
const CAND_PW_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$3dCWwSdVOt1y1PCOkxbQVQ$PlSw+GRS5dzJOaVzXjzqF4HoI0/msheYXyIYQRyOmzw";

const precomputedHash = async (password: string): Promise<string> => {
  return password === "admin123" ? ADMIN_PW_HASH : CAND_PW_HASH;
};

describe("demo seed", { timeout: 30_000 }, () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-demo-seed");
    db = result.db;
    cleanup = result.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("seeds and verifies without errors", async () => {
    const ids = await seedDemo(db, precomputedHash);
    const errors = await verifyDemoSeed(db, ids);
    expect(errors).toEqual([]);
  });

  it("is idempotent on second run", async () => {
    await seedDemo(db, precomputedHash);
    const ids = await seedDemo(db, precomputedHash);
    const errors = await verifyDemoSeed(db, ids);
    expect(errors).toEqual([]);
  });

  it("keeps question idempotency scoped by course", async () => {
    const ids = await seedDemo(db, precomputedHash);
    const skillCourseId = ids.courses["SKILL-201"]!;

    await db.insert(schema.questions).values({
      id: randomUUID(),
      organizationId: ids.orgId,
      courseId: skillCourseId,
      type: "single_choice",
      content: "消防通道的宽度不得低于____米",
      options: [],
      standardAnswer: "1.2",
      attachments: [],
      score: 5,
      difficulty: 3,
      tags: ["safety", "regulation"],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
        fillBlankCaseSensitive: false,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const reseededIds = await seedDemo(db, precomputedHash);
    const safetyCourseId = reseededIds.courses["SAFETY-101"]!;
    const safetyQuestions = await db
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.organizationId, reseededIds.orgId),
          eq(schema.questions.courseId, safetyCourseId),
        ),
      );

    expect(safetyQuestions).toHaveLength(6);
    expect(reseededIds.questions["safety-fb2"]).toBeDefined();
    expect(
      safetyQuestions.some((q) => q.id === reseededIds.questions["safety-fb2"]),
    ).toBe(true);
  });

  it("creates all expected users with real argon2 hashes", async () => {
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

    const admin = users.find((u) => u.username === "admin")!;
    expect(await verifyPassword("admin123", admin.passwordHash)).toBe(true);
  });

  it("creates graded attempts with grading results", async () => {
    const ids = await seedDemo(db, precomputedHash);
    const allAttempts = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, ids.orgId));
    const gradedAttempts = allAttempts.filter((a) => a.status === "graded");
    expect(gradedAttempts.length).toBeGreaterThanOrEqual(5);
    for (const attempt of gradedAttempts) {
      expect(attempt.score).toBeDefined();
      expect(attempt.gradingResult).toBeDefined();
      const results = attempt.gradingResult as Array<unknown>;
      expect(results.length).toBeGreaterThan(0);
    }
  });

  it("regression: keeps non-empty gradingResult on every graded attempt across a double seedDemo run", async () => {
    const firstIds = await seedDemo(db, precomputedHash);
    await seedDemo(db, precomputedHash);

    const attempts = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, firstIds.orgId));
    const gradedAttempts = attempts.filter((a) => a.status === "graded");
    expect(gradedAttempts.length).toBeGreaterThanOrEqual(5);
    for (const attempt of gradedAttempts) {
      expect(Array.isArray(attempt.gradingResult)).toBe(true);
      expect((attempt.gradingResult as Array<unknown>).length).toBeGreaterThan(
        0,
      );
      expect(attempt.score).toBeDefined();
    }
  });
});
