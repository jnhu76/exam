/**
 * Guarded rollback tests for `attempt_command_receipts`
 * (J5-I1C Slice 1 / J5-I1C0 audit §10, §11.12).
 *
 * Verifies the three rollback semantics against real PostgreSQL:
 *   - table absent            → success / no-op
 *   - table present, 0 rows   → allowed; DROP
 *   - table present, rows > 0 → fail closed; preserve all receipt data
 *
 * Mirrors the rollback-test pattern from `0023-incident-fk-and-rollback.test.ts`.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../database.js";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";
import { withTestInfraLifecycleLock } from "../testInfraLock.js";
import { rollbackAttemptCommandReceipts } from "../scripts/rollbackAttemptCommandReceipts.js";

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

async function applyAllMigrations(
  sql: SqlDriver,
  lockUrl: string,
): Promise<void> {
  await withTestInfraLifecycleLock(lockUrl, async () => {
    const journal = readJournal();
    for (const entry of journal.entries) {
      const statements = readMigrationStatements(entry.tag);
      await sql.begin(async (tx) => {
        for (const stmt of statements) {
          await tx.unsafe(stmt);
        }
      });
    }
  });
}

const ts = (d: Date) => `'${d.toISOString()}'`;
const s = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function tableExists(sql: SqlDriver, name: string): Promise<boolean> {
  const rows = (await sql.unsafe(`
    SELECT to_regclass(${s(name)})::text AS reg
  `)) as Array<{ reg: string | null }>;
  return rows[0]?.reg != null;
}

async function seedOrgAttempt(
  sql: SqlDriver,
  suffix: string,
): Promise<{ orgId: string; adminId: string; attemptId: string }> {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const orgId = `org-0028rb-${suffix}`;
  const adminId = `admin-0028rb-${suffix}`;
  const candidateId = `cand-0028rb-${suffix}`;
  const courseId = `course-0028rb-${suffix}`;
  const examId = `exam-0028rb-${suffix}`;
  const enrollmentId = `enr-0028rb-${suffix}`;
  const attemptId = `att-0028rb-${suffix}`;
  await sql.unsafe(`
    INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
    VALUES (${s(orgId)}, 'Org', 'Org', ${s(`slug-0028rb-${suffix}`)}, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
    VALUES (${s(adminId)}, ${s(orgId)}, ${s(`u-0028rb-${suffix}`)}, 'hash', 'Admin', 'Admin', true, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "candidate_profiles" ("id", "organization_id", "user_id", "fields", "created_at", "updated_at")
    VALUES (${s(candidateId)}, ${s(orgId)}, ${s(adminId)}, '{}'::jsonb, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
    VALUES (${s(courseId)}, ${s(orgId)}, 'Course', ${s(`c-0028rb-${suffix}`)}, '', ${ts(createdAt)}, ${ts(createdAt)})
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
  await sql.unsafe(`
    INSERT INTO "exam_enrollments" ("id", "organization_id", "exam_id", "candidate_id", "status", "attempt_count", "created_at", "updated_at")
    VALUES (${s(enrollmentId)}, ${s(orgId)}, ${s(examId)}, ${s(candidateId)}, 'started', 1, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "exam_attempts" ("id", "organization_id", "exam_id", "enrollment_id", "candidate_id",
      "attempt_no", "status", "question_snapshot", "answers",
      "started_at", "deadline_at", "last_activity_at",
      "interruption_policy_snapshot_version", "interruption_time_policy_snapshot",
      "created_at", "updated_at")
    VALUES (${s(attemptId)}, ${s(orgId)}, ${s(examId)}, ${s(enrollmentId)}, ${s(candidateId)},
      1, 'in_progress', '[]'::jsonb, '[]'::jsonb,
      ${ts(createdAt)}, ${ts(new Date("2026-01-01T02:00:00.000Z"))}, ${ts(new Date("2026-01-01T01:00:00.000Z"))},
      1, 'strict', ${ts(createdAt)}, ${ts(createdAt)})
  `);
  return { orgId, adminId, attemptId };
}

describe("0028 guarded rollback", { timeout: 90_000 }, () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;

  afterAll(async () => {
    await conn?.sql.end();
    await iso?.cleanup();
  });

  it("drops the table when present and empty", async () => {
    iso = await setupIsolatedTestDb({ namespace: "mig0028rb-empty" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    try {
      await applyAllMigrations(conn.sql, iso.databaseUrl);
      expect(await tableExists(conn.sql, "attempt_command_receipts")).toBe(
        true,
      );
      const result = await rollbackAttemptCommandReceipts(conn.db);
      expect(result.dropped).toBe(true);
      expect(result.rowCount).toBe(0);
      expect(await tableExists(conn.sql, "attempt_command_receipts")).toBe(
        false,
      );
    } finally {
      await conn.sql.end();
      await iso.cleanup();
    }
  });

  it("fails closed and preserves the table + rows when non-empty", async () => {
    const nonEmptyIso = await setupIsolatedTestDb({
      namespace: "mig0028rb-full",
    });
    const nonEmptyConn = await createDatabase(
      nonEmptyIso.databaseUrl,
      nonEmptyIso.schemaName,
    );
    try {
      await applyAllMigrations(nonEmptyConn.sql, nonEmptyIso.databaseUrl);
      const fix = await seedOrgAttempt(nonEmptyConn.sql, "full");
      // Insert one receipt row — activation has occurred.
      const opId = randomUUID();
      await nonEmptyConn.sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(fix.orgId)}, ${s(fix.attemptId)}, ${s(opId)},
          'force_submit', '{"reason":null}'::jsonb,
          '{"commandType":"force_submit","appliedAt":"2026-01-01T00:00:00.000Z"}'::jsonb,
          'applied', ${s(fix.adminId)}
        )
      `);

      await expect(
        rollbackAttemptCommandReceipts(nonEmptyConn.db),
      ).rejects.toThrow(/Guard tripped/);

      // The table AND the receipt row remain intact.
      expect(
        await tableExists(nonEmptyConn.sql, "attempt_command_receipts"),
      ).toBe(true);
      const rows = (await nonEmptyConn.sql.unsafe(`
        SELECT count(*)::int AS n FROM attempt_command_receipts WHERE operation_id = ${s(opId)}
      `)) as Array<{ n: number }>;
      expect(Number(rows[0]?.n ?? 0)).toBe(1);
    } finally {
      await nonEmptyConn.sql.end();
      await nonEmptyIso.cleanup();
    }
  });

  it("is a safe no-op when the table is absent", async () => {
    const absentIso = await setupIsolatedTestDb({
      namespace: "mig0028rb-absent",
    });
    const absentConn = await createDatabase(
      absentIso.databaseUrl,
      absentIso.schemaName,
    );
    try {
      await applyAllMigrations(absentConn.sql, absentIso.databaseUrl);
      // Manually drop the table to simulate the absent case.
      await absentConn.sql.unsafe(
        `DROP TABLE IF EXISTS "attempt_command_receipts"`,
      );
      expect(
        await tableExists(absentConn.sql, "attempt_command_receipts"),
      ).toBe(false);
      const result = await rollbackAttemptCommandReceipts(absentConn.db);
      expect(result.absent).toBe(true);
      expect(result.dropped).toBe(false);
      expect(
        await tableExists(absentConn.sql, "attempt_command_receipts"),
      ).toBe(false);
    } finally {
      await absentConn.sql.end();
      await absentIso.cleanup();
    }
  });
});
