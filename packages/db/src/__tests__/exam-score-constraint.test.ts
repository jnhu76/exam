import { describe, expect, it, afterAll, beforeAll } from "vitest";
import postgres from "postgres";
import { createTestSchema, dropTestSchema } from "../testIsolation.js";
import { createDatabase } from "../database.js";
import { migratePostgres } from "../postgres.js";
import { resolveTestDbUrl } from "../testDb.js";

describe("EXAM-SCORE-INV-1 DB constraints", () => {
  const testSchema = `test_score_inv_${Date.now()}`;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await createTestSchema(resolveTestDbUrl(), testSchema);
    const conn = await createDatabase(resolveTestDbUrl(), testSchema);
    await migratePostgres(conn.db, { migrationsSchema: testSchema });
    await conn.sql.end();
    sql = postgres(resolveTestDbUrl());
    await sql.unsafe(
      `INSERT INTO ${testSchema}.organizations (id, name, display_name, slug) VALUES ('org-1', 'Test Org', 'Test Org', 'test-org')`,
    );
    await sql.unsafe(
      `INSERT INTO ${testSchema}.courses (id, organization_id, name, code, description) VALUES ('course-1', 'org-1', 'Test Course', 'TC1', '')`,
    );
  });

  afterAll(async () => {
    await sql.end();
    await dropTestSchema(resolveTestDbUrl(), testSchema).catch(() => {});
  });

  async function insertExam(overrides: Record<string, unknown> = {}) {
    const defaults = {
      id: crypto.randomUUID(),
      organization_id: "org-1",
      title: "Constraint Test",
      description: "",
      course_id: "course-1",
      status: "draft",
      timing_mode: "timed_window",
      duration_minutes: 60,
      open_at: new Date().toISOString(),
      close_at: new Date(Date.now() + 86400000).toISOString(),
      passing_score: 60,
      total_score: 100,
      question_selection_mode: "manual",
      question_ids: "[]",
      question_snapshot: "[]",
      control_flags: "{}",
      retake_policy: "unlimited",
      score_strategy: "highest",
      max_attempts: 1,
      result_publication_mode: "immediate",
      ...overrides,
    };
    await sql.unsafe(
      `INSERT INTO ${testSchema}.exams (
        id, organization_id, title, description, course_id, status,
        timing_mode, duration_minutes, open_at, close_at,
        passing_score, total_score, question_selection_mode,
        question_ids, question_snapshot, control_flags,
        retake_policy, score_strategy, max_attempts, result_publication_mode
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )`,
      [
        defaults.id,
        defaults.organization_id,
        defaults.title,
        defaults.description,
        defaults.course_id,
        defaults.status,
        defaults.timing_mode,
        defaults.duration_minutes,
        defaults.open_at,
        defaults.close_at,
        defaults.passing_score,
        defaults.total_score,
        defaults.question_selection_mode,
        defaults.question_ids,
        defaults.question_snapshot,
        defaults.control_flags,
        defaults.retake_policy,
        defaults.score_strategy,
        defaults.max_attempts,
        defaults.result_publication_mode,
      ],
    );
  }

  it("rejects passing_score > total_score", async () => {
    await expect(
      insertExam({ passing_score: 101, total_score: 100 }),
    ).rejects.toThrow(/exams_passing_score_max_check/);
  });

  it("rejects passing_score < 0", async () => {
    await expect(
      insertExam({ passing_score: -1, total_score: 100 }),
    ).rejects.toThrow(/exams_passing_score_min_check/);
  });

  it("rejects total_score <= 0", async () => {
    await expect(
      insertExam({ passing_score: 0, total_score: 0 }),
    ).rejects.toThrow(/exams_total_score_positive_check/);
  });

  it("accepts valid boundary: passing_score = total_score", async () => {
    await expect(
      insertExam({ passing_score: 100, total_score: 100 }),
    ).resolves.not.toThrow();
  });

  it("accepts valid boundary: passing_score = 0", async () => {
    await expect(
      insertExam({ passing_score: 0, total_score: 100 }),
    ).resolves.not.toThrow();
  });
});
