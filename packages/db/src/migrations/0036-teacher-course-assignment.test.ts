/**
 * Migration 0036 — Teacher-to-Course assignment table (issue #286).
 *
 * Verifies the frozen schema contract against a real PostgreSQL schema:
 *
 * 1. named CHECKs (`teacher_course_assignments_status_check`,
 *    `teacher_course_assignments_revocation_shape_check`);
 * 2. the one-active partial unique
 *    `teacher_course_assignments_active_unique`;
 * 3. the composite FK to courses(organization_id, id) and the
 *    `courses_org_id_unique` index added so the composite course FK is valid;
 * 4. the plain users(id) FKs (teacher_user_id / assigned_by / revoked_by);
 * 5. cross-organization course references are impossible (composite FK).
 *
 * Mirrors the migration-application pattern from
 * `0024-proctor-assignment.test.ts`.
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

describe("0036 teacher-course-assignment schema contract (#286 §3A)", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let sql: SqlDriver;
  let orgId: string;
  let otherOrgId: string;
  let adminId: string;
  let teacherId: string;
  let courseId: string;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "migration-0036-teacher-course",
    });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    sql = conn.sql;
    await applyAllMigrations(conn.sql, iso.databaseUrl);

    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    orgId = `org-0036`;
    otherOrgId = `org-0036-other`;
    adminId = `admin-0036`;
    teacherId = `teacher-0036`;
    courseId = `course-0036`;
    await sql.unsafe(`
      INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
      VALUES (${s(orgId)}, 'Org', 'Org', 'slug-0036', ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
      VALUES (${s(otherOrgId)}, 'Other', 'Other', 'slug-0036-other', ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
      VALUES (${s(adminId)}, ${s(orgId)}, 'admin-0036', 'hash', 'Admin', 'Admin', true, ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
      VALUES (${s(teacherId)}, ${s(orgId)}, 'teacher-0036', 'hash', 'Teacher', 'Teacher', true, ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
      VALUES (${s(courseId)}, ${s(orgId)}, 'Course', 'C-0036', '', ${ts(createdAt)}, ${ts(createdAt)})
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

  async function indexNames(table: string): Promise<string[]> {
    const rows = await sql.unsafe<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = ${s(table)}
      ORDER BY indexname
    `);
    return rows.map((r) => r.indexname);
  }

  it("the table exists with the frozen named CHECK constraints", async () => {
    const constraints = await constraintNames("teacher_course_assignments");
    expect(constraints).toContain("teacher_course_assignments_status_check");
    expect(constraints).toContain(
      "teacher_course_assignments_revocation_shape_check",
    );
  });

  it("courses_org_id_unique exists (composite-FK target) and the episode indexes exist", async () => {
    const courseIndexes = await indexNames("courses");
    expect(courseIndexes).toContain("courses_org_id_unique");

    const assignmentIndexes = await indexNames("teacher_course_assignments");
    expect(assignmentIndexes).toContain(
      "teacher_course_assignments_org_id_unique",
    );
    expect(assignmentIndexes).toContain(
      "teacher_course_assignments_active_unique",
    );
    expect(assignmentIndexes).toContain(
      "teacher_course_assignments_org_teacher_status_idx",
    );
    expect(assignmentIndexes).toContain(
      "teacher_course_assignments_org_course_status_idx",
    );
  });

  it("the frozen revocation-shape CHECK rejects an inconsistent row shape", async () => {
    // status='revoked' without revoked_at/revoked_by must be rejected.
    await expect(
      sql.unsafe(`
        INSERT INTO "teacher_course_assignments"
          ("id", "organization_id", "teacher_user_id", "course_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('tca-1', ${s(orgId)}, ${s(teacherId)}, ${s(courseId)}, 'revoked', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow();
  });

  it("a valid active episode inserts, and a second active episode for the same (org, teacher, course) violates teacher_course_assignments_active_unique", async () => {
    await sql.unsafe(`
      INSERT INTO "teacher_course_assignments"
        ("id", "organization_id", "teacher_user_id", "course_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
      VALUES ('tca-active-1', ${s(orgId)}, ${s(teacherId)}, ${s(courseId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
    `);
    let error: { code?: string; constraint?: string } | null = null;
    try {
      await sql.unsafe(`
        INSERT INTO "teacher_course_assignments"
          ("id", "organization_id", "teacher_user_id", "course_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('tca-active-2', ${s(orgId)}, ${s(teacherId)}, ${s(courseId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
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
    expect(error?.constraint).toBe("teacher_course_assignments_active_unique");
  });

  it("revoking frees the triple for a new active episode (monotonic episode semantics)", async () => {
    // tca-active-1 from the previous test is the active episode; revoke it.
    await sql.unsafe(`
      UPDATE "teacher_course_assignments"
      SET "status" = 'revoked', "revoked_by" = ${s(adminId)}, "revoked_at" = ${ts(new Date("2026-01-02T00:00:00.000Z"))}, "updated_at" = ${ts(new Date("2026-01-02T00:00:00.000Z"))}
      WHERE "id" = 'tca-active-1'
    `);
    await sql.unsafe(`
      INSERT INTO "teacher_course_assignments"
        ("id", "organization_id", "teacher_user_id", "course_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
      VALUES ('tca-active-3', ${s(orgId)}, ${s(teacherId)}, ${s(courseId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-02T00:00:00.000Z"))}, ${ts(new Date("2026-01-02T00:00:00.000Z"))}, ${ts(new Date("2026-01-02T00:00:00.000Z"))})
    `);
    const count = await sql.unsafe<{ count: string }[]>(`
      SELECT count(*)::text AS count FROM "teacher_course_assignments"
      WHERE "organization_id" = ${s(orgId)} AND "teacher_user_id" = ${s(teacherId)}
    `);
    expect(Number(count[0]?.count)).toBe(2); // active-1 revoked + active-3 active (tca-1/tca-active-2 were rejected)
  });

  it("cross-organization course references are impossible (composite FK on courses(organization_id, id))", async () => {
    await expect(
      sql.unsafe(`
        INSERT INTO "teacher_course_assignments"
          ("id", "organization_id", "teacher_user_id", "course_id", "status", "assigned_by", "assigned_at", "created_at", "updated_at")
        VALUES ('tca-xorg', ${s(otherOrgId)}, ${s(teacherId)}, ${s(courseId)}, 'active', ${s(adminId)}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))}, ${ts(new Date("2026-01-01T00:00:00.000Z"))})
      `),
    ).rejects.toThrow();
  });

  it("the plain users(id) FKs exist (teacher_user_id / assigned_by / revoked_by)", async () => {
    const constraints = await constraintNames("teacher_course_assignments");
    expect(constraints).toContain("teacher_course_assignments_org_fk");
    expect(constraints).toContain("teacher_course_assignments_teacher_user_fk");
    expect(constraints).toContain("teacher_course_assignments_assigned_by_fk");
    expect(constraints).toContain("teacher_course_assignments_revoked_by_fk");
    expect(constraints).toContain("teacher_course_assignments_course_fk");
  });
});
