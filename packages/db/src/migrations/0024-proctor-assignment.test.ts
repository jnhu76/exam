/**
 * Migration 0024 — Proctor-to-Exam assignment tables (ADR-015 §4).
 *
 * Verifies the frozen schema contract against a real PostgreSQL schema:
 *
 * 1. named CHECKs (`exam_proctor_assignments_status_check`,
 *    `exam_proctor_assignments_revocation_shape_check`,
 *    `exam_proctor_assignment_events_command_type_check`,
 *    `exam_proctor_assignment_events_outcome_check`);
 * 2. the one-active partial unique
 *    `exam_proctor_assignments_active_unique`;
 * 3. the idempotency arbiter `exam_proctor_assignment_events_org_operation_unique`;
 * 4. the event → assignment composite parent FK;
 * 5. the plain users(id) FKs (proctor_user_id / assigned_by / revoked_by /
 *    actor_id) and the composite exams FK;
 * 6. the `exams_org_id_unique` index added so the composite exam FK is valid.
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
  });

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

  it("the frozen revocation-shape CHECK rejects an inconsistent row shape", async () => {
    // status='revoked' without revoked_at/revoked_by must be rejected.
    await expect(
      sql.unsafe(`
        INSERT INTO "exam_proctor_assignments"
          ("id", "organization_id", "exam_id", "proctor_user_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('ep-1', ${s(orgId)}, ${s(examId)}, ${s(proctorId)}, 'revoked', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow();
  });

  it("a valid active episode inserts, and a second active episode for the same (org, exam, proctor) violates exam_proctor_assignments_active_unique", async () => {
    await sql.unsafe(`
      INSERT INTO "exam_proctor_assignments"
        ("id", "organization_id", "exam_id", "proctor_user_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
      VALUES ('ep-active-1', ${s(orgId)}, ${s(examId)}, ${s(proctorId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
    `);
    await expect(
      sql.unsafe(`
        INSERT INTO "exam_proctor_assignments"
          ("id", "organization_id", "exam_id", "proctor_user_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('ep-active-2', ${s(orgId)}, ${s(examId)}, ${s(proctorId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow(/exam_proctor_assignments_active_unique/);
  });

  it("the events table operation unique is the idempotency arbiter", async () => {
    await sql.unsafe(`
      INSERT INTO "exam_proctor_assignment_events"
        ("id", "organization_id", "assignment_id", "command_type", "operation_id", "canonical_payload", "outcome", "actor_id", "created_at")
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ${s(orgId)}, 'ep-active-1', 'assign', '11111111-1111-4111-8111-111111111111', '{}'::jsonb, 'applied', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
    `);
    await expect(
      sql.unsafe(`
        INSERT INTO "exam_proctor_assignment_events"
          ("id", "organization_id", "assignment_id", "command_type", "operation_id", "canonical_payload", "outcome", "actor_id", "created_at")
        VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', ${s(orgId)}, 'ep-active-1', 'assign', '11111111-1111-4111-8111-111111111111', '{}'::jsonb, 'applied', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow(/exam_proctor_assignment_events_org_operation_unique/);
  });

  it("the event → assignment composite FK rejects an unknown assignment id", async () => {
    await expect(
      sql.unsafe(`
        INSERT INTO "exam_proctor_assignment_events"
          ("id", "organization_id", "assignment_id", "command_type", "operation_id", "canonical_payload", "outcome", "actor_id", "created_at")
        VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', ${s(orgId)}, 'no-such-episode', 'assign', '22222222-2222-4222-8222-222222222222', '{}'::jsonb, 'applied', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow();
  });

  it("plain users(id) FKs fail closed (no cascade) on unknown users", async () => {
    await expect(
      sql.unsafe(`
        INSERT INTO "exam_proctor_assignments"
          ("id", "organization_id", "exam_id", "proctor_user_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('ep-bad-user', ${s(orgId)}, ${s(examId)}, 'no-such-user', 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow();
    await expect(
      sql.unsafe(`
        INSERT INTO "exam_proctor_assignment_events"
          ("id", "organization_id", "assignment_id", "command_type", "operation_id", "canonical_payload", "outcome", "actor_id", "created_at")
        VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', ${s(orgId)}, 'ep-active-1', 'assign', '33333333-3333-4333-8333-333333333333', '{}'::jsonb, 'applied', 'no-such-user', ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow();
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
