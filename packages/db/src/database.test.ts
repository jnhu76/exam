import { describe, expect, it } from "vitest";
import {
  createDatabase,
  normalizeSqliteFilename,
  resolveSqliteFilename,
} from "./database.js";
import { migrateSqlite } from "./sqlite.js";

describe("database factory", () => {
  it("normalizes supported SQLite URLs", () => {
    expect(normalizeSqliteFilename("sqlite:./dev.db")).toBe("./dev.db");
    expect(normalizeSqliteFilename("sqlite::memory:")).toBe(":memory:");
    expect(normalizeSqliteFilename(":memory:")).toBe(":memory:");
  });

  it("resolves relative SQLite paths from the repository root", () => {
    expect(resolveSqliteFilename("sqlite:./dev.db")).toMatch(
      /\/exam\/dev\.db$/,
    );
    expect(resolveSqliteFilename("sqlite::memory:")).toBe(":memory:");
  });

  it("creates the complete SQLite schema", () => {
    const database = createDatabase("sqlite::memory:");
    expect(database.kind).toBe("sqlite");
    if (database.kind !== "sqlite") {
      throw new Error("Expected a SQLite database");
    }

    migrateSqlite(database.db);
    const tables = database.client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "__drizzle_migrations",
      "audit_logs",
      "candidate_fields",
      "candidate_profiles",
      "courses",
      "exam_attempts",
      "exam_enrollments",
      "exams",
      "organization_settings",
      "organizations",
      "questions",
      "users",
    ]);
    database.client.close();
  });

  it("rejects non-SQLite database URLs during bootstrap", () => {
    expect(() =>
      createDatabase("postgresql://postgres:postgres@localhost:5432/exam"),
    ).toThrow("Only SQLite");
  });
});
