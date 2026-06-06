import { describe, expect, it } from "vitest";
import { createDatabase } from "./database.js";
import { migrateSqlite } from "./sqlite.js";
import { seed } from "./seed.js";

describe("seed idempotency", () => {
  it("does not throw on second run", async () => {
    const conn = createDatabase(":memory:");
    if (conn.kind !== "sqlite") throw new Error("Expected sqlite");
    migrateSqlite(conn.db);
    await seed(conn.db);
    await expect(seed(conn.db)).resolves.toBeUndefined();
  });
});
