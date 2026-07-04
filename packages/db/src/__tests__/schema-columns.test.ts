import { describe, expect, it, afterAll, beforeAll } from "vitest";
import postgres from "postgres";
import { createTestSchema, dropTestSchema } from "../testIsolation.js";
import { createDatabase } from "../database.js";
import { migratePostgres } from "../postgres.js";
import { resolveTestDbUrl } from "../testDb.js";

/**
 * P3-L0-1: asserts the schema migration adds the new columns.
 *
 * Pattern mirrors `testIsolation.test.ts:185` — migrate against an isolated
 * schema, then query information_schema.columns. This proves the generated
 * migration applies cleanly and adds the expected physical columns.
 */
describe("P3-L0-1 schema migration — new columns", () => {
  const testSchema = `test_l01_columns_${Date.now()}`;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await createTestSchema(resolveTestDbUrl(), testSchema);
    const conn = await createDatabase(resolveTestDbUrl(), testSchema);
    await migratePostgres(conn.db, { migrationsSchema: testSchema });
    await conn.sql.end();
    sql = postgres(resolveTestDbUrl());
  });

  afterAll(async () => {
    await sql.end();
    await dropTestSchema(resolveTestDbUrl(), testSchema).catch(() => {});
  });

  async function columnInfo(table: string, column: string) {
    const rows = await sql`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = ${testSchema}
        AND table_name = ${table}
        AND column_name = ${column}
    `;
    return rows[0] as
      | { data_type: string; is_nullable: "YES" | "NO" }
      | undefined;
  }

  it("adds questions.rubric as nullable text", async () => {
    const col = await columnInfo("questions", "rubric");
    expect(col).toBeDefined();
    expect(col?.data_type).toBe("text");
    expect(col?.is_nullable).toBe("YES");
  });

  it("adds exam_attempts.submitted_answers as nullable jsonb", async () => {
    const col = await columnInfo("exam_attempts", "submitted_answers");
    expect(col).toBeDefined();
    expect(col?.data_type).toBe("jsonb");
    expect(col?.is_nullable).toBe("YES");
  });

  it("adds exam_attempts.submission_reason as nullable text", async () => {
    const col = await columnInfo("exam_attempts", "submission_reason");
    expect(col).toBeDefined();
    expect(col?.data_type).toBe("text");
    expect(col?.is_nullable).toBe("YES");
  });
});
