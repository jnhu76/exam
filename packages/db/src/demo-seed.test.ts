import { describe, expect, it } from "vitest";
import { createDatabase } from "./database.js";
import { migrateSqlite } from "./sqlite.js";
import { seedDemo } from "./demo-seed.js";
import { verifyDemoSeed } from "./demo-seed-verify.js";

const fakeHash = async (password: string) =>
  `$fake$${Buffer.from(password).toString("base64")}`;

describe("demo seed", () => {
  it("seeds and verifies without errors", async () => {
    const conn = createDatabase(":memory:");
    if (conn.kind !== "sqlite") throw new Error("Expected sqlite");
    migrateSqlite(conn.db);
    const ids = await seedDemo(conn.db, fakeHash);
    const errors = verifyDemoSeed(conn.db, ids);
    expect(errors).toEqual([]);
  });

  it("is idempotent on second run", async () => {
    const conn = createDatabase(":memory:");
    if (conn.kind !== "sqlite") throw new Error("Expected sqlite");
    migrateSqlite(conn.db);
    await seedDemo(conn.db, fakeHash);
    const ids = await seedDemo(conn.db, fakeHash);
    const errors = verifyDemoSeed(conn.db, ids);
    expect(errors).toEqual([]);
  });

  it("creates all expected users", async () => {
    const conn = createDatabase(":memory:");
    if (conn.kind !== "sqlite") throw new Error("Expected sqlite");
    migrateSqlite(conn.db);
    await seedDemo(conn.db, fakeHash);
    const { sqliteSchema } = await import("./schema/sqlite.js");
    const users = conn.db.select().from(sqliteSchema.users).all();
    const usernames = users.map((u) => u.username).sort();
    expect(usernames).toContain("superadmin");
    expect(usernames).toContain("admin");
    expect(usernames).toContain("teacher1");
    expect(usernames).toContain("teacher2");
    expect(usernames).toContain("candidate1");
    expect(usernames).toContain("candidate2");
    expect(usernames).toContain("candidate3");
    expect(usernames).toContain("candidate4");
  });

  it("creates graded attempts with grading results", async () => {
    const conn = createDatabase(":memory:");
    if (conn.kind !== "sqlite") throw new Error("Expected sqlite");
    migrateSqlite(conn.db);
    await seedDemo(conn.db, fakeHash);
    const { sqliteSchema } = await import("./schema/sqlite.js");
    const gradedAttempts = conn.db
      .select()
      .from(sqliteSchema.examAttempts)
      .all()
      .filter((a) => a.status === "graded");
    expect(gradedAttempts.length).toBeGreaterThanOrEqual(5);
    for (const attempt of gradedAttempts) {
      expect(attempt.score).toBeDefined();
      expect(attempt.gradingResult).toBeDefined();
      const results = attempt.gradingResult as Array<unknown>;
      expect(results.length).toBeGreaterThan(0);
    }
  });
});
