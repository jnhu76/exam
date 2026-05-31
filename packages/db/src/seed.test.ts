import { describe, expect, it } from "vitest";
import { createDatabase } from "./database.js";
import { migrateSqlite } from "./sqlite.js";
import { seed } from "./seed.js";

describe("seed idempotency", () => {
  it("does not throw on second run", () => {
    const { db } = createDatabase();
    migrateSqlite(db);
    seed(db);
    expect(() => seed(db)).not.toThrow();
  });
});
