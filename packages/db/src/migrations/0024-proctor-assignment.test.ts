/**
 * Migration 0024 — Proctor-to-Exam assignment tables (ADR-015 §4).
 *
 * Verifies the frozen schema contract against a real PostgreSQL schema:
 *
 * 1. named CHECKs (`exam_proctor_assignments_status_check`,
 *    `exam_proctor_assignments_revocation_shape_check`,
 *    `exam_proctor_assignment_events_command_type_check`,
 *    `exam_proctor_assignment_events_outcome_check`);
 * 2. the composite exam FK resolving through `exams_org_id_unique`.
 *
 * The behavioral enforcement of these objects (one-active 23505 on
 * `exam_proctor_assignments_active_unique`, the idempotency arbiter, the
 * parent/user FK rejections) is owned by
 * `repository/proctorAssignmentRepo.test.ts`.
 *
 * Mirrors the migration-application pattern from `0023-incident-fk-and-rollback.test.ts`.
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

describe("0024 proctor-assignment schema contract (ADR-015 §4)", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let sql: SqlDriver;
  let orgId: string;
  let adminId: string;
  let proctorId: string;
  let examId: string;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "migration-0024-proctor-assignment",
    });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    sql = conn.sql;
    await applyAllMigrations(conn.sql, iso.databaseUrl);

    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    orgId = `org-0024`;
    adminId = `admin-0024`;
    proctorId = `proctor-0024`;
    const courseId = `course-0024`;
    examId = `exam-0024`;
    await sql.unsafe(`
      INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
      VALUES (${s(orgId)}, 'Org', 'Org', 'slug-0024', ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
      VALUES (${s(adminId)}, ${s(orgId)}, 'admin-0024', 'hash', 'Admin', 'Admin', true, ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
      VALUES (${s(proctorId)}, ${s(orgId)}, 'proctor-0024', 'hash', 'Proctor', 'Proctor', true, ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
      VALUES (${s(courseId)}, ${s(orgId)}, 'Course', 'C-0024', '', ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "exams" ("id", "organization_id", "title", "description", "course_id", "status", "timing_mode",
        "duration_minutes", "open_at", "close_at", "passing_score", "total_score", "question_selection_mode",
        "question_ids", "question_snapshot", "control_flags", "retake_policy", "score_strategy", "max_attempts",
        "result_publication_mode", "interruption_time_policy", "created_at", "updated_at")
      VALUES (${s(examId)}, ${s(orgId)}, 'Exam', '', ${s(courseId)}, 'open', 'timed_window',
        60, ${ts(createdAt)}, ${ts(new Date("2026-01-02T00:00:00.000Z"))}, 60, 100, 'manual',
        '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'unlimited', 'highest', 1,
        'immediate', 'strict', ${ts(createdAt)}, ${ts(createdAt)})
    `);
  }, 120_000);

  afterAll(async () => {
    await conn?.sql.end();
    await iso?.cleanup();
  }, 30_000);

  async function constraintNames(table: string): Promise<string[]> {
    const rows = await sql.unsafe<{ conname: string }[]>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = ${s(table)}::regclass
      ORDER BY conname
    `);
    return rows.map((r) => r.conname);
  }

  it("the two tables exist with the frozen named CHECK constraints", async () => {
    const assignmentConstraints = await constraintNames(
      "exam_proctor_assignments",
    );
    expect(assignmentConstraints).toContain(
      "exam_proctor_assignments_status_check",
    );
    expect(assignmentConstraints).toContain(
      "exam_proctor_assignments_revocation_shape_check",
    );

    const eventConstraints = await constraintNames(
      "exam_proctor_assignment_events",
    );
    expect(eventConstraints).toContain(
      "exam_proctor_assignment_events_command_type_check",
    );
    expect(eventConstraints).toContain(
      "exam_proctor_assignment_events_outcome_check",
    );
  });

  it("the composite exam FK resolves through exams_org_id_unique", async () => {
    // A cross-organization exam reference must fail the composite FK.
    await expect(
      sql.unsafe(`
        INSERT INTO "exam_proctor_assignments"
          ("id", "organization_id", "exam_id", "proctor_user_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('ep-cross-org', 'other-org', ${s(examId)}, ${s(proctorId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow(/exam_proctor_assignments_exam_fk|violates foreign key/);
  });
});
