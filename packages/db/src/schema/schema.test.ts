import { describe, it, expect } from "vitest";
import { pgSchema } from "../schema/pg";
import { users as sqliteUsers } from "../schema/sqlite";

describe("User Schema - Session Version", () => {
  it("PostgreSQL users table has sessionVersion field", () => {
    const { users } = pgSchema;

    expect(Object.keys(users)).toContain("sessionVersion");
    expect(users.sessionVersion).toBeDefined();
  });

  it("SQLite users table has sessionVersion field", () => {
    expect(Object.keys(sqliteUsers)).toContain("sessionVersion");
    expect(sqliteUsers.sessionVersion).toBeDefined();
  });

  it("PostgreSQL sessionVersion has correct type", () => {
    const { users } = pgSchema;
    const sessionVersion = users.sessionVersion;

    expect(sessionVersion).toBeDefined();
    expect(sessionVersion.dataType).toBe("number");
    expect(sessionVersion.hasDefault).toBe(true);
    expect(sessionVersion.default).toBe(0);
  });

  it("SQLite sessionVersion has correct type", () => {
    const sessionVersion = sqliteUsers.sessionVersion;

    expect(sessionVersion).toBeDefined();
    expect(sessionVersion.dataType).toBe("number");
    expect(sessionVersion.notNull).toBe(true);
    expect(sessionVersion.default).toBe(0);
  });
});
