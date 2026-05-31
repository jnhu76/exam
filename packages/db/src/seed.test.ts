import { describe, expect, it } from "vitest";
import { createDatabase } from "./database.js";
import { migrateSqlite } from "./sqlite.js";
import { seed } from "./seed.js";

describe("seed idempotency", () => {
  it("does not throw on second run", async () => {
    const { db } = createDatabase(":memory:");
    migrateSqlite(db);
    await seed(db);
    await expect(seed(db)).resolves.toBeUndefined();
  });
});
