/**
 * Migration 0037 — Grader-to-Exam assignment table (issue #296).
 *
 * Verifies the frozen schema contract against a real PostgreSQL schema:
 *
 * 1. named CHECKs (`grader_exam_assignments_status_check`,
 *    `grader_exam_assignments_revocation_shape_check`);
 * 2. the one-active partial unique `grader_exam_assignments_active_unique`;
 * 3. the composite FK to exams(organization_id, id) (the
 *    `exams_org_id_unique` index already exists);
 * 4. the plain users(id) FKs (grader_user_id / assigned_by / revoked_by);
 * 5. cross-organization exam references are impossible (composite FK).
 *
 * Mirrors the migration-application pattern from
 * `0036-teacher-course-assignment.test.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../database.js";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";
import { withTestInfraLifecycleLock } from "../testInfraLock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../migrations/postgres");

function readJournal(): { entries: { idx: number; tag: string }[] } {
  const raw = readFileSync(resolve(MIGRATIONS_DIR, "meta/_journal.json"), {
    encoding: "utf-8",
  });
  return JSON.parse(raw);
}

function readMigrationStatements(tag: string): string[] {
  const content = readFileSync(resolve(MIGRATIONS_DIR, `${tag}.sql`), {
    encoding: "utf-8",
  });
  return content
    .split("--> statement-breakpoint")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

type SqlDriver = Awaited<ReturnType<typeof createDatabase>>["sql"];

async function executeMigrationFile(
  sql: SqlDriver,
  tag: string,
): Promise<void> {
  const statements = readMigrationStatements(tag);
  await sql.begin(async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
  });
}

async function applyAllMigrations(
  sql: SqlDriver,
  lockUrl: string,
): Promise<void> {
  await withTestInfraLifecycleLock(lockUrl, async () => {
    const journal = readJournal();
    for (const entry of journal.entries) {
      await executeMigrationFile(sql, entry.tag);
    }
  });
}

const ts = (d: Date) => `'${d.toISOString()}'`;
const s = (v: string) => `'${v.replace(/'/g, "''")}'`;

describe("0037 grader-exam-assignment schema contract (#296)", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let sql: SqlDriver;
  let orgId: string;
  let otherOrgId: string;
  let adminId: string;
  let graderId: string;
  let courseId: string;
  let examAId: string;
  let examBId: string;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "migration-0037-grader-exam",
    });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    sql = conn.sql;
    await applyAllMigrations(conn.sql, iso.databaseUrl);

    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    orgId = `org-0037`;
    otherOrgId = `org-0037-other`;
    adminId = `admin-0037`;
    graderId = `grader-0037`;
    courseId = `course-0037`;
    examAId = `exam-0037-a`;
    examBId = `exam-0037-b`;
    await sql.unsafe(`
      INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
      VALUES (${s(orgId)}, 'Org', 'Org', 'slug-0037', ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
      VALUES (${s(otherOrgId)}, 'Other', 'Other', 'slug-0037-other', ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
      VALUES (${s(adminId)}, ${s(orgId)}, 'admin-0037', 'hash', 'Admin', 'Admin', true, ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
      VALUES (${s(graderId)}, ${s(orgId)}, 'grader-0037', 'hash', 'Grader', 'Grader', true, ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
      VALUES (${s(courseId)}, ${s(orgId)}, 'Course', 'C-0037', '', ${ts(createdAt)}, ${ts(createdAt)})
    `);
    for (const examId of [examAId, examBId]) {
      await sql.unsafe(`
        INSERT INTO "exams" (
          "id", "organization_id", "title", "description", "course_id", "status",
          "timing_mode", "duration_minutes", "open_at", "close_at",
          "passing_score", "total_score", "question_selection_mode",
          "question_ids", "question_snapshot", "control_flags",
          "retake_policy", "score_strategy", "max_attempts", "created_at", "updated_at"
        ) VALUES (
          ${s(examId)}, ${s(orgId)}, ${s(`Exam ${examId}`)}, '', ${s(courseId)}, 'draft',
          'timed_window', 60, ${ts(createdAt)}, ${ts(new Date(createdAt.getTime() + 86_400_000))},
          60, 100, 'manual',
          '[]'::jsonb, '[]'::jsonb,
          '{"shuffleQuestions":false,"shuffleOptions":false,"detectTabSwitch":false,"disableCopyPaste":false,"requireQueue":false,"batchSize":10,"batchInterval":3,"restrictIp":false,"requireLockdown":false,"showResultImmediately":false}'::jsonb,
          'unlimited', 'highest', 3, ${ts(createdAt)}, ${ts(createdAt)}
        )
      `);
    }
  }, 120_000);

  afterAll(async () => {
    await conn?.sql.end();
    await iso?.cleanup();
  });

  async function constraintNames(table: string): Promise<string[]> {
    const rows = await sql.unsafe<{ conname: string }[]>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = ${s(table)}::regclass
      ORDER BY conname
    `);
    return rows.map((r) => r.conname);
  }

  async function indexNames(table: string): Promise<string[]> {
    const rows = await sql.unsafe<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = ${s(table)}
      ORDER BY indexname
    `);
    return rows.map((r) => r.indexname);
  }

  it("the table exists with the frozen named CHECK constraints", async () => {
    const constraints = await constraintNames("grader_exam_assignments");
    expect(constraints).toContain("grader_exam_assignments_status_check");
    expect(constraints).toContain(
      "grader_exam_assignments_revocation_shape_check",
    );
  });

  it("the episode indexes exist and exams_org_id_unique remains the composite-FK target", async () => {
    const examIndexes = await indexNames("exams");
    expect(examIndexes).toContain("exams_org_id_unique");

    const assignmentIndexes = await indexNames("grader_exam_assignments");
    expect(assignmentIndexes).toContain(
      "grader_exam_assignments_org_id_unique",
    );
    expect(assignmentIndexes).toContain(
      "grader_exam_assignments_active_unique",
    );
    expect(assignmentIndexes).toContain(
      "grader_exam_assignments_org_grader_status_idx",
    );
    expect(assignmentIndexes).toContain(
      "grader_exam_assignments_org_exam_status_idx",
    );
  });

  it("the frozen revocation-shape CHECK rejects an inconsistent row shape", async () => {
    // status='revoked' without revoked_at/revoked_by must be rejected.
    await expect(
      sql.unsafe(`
        INSERT INTO "grader_exam_assignments"
          ("id", "organization_id", "grader_user_id", "exam_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('gea-1', ${s(orgId)}, ${s(graderId)}, ${s(examAId)}, 'revoked', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow();
  });

  it("a valid active episode inserts, and a second active episode for the same (org, grader, exam) violates grader_exam_assignments_active_unique", async () => {
    await sql.unsafe(`
      INSERT INTO "grader_exam_assignments"
        ("id", "organization_id", "grader_user_id", "exam_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
      VALUES ('gea-active-1', ${s(orgId)}, ${s(graderId)}, ${s(examAId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
    `);
    let error: { code?: string; constraint?: string } | null = null;
    try {
      await sql.unsafe(`
        INSERT INTO "grader_exam_assignments"
          ("id", "organization_id", "grader_user_id", "exam_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('gea-active-2', ${s(orgId)}, ${s(graderId)}, ${s(examAId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `);
    } catch (err) {
      let current: unknown = err;
      const visited = new Set<unknown>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const e = current as Record<string, unknown>;
        if (e.code === "23505") {
          const constraint = String(e.constraint ?? e.constraint_name ?? "");
          error = { code: "23505", constraint };
          break;
        }
        current = "cause" in e ? e.cause : null;
      }
      if (!error) await Promise.reject(err);
    }
    expect(error?.code).toBe("23505");
    expect(error?.constraint).toBe("grader_exam_assignments_active_unique");
  });

  it("revoking frees the triple for a new active episode (monotonic episode semantics)", async () => {
    // gea-active-1 from the previous test is the active episode; revoke it.
    await sql.unsafe(`
      UPDATE "grader_exam_assignments"
      SET "status" = 'revoked', "revoked_by" = ${s(adminId)}, "revoked_at" = ${ts(new Date("2026-01-02T00:00:00.000Z"))}, "updated_at" = ${ts(new Date("2026-01-02T00:00:00.000Z"))}
      WHERE "id" = 'gea-active-1'
    `);
    await sql.unsafe(`
      INSERT INTO "grader_exam_assignments"
        ("id", "organization_id", "grader_user_id", "exam_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
      VALUES ('gea-active-3', ${s(orgId)}, ${s(graderId)}, ${s(examAId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-02T00:00:00.000Z"))}, ${ts(new Date("2026-01-02T00:00:00.000Z"))}, ${ts(new Date("2026-01-02T00:00:00.000Z"))})
    `);
    const count = await sql.unsafe<{ count: string }[]>(`
      SELECT count(*)::text AS count FROM "grader_exam_assignments"
      WHERE "organization_id" = ${s(orgId)} AND "grader_user_id" = ${s(graderId)}
    `);
    expect(Number(count[0]?.count)).toBe(2); // active-1 revoked + active-3 active (gea-1/gea-active-2 were rejected)
  });

  it("cross-organization exam references are impossible (composite FK on exams(organization_id, id))", async () => {
    await expect(
      sql.unsafe(`
        INSERT INTO "grader_exam_assignments"
          ("id", "organization_id", "grader_user_id", "exam_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('gea-xorg', ${s(otherOrgId)}, ${s(graderId)}, ${s(examAId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow();
  });

  it("the plain users(id) FKs exist (grader_user_id / assigned_by / revoked_by)", async () => {
    const constraints = await constraintNames("grader_exam_assignments");
    expect(constraints).toContain("grader_exam_assignments_org_fk");
    expect(constraints).toContain("grader_exam_assignments_grader_user_fk");
    expect(constraints).toContain("grader_exam_assignments_assigned_by_fk");
    expect(constraints).toContain("grader_exam_assignments_revoked_by_fk");
    expect(constraints).toContain("grader_exam_assignments_exam_fk");
  });
});
